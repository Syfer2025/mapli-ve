/**
 * Curvas de velocidade.
 *
 * O graph editor precisa mostrar duas coisas diferentes: o **valor** por frame e
 * a **velocidade** por frame. A segunda é o que revela tranco: uma curva de
 * valor pode parecer suave e ainda ter degrau na derivada.
 *
 * A derivada é numérica, por diferença central com passo fixo em frames. Passo
 * fixo é deliberado: o resultado não pode depender da ordem em que os frames
 * foram pedidos nem do zoom do painel.
 */

import type { AnimatableProperty } from "@theatrum/schema";
import { evaluateProperty } from "./property.js";
import { isVec2Value } from "./spatial.js";

/** Meio frame de cada lado; menor que isso amplifica ruído de ponto flutuante. */
const DERIVATIVE_STEP_FRAMES = 0.5;

export interface SpeedSample {
  readonly frame: number;
  /** Escalar para números; magnitude do vetor para posições. */
  readonly magnitude: number;
  /** Unidades por segundo. */
  readonly speed: number;
}

/**
 * Velocidade em unidades por segundo. Em propriedades vetoriais devolve a
 * magnitude — é a grandeza que prova velocidade uniforme num motion path.
 */
export function propertySpeed(
  property: AnimatableProperty<unknown>,
  frame: number,
  fps: number,
): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  const before = magnitudeAt(property, frame - DERIVATIVE_STEP_FRAMES);
  const after = magnitudeAt(property, frame + DERIVATIVE_STEP_FRAMES);
  if (before === null || after === null) return 0;
  const deltaFrames = DERIVATIVE_STEP_FRAMES * 2;
  return (distance(before, after) / deltaFrames) * fps;
}

/**
 * Amostra velocidade em passo inteiro de frame. `to` é inclusivo para que a
 * curva alcance o último keyframe.
 */
export function sampleSpeedCurve(
  property: AnimatableProperty<unknown>,
  from: number,
  to: number,
  fps: number,
  step = 1,
): readonly SpeedSample[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || step <= 0 || to < from) {
    return Object.freeze([]);
  }
  const samples: SpeedSample[] = [];
  for (let frame = from; frame <= to; frame += step) {
    const value = magnitudeAt(property, frame);
    samples.push(
      Object.freeze({
        frame,
        magnitude: value === null ? 0 : scalarMagnitude(value),
        speed: propertySpeed(property, frame, fps),
      }),
    );
  }
  return Object.freeze(samples);
}

/**
 * Coeficiente de variação da velocidade em [from, to]. Zero significa velocidade
 * constante; é o número que o critério 1 da Fase 5 cobra do motion path.
 */
export function speedUniformity(
  property: AnimatableProperty<unknown>,
  from: number,
  to: number,
  fps: number,
): {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly variation: number;
} {
  const speeds = sampleSpeedCurve(property, from, to, fps).map((sample) => sample.speed);
  if (speeds.length === 0) {
    return Object.freeze({ mean: 0, min: 0, max: 0, variation: 0 });
  }
  const mean = speeds.reduce((total, speed) => total + speed, 0) / speeds.length;
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const variance = speeds.reduce((total, speed) => total + (speed - mean) ** 2, 0) / speeds.length;
  return Object.freeze({
    mean,
    min,
    max,
    variation: mean === 0 ? 0 : Math.sqrt(variance) / mean,
  });
}

type Numeric = number | readonly [number, number];

function magnitudeAt(property: AnimatableProperty<unknown>, frame: number): Numeric | null {
  const value = evaluateProperty(property, frame);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isVec2Value(value)) return value;
  return null;
}

function scalarMagnitude(value: Numeric): number {
  return typeof value === "number" ? value : Math.hypot(value[0], value[1]);
}

function distance(from: Numeric, to: Numeric): number {
  if (typeof from === "number" && typeof to === "number") return Math.abs(to - from);
  if (typeof from !== "number" && typeof to !== "number") {
    return Math.hypot(to[0] - from[0], to[1] - from[1]);
  }
  return Math.abs(scalarMagnitude(to) - scalarMagnitude(from));
}
