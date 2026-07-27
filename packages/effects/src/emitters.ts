/**
 * Os nove emissores da Fase 6.
 *
 * Cada um é uma **parametrização da mesma forma fechada** — muda contagem,
 * distribuição de velocidade, gravidade, paleta, fade e blend, não a matemática.
 * Isso é o que mantém um único caminho de código na GPU: um draw call por
 * instância de efeito, com o mesmo shader para explosão e para fumaça.
 */

import { ColorSchema } from "@theatrum/schema";
import type { PropertyDescriptor } from "@theatrum/scene-graph";
import { z } from "zod";
import type { EffectDefinition, EffectSpec, ParticleSystemSpec } from "./contracts.js";
import { animatable, animatableOrValue, colorOf, numberOf } from "./params.js";

const CountSchema = animatableOrValue(z.number().int().min(1).max(20_000));
const PositiveSchema = animatableOrValue(z.number().finite().positive());
const UnitSchema = animatableOrValue(z.number().finite().min(0).max(4));

const CommonParamsSchema = z
  .object({
    count: CountSchema,
    /** Multiplica velocidades; 1 é o tamanho de referência do emissor. */
    scale: PositiveSchema,
    lifetime: PositiveSchema,
    intensity: UnitSchema,
    tint: animatableOrValue(ColorSchema),
  })
  .passthrough();

type CommonParams = z.infer<typeof CommonParamsSchema>;

const COMMON_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  {
    path: "params.count",
    label: "Partículas",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: false,
    min: 1,
    max: 20_000,
    step: 50,
  },
  {
    path: "params.scale",
    label: "Escala",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 0.05,
    step: 0.05,
    unit: "ratio",
  },
  {
    path: "params.lifetime",
    label: "Duração",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 1,
    step: 1,
    unit: "px",
  },
  {
    path: "params.intensity",
    label: "Intensidade",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 4,
    step: 0.05,
  },
  {
    path: "params.tint",
    label: "Tonalidade",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  },
]);

interface EmitterShape {
  readonly type: string;
  readonly label: string;
  readonly motion: ParticleSystemSpec["motion"];
  readonly fade: ParticleSystemSpec["fade"];
  readonly emission: ParticleSystemSpec["emission"];
  readonly blend: ParticleSystemSpec["blend"];
  readonly palette: readonly string[];
  readonly count: number;
  readonly lifetime: number;
  readonly emissionFrames: number;
  readonly wobble: number;
  readonly wobbleHz: number;
}

/**
 * Cada emissor é uma linha desta tabela. Um emissor novo é uma entrada aqui e
 * uma linha no registro — nenhuma ramificação nova em GPU, painel ou timeline.
 */
const SHAPES: readonly EmitterShape[] = Object.freeze([
  {
    type: "explosion",
    label: "Explosão",
    motion: "ballistic",
    fade: "out",
    emission: "burst",
    blend: "add",
    palette: ["#fff2c4", "#ffb347", "#ff6a2b", "#8c3216"],
    count: 5000,
    lifetime: 42,
    emissionFrames: 0,
    wobble: 6,
    wobbleHz: 0,
  },
  {
    type: "smoke",
    label: "Fumaça",
    motion: "drift",
    fade: "in-out",
    emission: "continuous",
    blend: "normal",
    palette: ["#6b6b6b", "#8a8a8a", "#4a4a4a", "#a3a3a3"],
    count: 900,
    lifetime: 150,
    emissionFrames: 120,
    wobble: 14,
    wobbleHz: 0.35,
  },
  {
    type: "fire",
    label: "Fogo",
    motion: "drift",
    fade: "out",
    emission: "continuous",
    blend: "add",
    palette: ["#ffe08a", "#ffa428", "#ff5c1a", "#b32b0c"],
    count: 1400,
    lifetime: 34,
    emissionFrames: 90,
    wobble: 7,
    wobbleHz: 1.6,
  },
  {
    type: "trail",
    label: "Rastro",
    motion: "trail",
    fade: "out",
    emission: "continuous",
    blend: "normal",
    palette: ["#d7d7d7", "#9fa8b0", "#6f7a82"],
    count: 700,
    lifetime: 60,
    emissionFrames: 240,
    wobble: 3,
    wobbleHz: 0.2,
  },
  {
    type: "contrail",
    label: "Esteira de condensação",
    motion: "trail",
    fade: "hold",
    emission: "continuous",
    blend: "screen",
    palette: ["#f2f6ff", "#dbe6f5"],
    count: 1200,
    lifetime: 300,
    emissionFrames: 300,
    wobble: 2,
    wobbleHz: 0.1,
  },
  {
    type: "shockwave",
    label: "Onda de choque",
    motion: "radial",
    fade: "flash",
    emission: "burst",
    blend: "add",
    palette: ["#ffffff", "#ffe9c9"],
    count: 480,
    lifetime: 22,
    emissionFrames: 0,
    wobble: 0,
    wobbleHz: 0,
  },
  {
    type: "sparks",
    label: "Faíscas",
    motion: "ballistic",
    fade: "flash",
    emission: "burst",
    blend: "add",
    palette: ["#fff8d6", "#ffd166", "#ff9f1c"],
    count: 320,
    lifetime: 50,
    emissionFrames: 0,
    wobble: 4,
    wobbleHz: 0,
  },
  {
    type: "water",
    label: "Água",
    motion: "ballistic",
    fade: "out",
    emission: "burst",
    blend: "screen",
    palette: ["#cfe8ff", "#8fbfe8", "#5b8db3"],
    count: 900,
    lifetime: 55,
    emissionFrames: 0,
    wobble: 5,
    wobbleHz: 0,
  },
  {
    type: "dust",
    label: "Poeira",
    motion: "drift",
    fade: "in-out",
    emission: "continuous",
    blend: "normal",
    palette: ["#b9a88a", "#cdbfa4", "#8d7f68"],
    count: 600,
    lifetime: 180,
    emissionFrames: 150,
    wobble: 18,
    wobbleHz: 0.25,
  },
]);

