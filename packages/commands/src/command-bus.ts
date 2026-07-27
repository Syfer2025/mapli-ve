import { toDisposable, type Disposable } from "@theatrum/core-utils";
import {
  DocumentValidationError,
  type DocumentStore,
  type Draft,
  type MutationResult,
} from "@theatrum/document";
import type { ProjectDocument } from "@theatrum/schema";
import type { z } from "zod";
import type {
  CommandDefinition,
  CommandHandler,
  CommandResult,
  SerializableCommand,
} from "./contracts.js";
import { CommandRejectedError, type CommandError } from "./errors.js";
import { CommandHistory, type CommandHistoryOptions, type History } from "./history.js";
import { NATIVE_COMMAND_DEFINITIONS } from "./native-handlers.js";

interface StoredDefinition {
  readonly type: string;
  readonly schema: z.ZodType<SerializableCommand>;
  readonly label: string | ((command: SerializableCommand) => string);
  readonly handler: CommandHandler<SerializableCommand>;
}

interface PreparedCommand {
  readonly definition: StoredDefinition;
  readonly command: SerializableCommand;
  readonly label: string;
}

interface TransactionContext {
  readonly label: string;
  readonly commands: PreparedCommand[];
  error: CommandError | null;
  depth: number;
}

export interface CommandBus {
  readonly history: History;
  dispatch(command: unknown): CommandResult;
  transaction(label: string, callback: () => void): CommandResult;
  register<C extends SerializableCommand>(definition: CommandDefinition<C>): Disposable;
  undo(): boolean;
  redo(): boolean;
}

export interface CommandBusOptions extends CommandHistoryOptions {
  readonly nativeCommands?: boolean;
}

export function createCommandBus(
  document: DocumentStore,
  options: CommandBusOptions = {},
): CommandBus {
  return new RegisteredCommandBus(document, options);
}

class RegisteredCommandBus implements CommandBus {
  readonly history: CommandHistory;
  readonly #document: DocumentStore;
  readonly #definitions = new Map<string, StoredDefinition>();
  #transaction: TransactionContext | null = null;

  constructor(document: DocumentStore, options: CommandBusOptions) {
    this.#document = document;
    this.history = new CommandHistory(
      document,
      options.limit === undefined ? {} : { limit: options.limit },
    );
    if (options.nativeCommands ?? true) {
      for (const definition of NATIVE_COMMAND_DEFINITIONS) this.#registerErased(definition);
    }
  }

  dispatch(input: unknown): CommandResult {
    const prepared = this.#prepare(input);
    if (!prepared.ok) {
      if (this.#transaction !== null && this.#transaction.error === null) {
        this.#transaction.error = prepared.error;
      }
      return prepared;
    }

    if (this.#transaction !== null) {
      this.#transaction.commands.push(prepared.command);
      return success(EMPTY_MUTATION, prepared.command.label, true);
    }

    const executed = this.#execute([prepared.command]);
    if (!executed.ok) return executed;
    this.history.record(
      prepared.command.label,
      [prepared.command.command.type],
      executed.mutation.patches,
      executed.mutation.inverse,
    );
    return success(executed.mutation, prepared.command.label, false);
  }

  transaction(label: string, callback: () => void): CommandResult {
    if (this.#transaction !== null) {
      this.#transaction.depth += 1;
      try {
        callback();
      } finally {
        this.#transaction.depth -= 1;
      }
      return success(EMPTY_MUTATION, this.#transaction.label, true);
    }

    const context: TransactionContext = {
      label,
      commands: [],
      error: null,
      depth: 1,
    };
    this.#transaction = context;
    try {
      callback();
    } finally {
      this.#transaction = null;
    }

    if (context.error !== null) return { ok: false, error: context.error };
    const executed = this.#execute(context.commands);
    if (!executed.ok) return executed;

    this.history.record(
      label,
      context.commands.map((prepared) => prepared.command.type),
      executed.mutation.patches,
      executed.mutation.inverse,
    );
    return success(executed.mutation, label, false);
  }

  register<C extends SerializableCommand>(definition: CommandDefinition<C>): Disposable {
    const label = definition.label;
    const erased: StoredDefinition = {
      type: definition.type,
      schema: definition.schema as unknown as z.ZodType<SerializableCommand>,
      label: typeof label === "string" ? label : (command) => label(command as C),
      handler(draft, command) {
        definition.handler(draft, command as C);
      },
    };
    this.#registerErased(erased);
    return toDisposable(() => {
      if (this.#definitions.get(erased.type) === erased) this.#definitions.delete(erased.type);
    });
  }

  undo(): boolean {
    if (this.#transaction !== null) return false;
    return this.history.undo();
  }

  redo(): boolean {
    if (this.#transaction !== null) return false;
    return this.history.redo();
  }

  #registerErased(definition: StoredDefinition): void {
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Já existe handler registrado para ${definition.type}.`);
    }
    this.#definitions.set(definition.type, definition);
  }

  #prepare(
    input: unknown,
  ):
    | { readonly ok: true; readonly command: PreparedCommand }
    | { readonly ok: false; readonly error: CommandError } {
    if (typeof input !== "object" || input === null) {
      return failure("invalid-command", "Comando deve ser um objeto serializável.");
    }
    const type = Reflect.get(input, "type");
    if (typeof type !== "string") {
      return failure("invalid-command", "Comando sem campo type válido.");
    }
    const definition = this.#definitions.get(type);
    if (definition === undefined) {
      return failure("unregistered-command", `Nenhum handler registrado para ${type}.`);
    }
    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) {
      return failure(
        "invalid-command",
        `Payload inválido para ${type}: ${parsed.error.issues[0]?.message ?? "erro desconhecido"}`,
        parsed.error.issues,
      );
    }
    const label =
      typeof definition.label === "string" ? definition.label : definition.label(parsed.data);
    return {
      ok: true,
      command: { definition, command: parsed.data, label },
    };
  }

  #execute(
    commands: readonly PreparedCommand[],
  ):
    | { readonly ok: true; readonly mutation: MutationResult }
    | { readonly ok: false; readonly error: CommandError } {
    if (commands.length === 0) return { ok: true, mutation: EMPTY_MUTATION };
    try {
      const mutation = this.#document.mutate((draft) => {
        for (const prepared of commands) {
          prepared.definition.handler(draft, prepared.command);
        }
      });
      return { ok: true, mutation };
    } catch (error: unknown) {
      if (error instanceof CommandRejectedError) {
        return failure("rejected", error.message);
      }
      if (error instanceof DocumentValidationError) {
        return failure("invalid-document", error.message, error.issues);
      }
      throw error;
    }
  }
}

const EMPTY_MUTATION: MutationResult = Object.freeze({
  patches: Object.freeze([]),
  inverse: Object.freeze([]),
});

function success(mutation: MutationResult, label: string, deferred: boolean): CommandResult {
  return {
    ok: true,
    patches: mutation.patches,
    inverse: mutation.inverse,
    label,
    deferred,
  };
}

function failure(
  code: CommandError["code"],
  message: string,
  details?: unknown,
): { readonly ok: false; readonly error: CommandError } {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

/** Helper para definições de plugins sem expor detalhes do registry. */
export function defineCommand<C extends SerializableCommand>(
  definition: CommandDefinition<C>,
): CommandDefinition<C> {
  return definition;
}

export type { Draft, ProjectDocument };
