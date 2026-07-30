/**
 * @theatrum/export — L4 · serviços
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/export/src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */
export {
  type FrameRange,
  type ExportPlanInput,
  type PlannedFrame,
  type ExportPlan,
  ExportPlanError,
  counterDigits,
  planExport,
  sanitizeBasename,
} from "./frame-plan.js";

export {
  type ExportResolutionInput,
  type ExportResolution,
  ExportResolutionError,
  DEFAULT_MAX_DIMENSION,
  EXPORT_SCALES,
  EXPORT_SUPERSAMPLING_FACTORS,
  describeExportResolution,
  planExportResolution,
} from "./resolution.js";

export { type BoxDownsampleInput, SupersamplingError, downsampleRgbaBox } from "./supersampling.js";

export {
  type MotionBlurSpec,
  type PlannedMotionBlur,
  type RgbaFrame,
  MotionBlurAccumulator,
  MotionBlurError,
  MOTION_BLUR_SAMPLE_COUNTS,
  MOTION_BLUR_SHUTTER_ANGLES,
  DEFAULT_SHUTTER_ANGLE,
  DEFAULT_MOTION_BLUR_SAMPLES,
  MAX_MOTION_BLUR_SAMPLES,
  MOTION_BLUR_SETTLE_REFERENCE_MS,
  estimateMotionBlurSettleMs,
  motionBlurSampleFrames,
  planMotionBlur,
} from "./motion-blur.js";

export {
  type FfmpegExportFormat,
  type FfmpegPlanInput,
  type FfmpegPlan,
  planFfmpegExport,
} from "./ffmpeg-plan.js";

export { type Bytes, box, concat, fullBox } from "./mp4-boxes.js";

export {
  type EncodedSample,
  type Mp4TrackConfig,
  type Fragment,
  VIDEO_TIMESCALE,
  mp4Header,
  mp4Fragment,
  toTimescale,
} from "./mp4-muxer.js";
