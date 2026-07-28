/**
 * @theatrum/behaviors — L3 · motores
 *
 * Comportamentos declarativos que **geram** propriedades animadas: caminho,
 * auto-orientação, inclinação em curva, seguir e oscilar. Todos puros e sem
 * estado acumulado — ver `contracts.ts`.
 *
 * Superfície pública única deste pacote. Importar
 * `@theatrum/behaviors/src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md.
 */

export {
  BehaviorError,
  NO_CONTRIBUTION,
  type BehaviorContext,
  type BehaviorDefinition,
  type NodeSample,
  type PropertyContribution,
  type RotationReference,
} from "./contracts.js";

export {
  createBehaviorRegistry,
  type BehaviorRegistry,
  type BehaviorResolution,
} from "./registry.js";

export {
  BUILTIN_BEHAVIORS,
  BUILTIN_BEHAVIOR_TYPES,
  createBuiltinBehaviorRegistry,
  type BuiltinBehaviorType,
} from "./builtin.js";

export {
  MOTION_PATH_DEFAULTS,
  MotionPathParamsSchema,
  motionPathBehavior,
  pointAt,
  shortestAngleDelta,
  type MotionPathParams,
} from "./motion-path.js";

export {
  AUTO_ORIENT_DEFAULTS,
  AutoOrientParamsSchema,
  autoOrientBehavior,
  type AutoOrientParams,
} from "./auto-orient.js";

export {
  BANKING_DEFAULTS,
  BankingParamsSchema,
  bankingBehavior,
  type BankingParams,
} from "./banking.js";

export {
  FOLLOW_DEFAULTS,
  FollowParamsSchema,
  followBehavior,
  type FollowParams,
} from "./follow.js";

export {
  WIGGLE_DEFAULTS,
  WiggleParamsSchema,
  fractalNoise,
  valueNoise,
  wiggleBehavior,
  type WiggleParams,
} from "./wiggle.js";

export { pathGeometry, type PathGeometry } from "./path-geometry.js";

export {
  applySceneBehaviors,
  createDocumentBehaviorContext,
  withContribution,
  type BehaviorDiagnostic,
  type BehaviorPassOptions,
  type BehaviorPassResult,
} from "./apply.js";

export {
  ActionError,
  createActionRegistry,
  type ActionErrorCode,
  type ActionRegistry,
} from "./action-registry.js";

export {
  BUILTIN_ACTIONS,
  BUILTIN_ACTION_TYPES,
  actionInternals,
  createBuiltinActionRegistry,
  type BuiltinActionType,
} from "./builtin-actions.js";

export {
  expandLiveActions,
  materializeActionExpansions,
  type ActionDocumentPass,
  type MaterializedActions,
} from "./apply-actions.js";

export type {
  ActionBehaviorPlacement,
  ActionCategory,
  ActionDiagnostic,
  ActionExpansion,
  ActionExpansionContext,
  ActionKeyframeWrite,
  ActionParamDescriptor,
  ActionParamKind,
  ActionResolution,
  ActionTemplate,
} from "./action-contracts.js";
