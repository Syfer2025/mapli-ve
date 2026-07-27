import type { Draft, Patch } from "@theatrum/document";
import type { ProjectDocument } from "@theatrum/schema";
import type { z } from "zod";
import type { CommandError } from "./errors.js";
import type { CommandSource } from "./schemas.js";

export interface SerializableCommand {
  readonly type: string;
  readonly payload: unknown;
  readonly source?: CommandSource;
}

export type CommandHandler<C extends SerializableCommand> = (
  draft: Draft<ProjectDocument>,
  command: C,
) => void;

export type CommandLabel<C extends SerializableCommand> = string | ((command: C) => string);

export interface CommandDefinition<C extends SerializableCommand> {
  readonly type: C["type"];
  readonly schema: z.ZodType<C>;
  readonly label: CommandLabel<C>;
  readonly handler: CommandHandler<C>;
}

export interface CommandSuccess {
  readonly ok: true;
  readonly patches: readonly Patch[];
  readonly inverse: readonly Patch[];
  readonly label: string;
  /** true enquanto o comando aguarda o commit da transação externa. */
  readonly deferred: boolean;
}

export interface CommandFailure {
  readonly ok: false;
  readonly error: CommandError;
}

export type CommandResult = CommandSuccess | CommandFailure;
