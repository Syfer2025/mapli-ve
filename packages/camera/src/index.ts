/**
 * @theatrum/camera — L3 · motores
 *
 * Modelo geográfico de câmera, avaliação determinística de keyframes e a
 * fronteira de sincronização com o runtime do mapa.
 *
 * Ver docs/02-MODULES.md § camera.
 */

export {
  type CameraState,
  type CameraConstraints,
  MAX_MERCATOR_LATITUDE,
  DEFAULT_CAMERA_CONSTRAINTS,
  DEFAULT_CAMERA_STATE,
  normalizeLongitude,
  normalizeBearing,
  clampLatitude,
  normalizeCameraState,
} from "./state.js";

export { interpolateCameraState } from "./interpolate.js";

export {
  type CameraKeyframe,
  type CameraTrack,
  cameraKeyframe,
  createCameraTrack,
  upsertCameraKeyframe,
  removeCameraKeyframe,
  evaluateCamera,
} from "./keyframes.js";

export {
  type CameraApplyMode,
  type CancellationSignal,
  type CameraPort,
  type SettleOptions,
  type SettleResult,
  apply,
  settle,
} from "./camera.port.js";
