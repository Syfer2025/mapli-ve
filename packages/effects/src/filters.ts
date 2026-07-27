/**
 * Os seis filtros da Fase 6.
 *
 * Filtro é passe de imagem sobre o nó já desenhado, não geometria — por isso a
 * especificação sai daqui em forma neutra (`FilterSpec`) e o backend decide como
 * materializar. Blur e correção de cor têm implementação de núcleo no Pixi;
 * brilho, sombra, contorno e aberração cromática são shaders próprios do projeto,
 * escritos em vez de trazer `pixi-filters` — uma dependência a menos, e controle
 * sobre o que roda por pixel.
 *
 * Todos os parâmetros são números ou cor: nenhum depende de tempo real nem de
 * estado do frame anterior, então o passe é tão determinístico quanto as
 * partículas.
 */

import { ColorSchema } from "@theatrum/schema";
import type { PropertyDescriptor } from "@theatrum/scene-graph";
import { z } from "zod";
import type { EffectDefinition, EffectSpec, FilterSpec } from "./contracts.js";
import { animatable, animatableOrValue, colorOf, numberOf } from "./params.js";

function numberProperty(
  path: string,
  label: string,
  extra: Partial<PropertyDescriptor> = {},
): PropertyDescriptor {
  return {
    path,
    label,
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    ...extra,
  };
}

function colorProperty(path: string, label: string): PropertyDescriptor {
  return {
    path,
    label,
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  };
}

const Amount = animatableOrValue(z.number().finite().min(0).max(8));
const Radius = animatableOrValue(z.number().finite().min(0).max(200));
const Signed = animatableOrValue(z.number().finite().min(-200).max(200));
const Unit = animatableOrValue(z.number().finite().min(-2).max(2));

interface FilterShape<P extends z.ZodType> {
  readonly type: FilterSpec["type"];
  readonly label: string;
  readonly paramSchema: P;
  readonly defaults: z.infer<P>;
  readonly properties: readonly PropertyDescriptor[];
  toSpec(params: z.infer<P>): FilterSpec;
}

const GlowParams = z
  .object({ radius: Radius, strength: Amount, tint: animatableOrValue(ColorSchema) })
  .passthrough();

const BlurParams = z.object({ radius: Radius, quality: Amount }).passthrough();

const ShadowParams = z
  .object({
    offsetX: Signed,
    offsetY: Signed,
    radius: Radius,
    opacity: Amount,
    tint: animatableOrValue(ColorSchema),
  })
  .passthrough();

const GradeParams = z
  .object({ exposure: Unit, contrast: Unit, saturation: Unit, temperature: Unit })
  .passthrough();

const OutlineParams = z
  .object({ thickness: Radius, tint: animatableOrValue(ColorSchema) })
  .passthrough();

const ChromaticParams = z.object({ offset: Signed, angle: Signed }).passthrough();

/**
 * Cada filtro é uma linha desta tabela. Um filtro novo entra com uma entrada
 * aqui, uma linha no registro e um caso no backend — mesmo padrão dos emissores.
 */
