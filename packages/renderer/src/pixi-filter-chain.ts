/**
 * Cadeia de filtros de um nó no backend Pixi.
 *
 * A regra que governa este arquivo: **o objeto de filtro é criado uma vez e
 * depois só recebe uniforms**. Trocar um valor de parâmetro a cada frame não pode
 * recompilar shader nem realocar textura, senão animar um raio de brilho custaria
 * mais que a animação inteira. A cadeia só é reconstruída quando a *sequência de
 * tipos* muda — que é exatamente quando o usuário adiciona, remove ou reordena um
 * filtro no painel.
 *
 * `padding` é o outro cuidado: brilho e sombra desenham fora do retângulo do nó,
 * e sem folga o Pixi recorta o halo na borda da região do filtro. A folga sai do
 * raio e do deslocamento em vigor, e por isso é reavaliada junto com os uniforms.
 */

import type * as PixiTypes from "pixi.js";
import { colorGradeMatrix, isIdentityColorMatrix } from "./color-grade.js";
import type { ScreenFilter } from "./contracts.js";
import {
  CHROMATIC_FRAGMENT_SHADER,
  FILTER_VERTEX_SHADER,
  GLOW_FRAGMENT_SHADER,
  hexToRgbTriple,
  OUTLINE_FRAGMENT_SHADER,
  SHADOW_FRAGMENT_SHADER,
} from "./filter-shaders.js";

type PixiModule = typeof PixiTypes;
type Filter = PixiTypes.Filter;

/** Tipos que este backend materializa. Um tipo fora da lista é ignorado. */
export const SUPPORTED_FILTER_TYPES: readonly string[] = Object.freeze([
  "glow",
  "blur",
  "drop-shadow",
  "color-grade",
  "outline",
  "chromatic",
]);

export interface FilterChain {
  /** Assinatura de tipos em vigor; usada para decidir se reconstrói. */
  readonly signature: string;
  readonly filters: readonly Filter[];
}

function usableTypes(specs: readonly ScreenFilter[]): string[] {
  return specs
    .filter((spec) => SUPPORTED_FILTER_TYPES.includes(spec.type))
    .map((spec) => spec.type);
}

