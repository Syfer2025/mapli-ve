export type RendererErrorCode =
  | "invalid-lifecycle"
  | "duplicate-slot"
  | "duplicate-node"
  | "missing-node"
  | "missing-renderable"
  | "duplicate-renderable"
  | "invalid-surface"
  | "backend-state";

export class RendererError extends Error {
  readonly code: RendererErrorCode;

  constructor(code: RendererErrorCode, message: string) {
    super(message);
    this.name = "RendererError";
    this.code = code;
  }
}
