export type CommandErrorCode =
  | "invalid-command"
  | "unregistered-command"
  | "rejected"
  | "invalid-document"
  | "transaction-active";

export interface CommandError {
  readonly code: CommandErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export class CommandRejectedError extends Error {
  override readonly name = "CommandRejectedError";

  constructor(message: string) {
    super(message);
  }
}

export function rejectCommand(message: string): never {
  throw new CommandRejectedError(message);
}
