/**
 * Keyframe assistants.
 *
 * `easyEase` é o atalho que todo editor tem: achata a velocidade na entrada e/ou
 * na saída do keyframe sem abrir o graph editor.
 *
 * `roving` resolve outro problema. Com keyframes espaçados à mão num caminho
 * curvo, o objeto muda de velocidade a cada trecho. Marcar os keyframes
 * intermediários como roving reposiciona-os **no tempo** — mantendo posição —
 * para que a distância percorrida por frame fique constante.
 *
 * Limite honesto: `FrameSchema` é inteiro, então a redistribuição é quantizada
 * em frames cheios. Em trilhas curtas isso deixa um resíduo de variação; o
 * caminho contínuo de verdade é o motion path com tabela de arco (`behaviors`).
 */

import { cubicLength } from "@theatrum/core-math";
import type { AnimatableProperty, EasingHandle, Keyframe } from "@theatrum/schema";
import { spatialSegment, isVec2Value } from "./spatial.js";

export type EaseSide = "in" | "out" | "both";

/** Handles do easy ease clássico: 33% de influência, velocidade zero na ponta. */
const EASY_EASE_OUT: readonly [number, number] = [1 / 3, 0];
const EASY_EASE_IN: readonly [number, number] = [2 / 3, 1];

export function applyEasyEase<T>(
  property: AnimatableProperty<T>,
  keyframeId: string,
  side: EaseSide = "both",
): AnimatableProperty<T> {
  return {
    ...property,
    keyframes: property.keyframes.map((keyframe) => {
      if (keyframe.id !== keyframeId) return keyframe;
      const next: Keyframe<T> = { ...keyframe };
      if (side === "out" || side === "both") next.out = bezier(EASY_EASE_OUT);
      if (side === "in" || side === "both") next.in = bezier(EASY_EASE_IN);
      return next;
    }),
  };
}

export function setKeyframeRoving<T>(
  property: AnimatableProperty<T>,
  keyframeId: string,
  roving: boolean,
): AnimatableProperty<T> {
  const index = property.keyframes.findIndex((keyframe) => keyframe.id === keyframeId);
  // O primeiro e o último keyframe ancoram o intervalo: não podem rovar, senão
  // não há tempo fixo de referência para redistribuir.
  if (index <= 0 || index >= property.keyframes.length - 1) return property;
  return {
    ...property,
    keyframes: property.keyframes.map((keyframe, position) =>
      position === index ? { ...keyframe, roving } : keyframe,
    ),
  };
}

/**
 * Reposiciona no tempo todo keyframe roving de uma propriedade de posição, de
 * modo que a velocidade fique tão uniforme quanto a grade de frames permite.
 * Os valores e os handles não mudam — só `frame`.
 */
export function redistributeRovingKeyframes<T>(
  property: AnimatableProperty<T>,
): AnimatableProperty<T> {
  const keyframes = property.keyframes;
  if (keyframes.length < 3) return property;
  if (!keyframes.some((keyframe) => keyframe.roving === true)) return property;
  if (!keyframes.every((keyframe) => isVec2Value(keyframe.value))) return property;

  const lengths = segmentLengths(keyframes);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined || total <= 0) return property;
  const span = last.frame - first.frame;
  if (span <= 0) return property;

  let travelled = 0;
  const next: Keyframe<T>[] = [{ ...first }];
  for (let index = 1; index < keyframes.length - 1; index += 1) {
    const keyframe = keyframes[index];
    travelled += lengths[index - 1] ?? 0;
    if (keyframe === undefined) continue;
    if (keyframe.roving !== true) {
      next.push({ ...keyframe });
      continue;
    }
    // Clamp entre os vizinhos já resolvidos e o fim, para nunca inverter ordem
    // nem colidir de frame — o schema rejeita ambos.
    const previousFrame = next[next.length - 1]?.frame ?? first.frame;
    const remaining = keyframes.length - 1 - index;
    const ideal = first.frame + Math.round((travelled / total) * span);
    const frame = Math.min(Math.max(ideal, previousFrame + 1), last.frame - remaining);
    next.push({ ...keyframe, frame });
  }
  next.push({ ...last });

  return { ...property, keyframes: next };
}

function segmentLengths<T>(keyframes: readonly Keyframe<T>[]): readonly number[] {
  const lengths: number[] = [];
  for (let index = 0; index + 1 < keyframes.length; index += 1) {
    const left = keyframes[index];
    const right = keyframes[index + 1];
    if (left === undefined || right === undefined) {
      lengths.push(0);
      continue;
    }
    if (!isVec2Value(left.value) || !isVec2Value(right.value)) {
      lengths.push(0);
      continue;
    }
    lengths.push(
      cubicLength(spatialSegment(left.value, right.value, left.spatial?.out, right.spatial?.in)),
    );
  }
  return lengths;
}

function bezier(handle: readonly [number, number]): EasingHandle {
  return { kind: "bezier", handle: [handle[0], handle[1]] };
}
