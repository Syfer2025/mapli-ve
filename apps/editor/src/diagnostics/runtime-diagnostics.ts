import type { PropertyExpressionDiagnostic } from "@theatrum/animation";

export type RuntimeDiagnosticSource = "map" | "studio";

export interface RuntimeExpressionDiagnosticFrame {
  readonly source: RuntimeDiagnosticSource;
  readonly compositionId: string;
  readonly frame: number;
  readonly diagnostics: readonly PropertyExpressionDiagnostic[];
}

export interface RuntimeDiagnosticsSnapshot {
  readonly frames: ReadonlyMap<RuntimeDiagnosticSource, RuntimeExpressionDiagnosticFrame>;
  readonly diagnostics: readonly PropertyExpressionDiagnostic[];
}

const listeners = new Set<() => void>();
const frames = new Map<RuntimeDiagnosticSource, RuntimeExpressionDiagnosticFrame>();
let snapshot = buildSnapshot();
let signatureBySource = new Map<RuntimeDiagnosticSource, string>();

export function publishRuntimeExpressionDiagnostics(
  source: RuntimeDiagnosticSource,
  compositionId: string,
  frame: number,
  diagnostics: readonly PropertyExpressionDiagnostic[] | undefined,
): void {
  const normalized = Object.freeze([...(diagnostics ?? [])]);
  const signature = JSON.stringify([
    compositionId,
    frame,
    normalized.map(({ code, message, propertyPath }) => [code, message, propertyPath]),
  ]);
  if (signatureBySource.get(source) === signature) return;
  signatureBySource = new Map(signatureBySource).set(source, signature);
  frames.set(
    source,
    Object.freeze({
      source,
      compositionId,
      frame,
      diagnostics: normalized,
    }),
  );
  publish();
}

export function clearRuntimeExpressionDiagnostics(source: RuntimeDiagnosticSource): void {
  if (!frames.delete(source)) return;
  signatureBySource = new Map(signatureBySource);
  signatureBySource.delete(source);
  publish();
}

export function runtimeExpressionDiagnosticsAt(
  compositionId: string,
  frame: number,
): readonly PropertyExpressionDiagnostic[] {
  const unique = new Map<string, PropertyExpressionDiagnostic>();
  for (const current of frames.values()) {
    if (current.compositionId !== compositionId || current.frame !== frame) continue;
    for (const diagnostic of current.diagnostics) {
      const key = `${diagnostic.code}\0${diagnostic.propertyPath ?? ""}\0${diagnostic.message}`;
      unique.set(key, diagnostic);
    }
  }
  return Object.freeze([...unique.values()]);
}

export function subscribeRuntimeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  return snapshot;
}

function buildSnapshot(): RuntimeDiagnosticsSnapshot {
  const unique = new Map<string, PropertyExpressionDiagnostic>();
  for (const current of frames.values()) {
    for (const diagnostic of current.diagnostics) {
      const key = `${diagnostic.code}\0${diagnostic.propertyPath ?? ""}\0${diagnostic.message}`;
      unique.set(key, diagnostic);
    }
  }
  return Object.freeze({
    frames: new Map(frames),
    diagnostics: Object.freeze([...unique.values()]),
  });
}

function publish(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}
