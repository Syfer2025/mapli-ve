import type { SceneDiagnostic, SceneDiagnosticCode, SceneDiagnosticSeverity } from "./contracts.js";

export function diagnostic(
  severity: SceneDiagnosticSeverity,
  code: SceneDiagnosticCode,
  path: string,
  message: string,
  options: {
    readonly hint?: string;
    readonly didYouMean?: readonly string[];
  } = {},
): SceneDiagnostic {
  return Object.freeze({
    severity,
    code,
    path,
    message,
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    ...(options.didYouMean === undefined || options.didYouMean.length === 0
      ? {}
      : { didYouMean: Object.freeze([...options.didYouMean]) }),
  });
}

export function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function pointer(parts: readonly (string | number)[]): string {
  return parts.length === 0 ? "" : `/${parts.map((part) => escapePointer(String(part))).join("/")}`;
}

export function stableDiagnostics(
  diagnostics: readonly SceneDiagnostic[],
): readonly SceneDiagnostic[] {
  const seen = new Set<string>();
  const unique = diagnostics.filter((entry) => {
    const key = `${entry.severity}\u0000${entry.code}\u0000${entry.path}\u0000${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) =>
      a.path.localeCompare(b.path, "en") ||
      severityRank(a.severity) - severityRank(b.severity) ||
      a.code.localeCompare(b.code, "en") ||
      a.message.localeCompare(b.message, "pt-BR"),
  );
  return Object.freeze(unique);
}

function severityRank(severity: SceneDiagnosticSeverity): number {
  if (severity === "error") return 0;
  return severity === "warning" ? 1 : 2;
}

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] ?? 0;
      const deletion = previous[rightIndex] ?? 0;
      const insertion = current[rightIndex - 1] ?? 0;
      current[rightIndex] = Math.min(
        deletion + 1,
        insertion + 1,
        substitution + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

export function suggest(
  value: string,
  candidates: readonly string[],
  limit = 3,
): readonly string[] {
  const normalized = value.toLocaleLowerCase("en-US");
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      distance: levenshtein(normalized, candidate.toLocaleLowerCase("en-US")),
    }))
    .filter(({ candidate, distance }) => distance <= Math.max(2, Math.ceil(candidate.length * 0.4)))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.candidate.length - b.candidate.length ||
        a.candidate.localeCompare(b.candidate, "en"),
    )
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => candidate);
  return Object.freeze(ranked);
}
