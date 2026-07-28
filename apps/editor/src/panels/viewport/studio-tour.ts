/**
 * Roteiro de visitas: uma sequência de pontos de interesse vira **keyframes** nas
 * props de câmera do `studio.stage` ([ADR-015](../../../../../docs/adr/ADR-015-studio-points-of-interest.md)).
 *
 * **Por que compilar e não tocar.** Um player paralelo — um objeto que move a
 * câmera pelo roteiro enquanto o playhead anda — seria mais curto de escrever e
 * destruiria a propriedade central do projeto: a câmera deixaria de ser função
 * pura de `(documento, frame)`. Sem isso não há export byte-idêntico, que é o
 * critério que o roteiro chama de mais importante de todos, provado hoje em
 * `verify:phase8` 7/7. Compilando, a câmera continua sendo os mesmos keyframes de
 * sempre: a timeline os mostra, o editor de curvas os ajusta, o `Ctrl+Z` os
 * desfaz e o export os reproduz sem saber que um roteiro existiu.
 *
 * É o precedente da Fase 7 (ações live → keyframes) aplicado à câmera, com uma
 * diferença declarada: aquilo é um `ActionTemplate` em `packages/behaviors`, e
 * isto mora no editor. O motivo é a ordem das visitas — ela é a ordem das camadas,
 * e quem sabe calculá-la é `topologicalOrder`, de `@theatrum/scene-graph`, que
 * `behaviors` não tem entre as dependências. Duplicar a travessia lá deixaria a
 * numeração do marcador e a ordem da visita livres para divergir em silêncio, que
 * é pior do que a assimetria de pacote.
 *
 * Este módulo é puro: entra lista de paradas e tempos, sai lista de keyframes.
 * Quem grava é o painel, pelo Command Bus, como qualquer outra mutação.
 */

import { shortestAngleDelta } from "@theatrum/core-math";
import { topologicalOrder } from "@theatrum/scene-graph";
import type { AnimatableProperty, Composition, Keyframe, Node } from "@theatrum/schema";
import type { StudioPoiState } from "./studio-scene.js";

/** Uma parada do roteiro. É um `studio.poi` lido do documento. */
export type TourStop = StudioPoiState;

export interface TourTiming {
  /** Frame em que a câmera já está na primeira parada. */
  readonly startFrame: number;
  /** Frames voando de uma parada à seguinte. */
  readonly travelFrames: number;
  /** Frames parado em cada ponto, para o narrador falar. */
  readonly holdFrames: number;
}

export interface TourPropertyWrite {
  /** Caminho na prop do `studio.stage`, ex.: `props.azimuthDeg`. */
  readonly path: string;
  readonly keyframes: readonly Keyframe<number>[];
}

export interface CompiledTour {
  readonly writes: readonly TourPropertyWrite[];
  /** Frame do fim da última pausa. */
  readonly endFrame: number;
  readonly stops: number;
  readonly diagnostics: readonly string[];
}

/**
 * As seis props de câmera que uma visita escreve — as mesmas que o `studio.stage`
 * já anima. Nenhuma prop nova: é isso que faz o roteiro caber no que já existe.
 */
const CAMERA_PATHS = Object.freeze([
  "props.targetX",
  "props.targetY",
  "props.targetZ",
  "props.distanceMeters",
  "props.azimuthDeg",
  "props.elevationDeg",
] as const);

/** Aceleração e desaceleração do voo. Câmera que parte e chega em velocidade
 * constante parece um trilho de câmera de segurança, não uma apresentação. */
const EASE_OUT_HANDLE: readonly [number, number] = [0.42, 0];
const EASE_IN_HANDLE: readonly [number, number] = [0.58, 1];

export const MIN_TRAVEL_FRAMES = 1;
export const MIN_HOLD_FRAMES = 0;