const SHAPES = Object.freeze([
  {
    type: "glow",
    label: "Brilho",
    paramSchema: GlowParams,
    defaults: GlowParams.parse({
      radius: animatable(14),
      strength: animatable(1.4),
      tint: animatable("#ffd9a0ff"),
    }),
    properties: [
      numberProperty("params.radius", "Raio", { min: 0, max: 200, step: 1, unit: "px" }),
      numberProperty("params.strength", "Força", { min: 0, max: 8, step: 0.05 }),
      colorProperty("params.tint", "Tonalidade"),
    ],
    toSpec: (params) => ({
      type: "glow" as const,
      params: {
        radius: numberOf(params.radius, 14),
        strength: numberOf(params.strength, 1.4),
      },
      color: colorOf(params.tint, "#ffd9a0"),
    }),
  } satisfies FilterShape<typeof GlowParams>,
  {
    type: "blur",
    label: "Desfoque",
    paramSchema: BlurParams,
    defaults: BlurParams.parse({ radius: animatable(8), quality: animatable(3) }),
    properties: [
      numberProperty("params.radius", "Raio", { min: 0, max: 200, step: 1, unit: "px" }),
      numberProperty("params.quality", "Qualidade", { min: 1, max: 8, step: 1 }),
    ],
    toSpec: (params) => ({
      type: "blur" as const,
      params: {
        radius: numberOf(params.radius, 8),
        quality: Math.max(1, Math.round(numberOf(params.quality, 3))),
      },
      color: "#000000",
    }),
  } satisfies FilterShape<typeof BlurParams>,
  {
    type: "drop-shadow",
    label: "Sombra projetada",
    paramSchema: ShadowParams,
    defaults: ShadowParams.parse({
      offsetX: animatable(6),
      offsetY: animatable(8),
      radius: animatable(10),
      opacity: animatable(0.75),
      tint: animatable("#000000ff"),
    }),
    properties: [
      numberProperty("params.offsetX", "Deslocamento X", { step: 1, unit: "px" }),
      numberProperty("params.offsetY", "Deslocamento Y", { step: 1, unit: "px" }),
      numberProperty("params.radius", "Raio", { min: 0, max: 200, step: 1, unit: "px" }),
      numberProperty("params.opacity", "Opacidade", { min: 0, max: 1, step: 0.05 }),
      colorProperty("params.tint", "Cor"),
    ],
    toSpec: (params) => ({
      type: "drop-shadow" as const,
      params: {
        offsetX: numberOf(params.offsetX, 6),
        offsetY: numberOf(params.offsetY, 8),
        radius: numberOf(params.radius, 10),
        opacity: numberOf(params.opacity, 0.75),
      },
      color: colorOf(params.tint, "#000000"),
    }),
  } satisfies FilterShape<typeof ShadowParams>,
  {
    type: "color-grade",
    label: "Correção de cor",
    paramSchema: GradeParams,
    defaults: GradeParams.parse({
      exposure: animatable(0),
      contrast: animatable(0),
      saturation: animatable(0),
      temperature: animatable(0),
    }),
    properties: [
      numberProperty("params.exposure", "Exposição", { min: -2, max: 2, step: 0.02 }),
      numberProperty("params.contrast", "Contraste", { min: -2, max: 2, step: 0.02 }),
      numberProperty("params.saturation", "Saturação", { min: -2, max: 2, step: 0.02 }),
      numberProperty("params.temperature", "Temperatura", { min: -2, max: 2, step: 0.02 }),
    ],
    toSpec: (params) => ({
      type: "color-grade" as const,
      params: {
        exposure: numberOf(params.exposure, 0),
        contrast: numberOf(params.contrast, 0),
        saturation: numberOf(params.saturation, 0),
        temperature: numberOf(params.temperature, 0),
      },
      color: "#000000",
    }),
  } satisfies FilterShape<typeof GradeParams>,
  {
    type: "outline",
    label: "Contorno",
    paramSchema: OutlineParams,
    defaults: OutlineParams.parse({
      thickness: animatable(2),
      tint: animatable("#ffffffff"),
    }),
    properties: [
      numberProperty("params.thickness", "Espessura", { min: 0, max: 40, step: 0.5, unit: "px" }),
      colorProperty("params.tint", "Cor"),
    ],
    toSpec: (params) => ({
      type: "outline" as const,
      params: { thickness: numberOf(params.thickness, 2) },
      color: colorOf(params.tint, "#ffffff"),
    }),
  } satisfies FilterShape<typeof OutlineParams>,
  {
    type: "chromatic",
    label: "Aberração cromática",
    paramSchema: ChromaticParams,
    defaults: ChromaticParams.parse({ offset: animatable(2), angle: animatable(0) }),
    properties: [
      numberProperty("params.offset", "Deslocamento", { min: -40, max: 40, step: 0.5, unit: "px" }),
      numberProperty("params.angle", "Ângulo", { min: -180, max: 180, step: 1, unit: "degrees" }),
    ],
    toSpec: (params) => ({
      type: "chromatic" as const,
      params: {
        offset: numberOf(params.offset, 2),
        angle: numberOf(params.angle, 0),
      },
      color: "#000000",
    }),
  } satisfies FilterShape<typeof ChromaticParams>,
] as const);

function defineFilter<P extends z.ZodType>(shape: FilterShape<P>): EffectDefinition<z.infer<P>> {
  return Object.freeze({
    type: shape.type,
    label: shape.label,
    kind: "filter" as const,
    paramSchema: shape.paramSchema as z.ZodType<z.infer<P>>,
    defaultParams: shape.defaults,
    properties: Object.freeze(shape.properties),
    spec(params: z.infer<P>): EffectSpec {
      return Object.freeze({ kind: "filter", filter: Object.freeze(shape.toSpec(params)) });
    },
  });
}

export const BUILTIN_FILTER_TYPES = Object.freeze(SHAPES.map((shape) => shape.type));

export const BUILTIN_FILTERS: readonly EffectDefinition<never>[] = Object.freeze(
  SHAPES.map((shape) =>
    defineFilter(shape as unknown as FilterShape<z.ZodType>),
  ) as unknown as readonly EffectDefinition<never>[],
);
