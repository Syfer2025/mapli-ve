import type { GazetteerPort } from "@theatrum/gis";
import type { ProjectDocument, SceneScript, SceneTimelineEntry } from "@theatrum/schema";

export type SceneDiagnosticSeverity = "error" | "warning" | "info";

export type SceneDiagnosticCode =
  | "invalid-json"
  | "invalid-type"
  | "missing-field"
  | "unknown-field"
  | "unknown-verb"
  | "schema"
  | "duplicate-id"
  | "invalid-time"
  | "time-cycle"
  | "missing-reference"
  | "place-not-found"
  | "place-ambiguous"
  | "outside-duration"
  | "implausible-speed"
  | "contradictory-overlap"
  | "unused-unit"
  | "unbalanced-group"
  | "unsupported-feature"
  | "unsupported-export";

export interface SceneDiagnostic {
  readonly severity: SceneDiagnosticSeverity;
  readonly code: SceneDiagnosticCode;
  /** RFC 6901 JSON Pointer. A raiz é a string vazia. */
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
  readonly didYouMean?: readonly string[];
}

export interface CompileSceneOptions {
  /** Porta offline por padrão; hosts podem fornecer Natural Earth completo. */
  readonly gazetteer?: GazetteerPort;
  /** Warnings de plausibilidade não impedem a emissão do documento. */
  readonly semanticWarnings?: boolean;
}

export interface CompileSceneSuccess {
  readonly ok: true;
  readonly document: ProjectDocument;
  readonly scene: SceneScript;
  readonly diagnostics: readonly SceneDiagnostic[];
}

export interface CompileSceneFailure {
  readonly ok: false;
  readonly diagnostics: readonly SceneDiagnostic[];
}

export type CompileSceneResult = CompileSceneSuccess | CompileSceneFailure;

export interface ResolvedTimelineEntry {
  readonly index: number;
  readonly entry: SceneTimelineEntry;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly endFrame: number;
}

export interface SceneVerbDefinition {
  readonly name: SceneTimelineEntry["do"];
  readonly category: "camera" | "units" | "combat" | "geography" | "text" | "control";
  readonly description: string;
  readonly required: readonly string[];
  readonly fields: readonly string[];
  readonly example: Readonly<Record<string, unknown>>;
  /** Limitação conhecida que o compilador também devolve como warning. */
  readonly implementationNote?: string;
}

export interface SceneVerbRegistry {
  list(): readonly SceneVerbDefinition[];
  get(name: string): SceneVerbDefinition | undefined;
  has(name: string): name is SceneTimelineEntry["do"];
  suggest(name: string, limit?: number): readonly string[];
}

export interface ExportSceneResult {
  readonly scene: SceneScript | null;
  readonly diagnostics: readonly SceneDiagnostic[];
}