/**
 * Multiplica a paleta pela tonalidade, canal a canal. Branco (`#ffffff`) devolve
 * a paleta intacta — mesma referência, sem custo. Fora daqui a tonalidade não
 * toca em nada: o shader continua recebendo só `#rrggbb` por partícula.
 */
function tintPalette(palette: readonly string[], tint: unknown): readonly string[] {
  const t = colorOf(tint, "#ffffff");
  const tr = Number.parseInt(t.slice(1, 3), 16);
  const tg = Number.parseInt(t.slice(3, 5), 16);
  const tb = Number.parseInt(t.slice(5, 7), 16);
  if (tr === 255 && tg === 255 && tb === 255) return palette;
  return Object.freeze(
    palette.map((hex) => {
      const c = colorOf(hex, "#ffffff");
      const r = Math.round((Number.parseInt(c.slice(1, 3), 16) * tr) / 255);
      const g = Math.round((Number.parseInt(c.slice(3, 5), 16) * tg) / 255);
      const b = Math.round((Number.parseInt(c.slice(5, 7), 16) * tb) / 255);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }),
  );
}

function defineEmitter(shape: EmitterShape): EffectDefinition<CommonParams> {
  const defaults = CommonParamsSchema.parse({
    count: animatable(shape.count),
    scale: animatable(1),
    lifetime: animatable(shape.lifetime),
    intensity: animatable(1),
    tint: animatable("#ffffffff"),
  });

  return Object.freeze({
    type: shape.type,
    label: shape.label,
    kind: "particles" as const,
    paramSchema: CommonParamsSchema,
    defaultParams: defaults,
    properties: COMMON_PROPERTIES,

    spec(params: CommonParams, seed: number, fps: number): EffectSpec {
      const scale = Math.max(0.05, numberOf(params.scale, 1));
      const lifetime = Math.max(1, numberOf(params.lifetime, shape.lifetime));
      const particles: ParticleSystemSpec = Object.freeze({
        count: Math.max(1, Math.round(numberOf(params.count, shape.count))),
        emission: shape.emission,
        motion: shape.motion,
        fade: shape.fade,
        emissionFrames: shape.emissionFrames,
        lifetime,
        palette: tintPalette(shape.palette, params.tint),
        blend: shape.blend,
        wobble: shape.wobble * scale,
        wobbleHz: shape.wobbleHz,
        seed,
        fps: fps > 0 ? fps : 60,
      });
      return Object.freeze({ kind: "particles", particles });
    },
  });
}

export const BUILTIN_EMITTER_TYPES = Object.freeze(SHAPES.map((shape) => shape.type));

export const BUILTIN_EMITTERS: readonly EffectDefinition<never>[] = Object.freeze(
  SHAPES.map((shape) => defineEmitter(shape)) as unknown as readonly EffectDefinition<never>[],
);

export type EmitterParams = CommonParams;
export { CommonParamsSchema as EmitterParamsSchema };
