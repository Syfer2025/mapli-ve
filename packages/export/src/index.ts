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
