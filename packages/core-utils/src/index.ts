/**
 * @theatrum/core-utils — L0 · núcleo
 *
 * Primitivos transversais. Sem dependências, sem DOM, sem GPU, sem I/O.
 * Superfície pública única deste pacote — importar `src/...` é erro de lint.
 *
 * Ver docs/02-MODULES.md § core-utils.
 */

export {
  type Result,
  ok,
  err,
  isOk,
  isErr,
  mapOk,
  mapErr,
  andThen,
  unwrapOr,
  unwrapOrElse,
  expectOk,
  collect,
} from "./result.js";

export { InvariantError, invariant, assertNever, assertDefined, required } from "./invariant.js";

export { hash32, hashObject, hashSeed, canonicalize } from "./hash.js";

export { type Rng, createRng } from "./prng.js";

export {
  type IdPrefix,
  type IdFactory,
  ID_PREFIXES,
  createIdFactory,
  isValidId,
  idPrefix,
} from "./id.js";

export {
  type Disposable,
  toDisposable,
  disposeAll,
  DisposableStore,
  NO_OP_DISPOSABLE,
} from "./disposable.js";

export { type EventBus, createEventBus } from "./event-bus.js";

export {
  type LogLevel,
  type Logger,
  type LogRecord,
  type LogSink,
  type LoggerOptions,
  createLogger,
  consoleSink,
  createMemorySink,
} from "./logger.js";
