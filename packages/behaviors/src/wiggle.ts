/**
 * `wiggle` — oscilação pseudoaleatória determinística.
 *
 * Não usa `Math.random`: o valor sai de `hash32` sobre `(seed, canal, célula)`,
 * interpolado com smoothstep entre células de tempo. Mesma semente e mesmo frame
 * dão sempre o mesmo deslocamento, em qualquer máquina — condição para o export
 * bater com a pré-visualização frame a frame.
 *
 * A contribuição é **somada** à posição avaliada (`positionOffset`), então wiggle
 * conviva com keyframes ou com um motion path em vez de sobrescrevê-los.
 */

import type { Vec2 } from "@theatrum/core-math";
import { hash32 } from "@theatrum/core-utils";
import { Vec2Schema, type Node } from "@theatrum/schema";
import { z } from "zod";
import {
  type BehaviorContext,
  type BehaviorDefinition,
  type PropertyContribution,
} from "./contracts.js";

export const WiggleParamsSchema = z
  .object({
    /** Amplitude por eixo, na unidade da propriedade (px de tela). */
    amplitude: Vec2Schema,
    /** Oscilações por segundo. */
    frequency: z.number().finite().positive(),
    /** Camadas de ruído; cada uma dobra a frequência e reduz a amplitude. */
    octaves: z.number().int().min(1).max(4),
    seed: z.number().int(),
    /** Graus de oscilação em rotação. */
    rotationAmplitude: z.number().finite(),
  })
  .strict();

export type WiggleParams = z.infer<typeof WiggleParamsSchema>;

export const WIGGLE_DEFAULTS: WiggleParams = Object.freeze({
  amplitude: [6, 6] as [number, number],
  frequency: 2,
  octaves: 2,
  seed: 1,
  rotationAmplitude: 0,
});

export const wiggleBehavior: BehaviorDefinition<WiggleParams> = Object.freeze({
  type: "wiggle",
  label: "Oscilar",
  paramSchema: WiggleParamsSchema,
  defaultParams: WIGGLE_DEFAULTS,

  contribute(
    node: Node,
    params: WiggleParams,
    frame: number,
    context: BehaviorContext,
  ): PropertyContribution {
    const seconds = frame / (context.fps > 0 ? context.fps : 60);
    const seed = hash32(node.id, params.seed >>> 0);
    const offset: Vec2 = [
      params.amplitude[0] * fractalNoise(seed, 0, seconds * params.frequency, params.octaves),
      params.amplitude[1] * fractalNoise(seed, 1, seconds * params.frequency, params.octaves),
    ];
    if (params.rotationAmplitude === 0) return { positionOffset: offset };
    return {
      positionOffset: offset,
      rotationOffset:
        params.rotationAmplitude *
        fractalNoise(seed, 2, seconds * params.frequency, params.octaves),
    };
  },
});

/** Soma de oitavas em [-1, 1]; a amplitude cai pela metade a cada oitava. */
export function fractalNoise(seed: number, channel: number, time: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(seed, channel + octave * 977, time * 2 ** octave) * amplitude;
    normalization += amplitude;
    amplitude /= 2;
  }
  return normalization === 0 ? 0 : total / normalization;
}

/** Ruído de valor 1D em [-1, 1], contínuo e com derivada contínua nas células. */
export function valueNoise(seed: number, channel: number, time: number): number {
  const cell = Math.floor(time);
  const fraction = time - cell;
  const from = cellValue(seed, channel, cell);
  const to = cellValue(seed, channel, cell + 1);
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return from + (to - from) * smooth;
}

function cellValue(seed: number, channel: number, cell: number): number {
  // Negativos entram no hash como texto próprio, então -1 e 1 não colidem.
  const hashed = hash32(`${channel}:${cell}`, seed);
  return (hashed / 0xffffffff) * 2 - 1;
}
