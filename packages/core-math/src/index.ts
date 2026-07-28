/**
 * @theatrum/core-math — L0 · núcleo
 *
 * Geometria, curvas e álgebra linear do motor. Sem dependências, sem DOM,
 * sem GPU. Todas as funções são puras e nenhuma consulta tempo real,
 * aleatoriedade ou ambiente.
 *
 * Ver docs/02-MODULES.md § core-math.
 */

export {
  DEG_TO_RAD,
  RAD_TO_DEG,
  TAU,
  toRadians,
  toDegrees,
  lerp,
  clamp,
  clamp01,
  inverseLerp,
  remap,
  remapClamped,
  approximately,
  normalizeDegrees,
  shortestAngleDelta,
  lerpAngle,
  gaussianWeights,
  dampingToWindow,
  weightedAverage,
} from "./scalar.js";

export { type Vec2, type Vec3, type Rect, VEC2_ZERO, VEC2_ONE, vec2, vec3, rect } from "./vec.js";

export {
  type PolylineMeasure,
  type FatArrowOptions,
  measurePolyline,
  pointAtDistance,
  trimPolyline,
  endDirection,
  arrowHead,
  fatArrow,
  dashPolyline,
} from "./polyline.js";

export {
  type OrbitState,
  MAX_ELEVATION_DEG,
  MIN_ORBIT_DISTANCE_METERS,
  orbitCameraPosition,
  orbitStateFromPosition,
  orbitDistanceToFit,
} from "./orbit.js";

export { parseHexColor, formatHexColor, srgbToOklab, oklabToSrgb, lerpOklabHex } from "./color.js";

export {
  type Mat2D,
  type Transform2D,
  MAT2D_IDENTITY,
  IDENTITY_TRANSFORM,
  mat2d,
} from "./mat2d.js";

export {
  type EasePresetName,
  EASE_PRESETS,
  solveBezierX,
  cubicBezierEase,
  evaluateBezierEase,
} from "./easing.js";

export {
  type CubicSegment,
  lineSegment,
  sampleCubic,
  cubicTangent,
  cubicLength,
  splitCubic,
  cubicControlBounds,
  catmullRomToBezier,
  arcSegment,
} from "./bezier.js";

export {
  type ArcLengthTable,
  type DistanceFunction,
  buildArcLengthTable,
  arcLengthToT,
  progressToT,
  samplePath,
  pathTangent,
} from "./arc-length.js";
