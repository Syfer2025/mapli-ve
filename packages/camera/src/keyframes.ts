import { type Frame } from "@theatrum/core-time";
import { interpolateCameraState } from "./interpolate.js";
import {
  DEFAULT_CAMERA_CONSTRAINTS,
  DEFAULT_CAMERA_STATE,
  type CameraConstraints,
  type CameraState,
  normalizeCameraState,
} from "./state.js";

/** Keyframe linear de um estado completo de câmera. */
export interface CameraKeyframe {
  /** Frame persistido; precisa ser inteiro e não negativo. */
  readonly frame: Frame;
  readonly state: CameraState;
}

/**
 * Trilha canônica de câmera.
 *
 * Keyframes ficam ordenados e sem frames duplicados. `defaultState` é usado
 * somente quando a trilha não contém keyframes.
 */
export interface CameraTrack {
  readonly defaultState: CameraState;
  readonly keyframes: readonly CameraKeyframe[];
  readonly constraints: CameraConstraints;
}

function validateKeyframeFrame(frame: Frame): void {
  if (!Number.isFinite(frame) || !Number.isInteger(frame) || frame < 0) {
    throw new RangeError("frame de keyframe precisa ser inteiro e não negativo");
  }
}

function normalizeConstraints(constraints: CameraConstraints): CameraConstraints {
  // Normalizar um estado neutro centraliza a validação dos limites.
  normalizeCameraState(DEFAULT_CAMERA_STATE, constraints);
  return {
    minLatitude: constraints.minLatitude,
    maxLatitude: constraints.maxLatitude,
    minZoom: constraints.minZoom,
    maxZoom: constraints.maxZoom,
    minPitch: constraints.minPitch,
    maxPitch: constraints.maxPitch,
  };
}

/** Cria um keyframe canônico, sem alocar ID durante avaliação. */
export function cameraKeyframe(
  at: Frame,
  state: CameraState,
  constraints: CameraConstraints = DEFAULT_CAMERA_CONSTRAINTS,
): CameraKeyframe {
  validateKeyframeFrame(at);
  return { frame: at, state: normalizeCameraState(state, constraints) };
}

/**
 * Cria uma trilha ordenada e sem duplicatas.
 *
 * Quando a entrada repete um frame, a última ocorrência vence — a mesma
 * semântica de uma sequência de edições `upsert`.
 */
export function createCameraTrack(
  defaultState: CameraState = DEFAULT_CAMERA_STATE,
  keyframes: readonly CameraKeyframe[] = [],
  constraints: CameraConstraints = DEFAULT_CAMERA_CONSTRAINTS,
): CameraTrack {
  const canonicalConstraints = normalizeConstraints(constraints);
  const byFrame = new Map<number, CameraKeyframe>();

  for (const keyframe of keyframes) {
    const canonical = cameraKeyframe(keyframe.frame, keyframe.state, canonicalConstraints);
    byFrame.set(keyframe.frame, canonical);
  }

  const canonicalKeyframes = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return {
    defaultState: normalizeCameraState(defaultState, canonicalConstraints),
    keyframes: canonicalKeyframes,
    constraints: canonicalConstraints,
  };
}

/** Insere ou substitui um keyframe sem mutar a trilha original. */
export function upsertCameraKeyframe(track: CameraTrack, keyframe: CameraKeyframe): CameraTrack {
  return createCameraTrack(track.defaultState, [...track.keyframes, keyframe], track.constraints);
}

/** Remove o keyframe do frame indicado sem mutar a trilha original. */
export function removeCameraKeyframe(track: CameraTrack, at: Frame): CameraTrack {
  validateKeyframeFrame(at);
  const remaining = track.keyframes.filter((keyframe) => keyframe.frame !== at);
  if (remaining.length === track.keyframes.length) return track;
  return createCameraTrack(track.defaultState, remaining, track.constraints);
}

/**
 * Avalia a câmera em qualquer frame, sem depender de avaliações anteriores.
 *
 * Antes do primeiro keyframe mantém o primeiro valor; depois do último mantém
 * o último. Entre dois keyframes, todos os componentes compartilham o mesmo
 * progresso linear.
 */
export function evaluateCamera(track: CameraTrack, at: Frame): CameraState {
  if (!Number.isFinite(at)) {
    throw new RangeError("frame de avaliação precisa ser finito");
  }

  const first = track.keyframes[0];
  if (first === undefined) return track.defaultState;
  if (at <= first.frame) return first.state;

  let previous = first;
  for (let index = 1; index < track.keyframes.length; index++) {
    const next = track.keyframes[index];
    if (next === undefined) continue;
    if (at <= next.frame) {
      const progress = (at - previous.frame) / (next.frame - previous.frame);
      return interpolateCameraState(previous.state, next.state, progress, track.constraints);
    }
    previous = next;
  }

  return previous.state;
}
