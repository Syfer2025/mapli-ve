/**
 * @theatrum/animation — L2 · domínio
 *
 * Avaliação pura de propriedades e cenas. Sem DOM, GPU, I/O ou relógio real.
 */

export {
  applyEasingPreset,
  evaluateProperty,
  evaluatePropertyResult,
  interpolateKeyframes,
  interpolateValue,
  keyframeSegment,
  moveKeyframe,
  removeKeyframe,
  setKeyframeEasing,
  upsertKeyframe,
  type EvaluatedPropertyResult,
  type KeyframeSegment,
  type PropertyExpressionDiagnostic,
} from "./property.js";

export {
  compileExpression,
  evaluateExpression,
  evaluateExpressionSource,
  type CompileExpressionResult,
  type EvaluateExpressionResult,
  type ExpressionContext,
  type ExpressionDiagnostic,
  type ExpressionDiagnosticCode,
  type ExpressionProgram,
  type ExpressionScalar,
  type ExpressionValue,
} from "./expression.js";

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
  evaluateValueResult,
  EvaluationError,
  type EvaluateOptions,
  type EvaluatedCamera,
  type EvaluatedEffect,
  type EvaluatedNode,
  type EvaluatedScene,
  type EvaluatedValueResult,
} from "./evaluate.js";