function baseValue(props: Node["props"], key: string, fallback: number): number {
  const property = props[key] as AnimatableProperty<unknown> | undefined;
  const value = property?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * As paradas do roteiro, lidas do **documento** e na ordem das camadas.
 *
 * Duas escolhas que valem explicação.
 *
 * **Do documento, não de um frame avaliado.** Compilar a partir da cena de um
 * frame faria a câmera do vídeo inteiro depender de quais pontos estavam visíveis
 * no instante em que alguém clicou "compilar" — um roteiro que muda conforme o
 * playhead onde você estava parado. O valor lido é o `value` base da prop; um
 * ponto que alguém animou entra pela posição de repouso, que é a única resposta
 * estável.
 *
 * **A ordem é `topologicalOrder`, a mesma que o avaliador usa.** Assim o número
 * que aparece no marcador é o número da visita, e arrastar um ponto na lista de
 * camadas reordena o roteiro — um mecanismo que o usuário já conhece, em vez de
 * uma segunda lista para manter em sincronia.
 *
 * Ponto **desligado** fica de fora: é como se exclui uma parada sem perder o
 * ponto marcado.
 */
export function documentStudioPois(composition: Composition): readonly TourStop[] {
  const stops: TourStop[] = [];
  for (const id of topologicalOrder(composition)) {
    const node = composition.nodes[id];
    if (node === undefined || node.type !== "studio.poi" || node.enabled === false) continue;
    stops.push({
      id,
      name: node.name,
      point: [
        baseValue(node.props, "pointX", 0),
        baseValue(node.props, "pointY", 0),
        baseValue(node.props, "pointZ", 0),
      ],
      distanceMeters: Math.max(0.01, baseValue(node.props, "distanceMeters", 12)),
      azimuthDeg: baseValue(node.props, "azimuthDeg", 35),
      elevationDeg: Math.max(-89, Math.min(89, baseValue(node.props, "elevationDeg", 18))),
    });
  }
  return stops;
}

/**
 * Azimutes contínuos, sem atravessar a costura 0/360.
 *
 * Duas paradas em 350° e 10° estão a **vinte graus** uma da outra, e a
 * interpolação linear dos keyframes não sabe disso: ela vai de 350 até 10 pelo
 * caminho longo e a câmera dá uma volta de 340° em torno do objeto. É a mesma
 * família de defeito que derrubou a propriedade de `shortestAngleDelta`
 * (09-CONTINUIDADE § 4.17): régua linear sobre grandeza modular.
 *
 * A correção é desenrolar a sequência antes de escrever — cada azimute vira o
 * representante mais próximo do anterior, e aí a régua linear já está certa. Os
 * valores podem sair fora de [0, 360), e isso não é problema: `orbitCameraPosition`
 * usa seno e cosseno, que são periódicos.
 */
export function unwrapAzimuths(degrees: readonly number[]): readonly number[] {
  const result: number[] = [];
  let previous: number | null = null;
  for (const value of degrees) {
    if (previous === null) {
      previous = value;
    } else {
      previous = previous + shortestAngleDelta(previous, value);
    }
    result.push(previous);
  }
  return result;
}

/**
 * Os tempos do roteiro, lidos das props do nó do palco.
 *
 * Do documento pela mesma razão das paradas, e com os padrões do tipo de nó como
 * recuo: um palco criado antes destas props existirem não tem as três, e o
 * roteiro dele deve compilar assim mesmo em vez de emitir frames `NaN`.
 */
export function documentStudioTourTiming(
  composition: Composition,
  stageNodeId: string,
): TourTiming {
  const props = composition.nodes[stageNodeId]?.props ?? {};
  return {
    startFrame: baseValue(props, "tourStartFrame", 0),
    travelFrames: baseValue(props, "tourTravelFrames", 30),
    holdFrames: baseValue(props, "tourHoldFrames", 60),
  };
}

/**
 * Compila o roteiro.
 *
 * Cada parada recebe **dois** keyframes por prop: um na chegada e um na partida,
 * com o mesmo valor. É o par que produz a pausa — com um keyframe só, a câmera
 * chegaria e já começaria a sair, e não haveria tempo de falar do míssil.
 */
export function compileStudioTour(stops: readonly TourStop[], timing: TourTiming): CompiledTour {
  const diagnostics: string[] = [];
  if (stops.length === 0) {
    return Object.freeze({
      writes: Object.freeze([]),
      endFrame: Math.max(0, Math.round(timing.startFrame)),
      stops: 0,
      diagnostics: Object.freeze(["Nenhum ponto de interesse na composição."]),
    });
  }
  if (stops.length === 1) {
    diagnostics.push("Um ponto só: a câmera fica parada nele, sem voo.");
  }

  const start = Math.max(0, Math.round(timing.startFrame));
  const travel = Math.max(MIN_TRAVEL_FRAMES, Math.round(timing.travelFrames));
  const hold = Math.max(MIN_HOLD_FRAMES, Math.round(timing.holdFrames));
  const azimuths = unwrapAzimuths(stops.map((stop) => stop.azimuthDeg));

  const columns = new Map<string, Keyframe<number>[]>(CAMERA_PATHS.map((path) => [path, []]));

  stops.forEach((stop, index) => {
    const arrival = start + index * (hold + travel);
    const departure = arrival + hold;
    const values: Readonly<Record<(typeof CAMERA_PATHS)[number], number>> = {
      "props.targetX": stop.point[0],
      "props.targetY": stop.point[1],
      "props.targetZ": stop.point[2],
      "props.distanceMeters": stop.distanceMeters,
      "props.azimuthDeg": azimuths[index] ?? stop.azimuthDeg,
      "props.elevationDeg": stop.elevationDeg,
    };
    for (const path of CAMERA_PATHS) {
      const column = columns.get(path);
      if (column === undefined) continue;
      column.push({
        id: `tour:${String(index)}:${path}:in`,
        frame: arrival,
        value: values[path],
        // Chegada desacelera; a saída deste keyframe abre a pausa, onde o valor
        // é constante e a curva não importa.
        in: { kind: "bezier", handle: [...EASE_IN_HANDLE] },
        out: { kind: "linear" },
      });
      // Sem pausa, chegada e partida cairiam no mesmo frame e o segundo keyframe
      // sobrescreveria o primeiro — dois ids no mesmo frame é documento inválido.
      if (hold === 0) continue;
      column.push({
        id: `tour:${String(index)}:${path}:out`,
        frame: departure,
        value: values[path],
        in: { kind: "linear" },
        out: { kind: "bezier", handle: [...EASE_OUT_HANDLE] },
      });
    }
  });

  const writes = CAMERA_PATHS.map((path) => ({
    path,
    keyframes: Object.freeze(columns.get(path) ?? []),
  }));

  return Object.freeze({
    writes: Object.freeze(writes),
    endFrame: start + (stops.length - 1) * (hold + travel) + hold,
    stops: stops.length,
    diagnostics: Object.freeze(diagnostics),
  });
}
