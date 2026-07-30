/**
 * @theatrum/scripting — L4 · serviços
 *
 * Compilador determinístico Scene Script v1, diagnósticos para autoria por LLM
 * e exportação parcial de volta ao formato declarativo.
 */

export { compileScene } from "./compiler.js";
export { exportDocumentToSceneScript } from "./export-scene.js";
export { createLlmAuthoringExampleInput, generateLlmAuthoringMarkdown } from "./authoring.js";
export { BUILTIN_SCENE_VERBS, createSceneVerbRegistry, sceneVerbRegistry } from "./registry.js";
export {
  parseAbsoluteSceneTime,
  parseSceneTime,
  resolveTimelineTimes,
  type ParsedSceneTime,
  type SceneTimeContext,
} from "./time.js";
export { createDefaultSceneGazetteer, ScenePlaceResolver } from "./places.js";
export {
  type CompileSceneFailure,
  type CompileSceneOptions,
  type CompileSceneResult,
  type CompileSceneSuccess,
  type ExportSceneResult,
  type ResolvedTimelineEntry,
  type SceneDiagnostic,
  type SceneDiagnosticCode,
  type SceneDiagnosticSeverity,
  type SceneVerbDefinition,
  type SceneVerbRegistry,
} from "./contracts.js";
