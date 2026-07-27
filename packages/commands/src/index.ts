/**
 * @theatrum/commands — L4 · serviços
 *
 * Command Bus validado, handlers nativos, transações e undo/redo por patches.
 */

export {
  createCommandBus,
  defineCommand,
  type CommandBus,
  type CommandBusOptions,
  type Draft,
  type ProjectDocument,
} from "./command-bus.js";
export {
  type CommandDefinition,
  type CommandFailure,
  type CommandHandler,
  type CommandLabel,
  type CommandResult,
  type CommandSuccess,
  type SerializableCommand,
} from "./contracts.js";
export {
  CommandRejectedError,
  rejectCommand,
  type CommandError,
  type CommandErrorCode,
} from "./errors.js";
export {
  CommandHistory,
  type CommandHistoryOptions,
  type History,
  type HistoryEntry,
  type HistoryListener,
  type HistorySnapshot,
} from "./history.js";
export {
  CommandSchemas,
  safeParseNativeCommand,
  type CommandSource,
  type NativeCommand,
  type NativeCommandType,
} from "./schemas.js";