function param(spec: ScreenFilter, name: string, fallback: number): number {
  const value = spec.params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Programa GL de um filtro próprio, montado com o vertex padrão do Pixi. */
function ownFilter(module: PixiModule, name: string, fragment: string, uniforms: object): Filter {
  return new module.Filter({
    glProgram: module.GlProgram.from({
      vertex: FILTER_VERTEX_SHADER,
      fragment,
      name: `theatrum-${name}`,
    }),
    resources: {
      filterUniforms: new module.UniformGroup(uniforms as Record<string, never>),
    },
  });
}

function createFilter(module: PixiModule, type: string): Filter | undefined {
  switch (type) {
    case "glow":
      return ownFilter(module, "glow", GLOW_FRAGMENT_SHADER, {
        uTint: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
        uRadius: { value: 10, type: "f32" },
        uStrength: { value: 1, type: "f32" },
      });
    case "drop-shadow":
      return ownFilter(module, "shadow", SHADOW_FRAGMENT_SHADER, {
        uTint: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" },
        uOffset: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        uRadius: { value: 8, type: "f32" },
        uShadowOpacity: { value: 0.75, type: "f32" },
      });
    case "outline":
      return ownFilter(module, "outline", OUTLINE_FRAGMENT_SHADER, {
        uTint: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
        uThickness: { value: 2, type: "f32" },
      });
    case "chromatic":
      return ownFilter(module, "chromatic", CHROMATIC_FRAGMENT_SHADER, {
        uShift: { value: new Float32Array([2, 0]), type: "vec2<f32>" },
      });
    case "blur":
      return new module.BlurFilter({ strength: 8, quality: 3 });
    case "color-grade":
      return new module.ColorMatrixFilter();
    default:
      return undefined;
  }
}

function uniformsOf(filter: Filter): Record<string, unknown> | undefined {
  const group = (filter.resources as Record<string, unknown> | undefined)?.["filterUniforms"];
  if (typeof group !== "object" || group === null) return undefined;
  const uniforms = (group as { readonly uniforms?: unknown }).uniforms;
  return typeof uniforms === "object" && uniforms !== null
    ? (uniforms as Record<string, unknown>)
    : undefined;
}

function writeVec(
  uniforms: Record<string, unknown>,
  name: string,
  values: readonly number[],
): void {
  const target = uniforms[name];
  if (target instanceof Float32Array) {
    for (let index = 0; index < values.length && index < target.length; index += 1) {
      target[index] = values[index] ?? 0;
    }
  }
}

/**
 * Escreve os uniforms do frame e devolve a folga em pixels que o passe precisa.
 *
 * A folga é calculada do parâmetro, não fixa: um brilho de raio 2 não paga o
 * custo de textura de um brilho de raio 200.
 */
function applyParams(filter: Filter, spec: ScreenFilter): number {
  switch (spec.type) {
    case "glow": {
      const uniforms = uniformsOf(filter);
      const radius = Math.max(0, param(spec, "radius", 10));
      if (uniforms !== undefined) {
        writeVec(uniforms, "uTint", hexToRgbTriple(spec.color));
        uniforms["uRadius"] = radius;
        uniforms["uStrength"] = Math.max(0, param(spec, "strength", 1));
      }
      return radius + 2;
    }
    case "drop-shadow": {
      const uniforms = uniformsOf(filter);
      const offsetX = param(spec, "offsetX", 0);
      const offsetY = param(spec, "offsetY", 0);
      const radius = Math.max(0, param(spec, "radius", 8));
      if (uniforms !== undefined) {
        writeVec(uniforms, "uTint", hexToRgbTriple(spec.color));
        writeVec(uniforms, "uOffset", [offsetX, offsetY]);
        uniforms["uRadius"] = radius;
        uniforms["uShadowOpacity"] = Math.min(1, Math.max(0, param(spec, "opacity", 0.75)));
      }
      return Math.max(Math.abs(offsetX), Math.abs(offsetY)) + radius + 2;
    }
    case "outline": {
      const uniforms = uniformsOf(filter);
      const thickness = Math.max(0, param(spec, "thickness", 2));
      if (uniforms !== undefined) {
        writeVec(uniforms, "uTint", hexToRgbTriple(spec.color));
        uniforms["uThickness"] = thickness;
      }
      return thickness + 2;
    }
    case "chromatic": {
      const uniforms = uniformsOf(filter);
      const offset = param(spec, "offset", 2);
      const angle = (param(spec, "angle", 0) * Math.PI) / 180;
      if (uniforms !== undefined) {
        writeVec(uniforms, "uShift", [Math.cos(angle) * offset, Math.sin(angle) * offset]);
      }
      return Math.abs(offset) + 2;
    }
    case "blur": {
      const blur = filter as PixiTypes.BlurFilter;
      const radius = Math.max(0, param(spec, "radius", 8));
      blur.strength = radius;
      blur.quality = Math.min(8, Math.max(1, Math.round(param(spec, "quality", 3))));
      // O desfoque do Pixi já dimensiona a própria folga a partir da força.
      return 0;
    }
    case "color-grade": {
      const grade = filter as PixiTypes.ColorMatrixFilter;
      const matrix = colorGradeMatrix({
        exposure: param(spec, "exposure", 0),
        contrast: param(spec, "contrast", 0),
        saturation: param(spec, "saturation", 0),
        temperature: param(spec, "temperature", 0),
      });
      grade.matrix = [...matrix];
      // Matriz identidade: mantém o filtro montado, mas ele não muda pixel.
      grade.enabled = !isIdentityColorMatrix(matrix);
      return 0;
    }
    default:
      return 0;
  }
}

/**
 * Sincroniza a cadeia de um nó com a especificação do frame.
 *
 * Devolve `undefined` quando não há filtro aplicável — o chamador então limpa
 * `container.filters`, e o nó volta a ser desenhado direto, sem textura
 * intermediária.
 */
export function syncFilterChain(
  module: PixiModule,
  previous: FilterChain | undefined,
  specs: readonly ScreenFilter[] | undefined,
): FilterChain | undefined {
  const chainSpecs = (specs ?? []).filter((spec) => SUPPORTED_FILTER_TYPES.includes(spec.type));
  if (chainSpecs.length === 0) return undefined;

  const signature = usableTypes(chainSpecs).join(",");
  const chain =
    previous !== undefined && previous.signature === signature
      ? previous
      : {
          signature,
          filters: chainSpecs
            .map((spec) => createFilter(module, spec.type))
            .filter((filter): filter is Filter => filter !== undefined),
        };

  let padding = 0;
  for (let index = 0; index < chain.filters.length; index += 1) {
    const filter = chain.filters[index];
    const spec = chainSpecs[index];
    if (filter === undefined || spec === undefined) continue;
    padding = Math.max(padding, applyParams(filter, spec));
  }
  // A folga é comum à cadeia: o passe que precisa de mais espaço manda.
  for (const filter of chain.filters) {
    if (padding > filter.padding) filter.padding = padding;
  }

  return chain;
}

/** Libera os shaders da cadeia. Chamado ao desmontar o nó. */
export function destroyFilterChain(chain: FilterChain | undefined): void {
  if (chain === undefined) return;
  for (const filter of chain.filters) filter.destroy();
}
