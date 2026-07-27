/**
 * @theatrum/animation — L2 · domínio
 *
 * Avaliação pura de propriedades e cenas. Sem DOM, GPU, I/O ou relógio real.
 */

export {
  applyEasingPreset,
  evaluateProperty,
  interpolateKeyframes,
  interpolateValue,
  keyframeSegment,
  moveKeyframe,
  removeKeyframe,
  setKeyframeEasing,
  upsertKeyframe,
  type KeyframeSegment,
} from "./property.js";

export {
  hasSpatialCurvature,
  interpolateSpatial,
  isVec2Value,
  spatialSegment,
  spatialSegments,
} from "./spatial.js";

export { propertySpeed, sampleSpeedCurve, speedUniformity, type SpeedSample } from "./velocity.js";

export {
  applyEasyEase,
  redistributeRovingKeyframes,
  setKeyframeRoving,
  type EaseSide,
} from "./assistants.js";

export {
  evaluate,
  evaluateValue,
  EvaluationError,
  type EvaluateOptions,
  type EvaluatedCamera,
  type EvaluatedEffect,
  type EvaluatedNode,
  type EvaluatedScene,
} from "./evaluate.js";
