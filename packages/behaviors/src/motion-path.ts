/**
 * `motion-path` — percorre um caminho do projeto com velocidade uniforme.
 *
 * O ponto central: `progress` (0..1) é convertido em `t` **pela tabela de
 * comprimento de arco**, nunca usado como `t` direto. Sem isso o objeto acelera
 * nas curvas fechadas e desacelera nas retas, o erro clássico de motion path.
 *
 * Auto-orientação e banking saem da tangente do caminho, não de diferença de
 * posições entre frames: a tangente é analítica, então o resultado não depende de
 * fps nem da ordem em que os frames são pedidos.
 */

import { pathTangent, progressToT, samplePath, type Vec2 } from "@theatrum/core-math";
import { evaluateProperty } from "@theatrum/animation";
import { initialBearing } from "@theatrum/gis";
import {
  NumberAnimatablePropertySchema,
  Vec2Schema,
  type Anchor,
  type Node,
} from "@theatrum/schema";
import { z } from "zod";
import {
  type BehaviorContext,
  type BehaviorDefinition,
  type PropertyContribution,
} from "./contracts.js";
import { pathGeometry } from "./path-geometry.js";

/** Passo em `progress` para estimar curvatura no banking. */
const BANKING_PROBE = 0.01;

/** Janela de amostragem do rumo geográfico, em fração do caminho. */
const HEADING_PROBE = 0.004;

export const MotionPathParamsSchema = z
  .object({
    pathId: z.string().min(1),
    progress: NumberAnimatablePropertySchema,
    autoOrient: z.boolean(),
    /** Graus somados à direção de marcha; corrige arte que não aponta para cima. */
    orientOffset: z.number().finite(),
    /** Graus de inclinação por unidade de curvatura. 0 desliga. */
    banking: z.number().finite(),
    /** Deslocamento aplicado depois da amostragem, no espaço do caminho. */
    offset: Vec2Schema,
    /** `progress` fora de [0,1] dá a volta em vez de saturar — patrulha. */
    loop: z.boolean(),
  })
  .strict();

export type MotionPathParams = z.infer<typeof MotionPathParamsSchema>;

export const MOTION_PATH_DEFAULTS: MotionPathParams = Object.freeze({
  pathId: "",
  progress: { value: 0, keyframes: [], expression: null },
  autoOrient: true,
  orientOffset: 0,
  banking: 0,
  offset: [0, 0] as [number, number],
  loop: false,
});

export const motionPathBehavior: BehaviorDefinition<MotionPathParams> = Object.freeze({
  type: "motion-path",
  label: "Caminho",
  paramSchema: MotionPathParamsSchema,
  defaultParams: MOTION_PATH_DEFAULTS,

  contribute(
    _node: Node,
    params: MotionPathParams,
    frame: number,
    context: BehaviorContext,
  ): PropertyContribution {
    const path = context.path(params.pathId);
    if (path === undefined) {
      return { diagnostic: `Caminho "${params.pathId}" não existe no projeto.` };
    }
    const geometry = pathGeometry(path);
    if (geometry.segments.length === 0 || geometry.totalLength <= 0) {
      return { diagnostic: `Caminho "${params.pathId}" não tem comprimento.` };
    }

    const rawProgress = evaluateProperty(params.progress, frame);
    if (typeof rawProgress !== "number" || !Number.isFinite(rawProgress)) {
      return { diagnostic: "progress inválido." };
    }
    const progress = params.loop ? wrap01(rawProgress) : clamp01(rawProgress);
    const point = pointAt(geometry, progress, params.offset);
    const anchor: Anchor =
      geometry.space === "geo"
        ? { space: "geo", lngLat: [point[0], point[1]] }
        : { space: "comp", position: [point[0], point[1]] };

    if (!params.autoOrient && params.banking === 0) return { anchor };

    const heading = headingAt(geometry, progress);
    const bank = params.banking === 0 ? 0 : bankingAngle(geometry, progress, params.banking);
    if (!params.autoOrient) {
      // Sem auto-orientação a inclinação é um acréscimo à rotação dos keyframes.
      return { anchor, rotationOffset: bank };
    }

    // Em geo a rotação é um bearing geográfico: o layout compensa a rotação da
    // câmera, e o objeto continua apontando para a direção de marcha real.
    return {
      anchor,
      rotation: heading + params.orientOffset + bank,
      rotationReference: geometry.space === "geo" ? "geo-bearing" : "screen",
    };
  },
});

