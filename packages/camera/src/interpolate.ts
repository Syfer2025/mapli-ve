import { clamp01, lerp, shortestAngleDelta } from "@theatrum/core-math";
import {
  DEFAULT_CAMERA_CONSTRAINTS,
  type CameraConstraints,
  type CameraState,
  normalizeBearing,
  normalizeCameraState,
  normalizeLongitude,
} from "./state.js";

/**
 * Interpola dois estados com um único progresso temporal.
 *
 * Longitude cruza o antimeridiano pelo menor arco e bearing usa a menor
 * rotação. Zoom é interpolado diretamente no valor logarítmico do MapLibre.
 */
export function interpolateCameraState(
  from: CameraState,
  to: CameraState,
  progress: number,
  constraints: CameraConstraints = DEFAULT_CAMERA_CONSTRAINTS,
): CameraState {
  if (!Number.isFinite(progress)) {
    throw new RangeError("progresso precisa ser finito");
  }

  const a = normalizeCameraState(from, constraints);
  const b = normalizeCameraState(to, constraints);
  const t = clamp01(progress);
  if (t === 0) return a;
  if (t === 1) return b;

  const longitude = normalizeLongitude(
    a.center[0] + shortestAngleDelta(a.center[0], b.center[0]) * t,
  );
  const bearing = normalizeBearing(a.bearing + shortestAngleDelta(a.bearing, b.bearing) * t);

  return normalizeCameraState(
    {
      center: [longitude, lerp(a.center[1], b.center[1], t)],
      zoom: lerp(a.zoom, b.zoom, t),
      bearing,
      pitch: lerp(a.pitch, b.pitch, t),
    },
    constraints,
  );
}
