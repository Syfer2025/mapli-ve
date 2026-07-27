export type ProjectErrorCode =
  | "asset-corrupt"
  | "file-not-found"
  | "future-schema"
  | "invalid-container"
  | "invalid-document"
  | "invalid-format"
  | "io"
  | "migration-missing"
  | "missing-entry"
  | "unsupported-container";

export interface ProjectError {
  readonly code: ProjectErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly pointer?: string;
  readonly expected?: string | number;
  readonly actual?: string | number;
  readonly cause?: unknown;
}

export function projectError(
  code: ProjectErrorCode,
  message: string,
  details: Omit<ProjectError, "code" | "message"> = {},
): ProjectError {
  return { code, message, ...details };
}

export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
