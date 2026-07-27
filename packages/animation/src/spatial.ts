/**
 * Handles espaciais em propriedades de posição.
 *
 * Bezier temporal e bezier espacial são coisas diferentes e independentes: a
 * temporal (`in`/`out`) decide **quando** o objeto está em cada ponto do
 * caminho; a espacial (`spatial.in`/`spatial.out`) decide **por onde** o caminho
 * passa. Sem a espacial, dois keyframes de posição só produzem uma reta.
 *
 * Convenção igual à do After Effects: cada handle é um **deslocamento relativo
 * ao próprio valor do keyframe**. Assim, mover um keyframe arrasta seus handles
 * junto, sem recalcular nada.
 */

import { lineSegment, sampleCubic, type CubicSegment, type Vec2 } from "@theatrum/core-math";
import type { Keyframe } from "@theatrum/schema";

/** Aceita `[x, y]` mutável ou readonly; keyframes carregam tuplas do schema. */
type Vec2Like = readonly [number, number];

export function isVec2Value(value: unknown): value is Vec2Like {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

/** `true` quando o segmento entre dois keyframes tem curvatura espacial. */
export function hasSpatialCurvature<T>(left: Keyframe<T>, right: Keyframe<T>): boolean {
  return isNonZeroHandle(left.spatial?.out) || isNonZeroHandle(right.spatial?.in);
}

/**
 * Segmento cúbico do trecho entre dois keyframes de posição. Handles ausentes
 * ou nulos degeneram na reta, que é exatamente o comportamento anterior.
 */
export function spatialSegment(
  from: Vec2Like,
  to: Vec2Like,
  outHandle?: unknown,
  inHandle?: unknown,
): CubicSegment {
  const out = handleOffset(outHandle);
  const incoming = handleOffset(inHandle);
  if (out === null && incoming === null) {
    return lineSegment([from[0], from[1]], [to[0], to[1]]);
  }
  return {
    p0: [from[0], from[1]],
    c0: out === null ? [from[0], from[1]] : [from[0] + out[0], from[1] + out[1]],
    c1: incoming === null ? [to[0], to[1]] : [to[0] + incoming[0], to[1] + incoming[1]],
    p1: [to[0], to[1]],
  };
}

/**
 * Interpola posição ao longo do caminho espacial. `progress` já vem com o
 * easing temporal aplicado: é o que separa "onde" de "quando".
 */
export function interpolateSpatial(
  from: Vec2Like,
  to: Vec2Like,
  outHandle: unknown,
  inHandle: unknown,
  progress: number,
): Vec2 {
  return sampleCubic(spatialSegment(from, to, outHandle, inHandle), progress);
}

/**
 * Cadeia de segmentos de uma propriedade de posição inteira. Serve ao desenho do
 * caminho no viewport e à redistribuição de keyframes roving.
 */
export function spatialSegments<T>(keyframes: readonly Keyframe<T>[]): readonly CubicSegment[] {
  const segments: CubicSegment[] = [];
  for (let index = 0; index + 1 < keyframes.length; index += 1) {
    const left = keyframes[index];
    const right = keyframes[index + 1];
    if (left === undefined || right === undefined) continue;
    if (!isVec2Value(left.value) || !isVec2Value(right.value)) continue;
    segments.push(spatialSegment(left.value, right.value, left.spatial?.out, right.spatial?.in));
  }
  return Object.freeze(segments);
}

function handleOffset(handle: unknown): Vec2Like | null {
  if (!isVec2Value(handle)) return null;
  return handle[0] === 0 && handle[1] === 0 ? null : handle;
}

function isNonZeroHandle(handle: unknown): boolean {
  return handleOffset(handle) !== null;
}