/** Ponto do caminho em `progress`, já com o deslocamento aplicado. */
export function pointAt(
  geometry: ReturnType<typeof pathGeometry>,
  progress: number,
  offset: readonly [number, number] = [0, 0],
): Vec2 {
  const sampled = samplePath(geometry.segments, progressToT(geometry.table, progress));
  return [sampled[0] + offset[0], sampled[1] + offset[1]];
}

/**
 * Banking por variação de direção: a aeronave inclina para dentro da curva, e
 * quanto mais fechada a curva, maior a inclinação. Amostrado por diferença
 * central em `progress` — janela fixa, portanto determinístico.
 */
function bankingAngle(
  geometry: ReturnType<typeof pathGeometry>,
  progress: number,
  amount: number,
): number {
  const before = headingAt(geometry, Math.max(0, progress - BANKING_PROBE));
  const after = headingAt(geometry, Math.min(1, progress + BANKING_PROBE));
  const delta = shortestAngleDelta(before, after);
  return -delta * amount;
}

/**
 * Direção de marcha em graus.
 *
 * Em espaço geo o rumo sai de `initialBearing` entre duas posições vizinhas do
 * caminho, e não do `atan2` da tangente. Duas razões:
 *
 * 1. **A tangente em graus não é um rumo.** Um grau de longitude encurta com o
 *    cosseno da latitude; a 52° de latitude o erro do atan2 direto passa de 20°.
 * 2. **Caminho geodésico é aproximado por cordas retas.** Dentro de uma corda a
 *    tangente é constante, então a derivada do rumo — que é o banking — sairia
 *    zero no meio e com degrau nas junções. Amostrar posições dá rumo contínuo.
 *
 * Em espaço comp o eixo y aponta para baixo e o ângulo de tela é o atan2 direto.
 */
function headingAt(geometry: ReturnType<typeof pathGeometry>, progress: number): number {
  if (geometry.space !== "geo") {
    const tangent = pathTangent(geometry.segments, progressToT(geometry.table, progress));
    return (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI;
  }

  // Caminho geodésico: rumo analítico do ponto atual para o fim do trecho de
  // grande-círculo. Amostrar posições daria rumo constante dentro de cada corda
  // e degrau nas junções — e banking é a derivada do rumo.
  if (geometry.geodesic && geometry.geodesicVertices.length >= 2) {
    const globalT = progressToT(geometry.table, progress);
    const segmentIndex = Math.min(geometry.segments.length - 1, Math.max(0, Math.floor(globalT)));
    const pair = Math.min(
      geometry.geodesicVertices.length - 2,
      Math.floor(segmentIndex / geometry.subdivisions),
    );
    const target = geometry.geodesicVertices[pair + 1];
    const start = geometry.geodesicVertices[pair];
    const here = pointAt(geometry, progress);
    if (target !== undefined) {
      if (here[0] !== target[0] || here[1] !== target[1]) {
        return initialBearing([here[0], here[1]], [target[0], target[1]]);
      }
      // No próprio vértice final o rumo de chegada vem do trecho anterior.
      if (start !== undefined) {
        return initialBearing([start[0], start[1]], [target[0], target[1]]);
      }
    }
  }

  const step = HEADING_PROBE;
  const from = pointAt(geometry, Math.max(0, Math.min(1 - step, progress - step / 2)));
  const to = pointAt(geometry, Math.max(step, Math.min(1, progress + step / 2)));
  if (from[0] === to[0] && from[1] === to[1]) {
    const tangent = pathTangent(geometry.segments, progressToT(geometry.table, progress));
    return (Math.atan2(tangent[0], tangent[1]) * 180) / Math.PI;
  }
  return initialBearing([from[0], from[1]], [to[0], to[1]]);
}

export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
