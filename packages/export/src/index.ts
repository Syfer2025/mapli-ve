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
