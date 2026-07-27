/**
 * Log com escopo.
 *
 * Sem timestamp por padrão: um log que carrega `Date.now()` vaza tempo real
 * para dentro de trechos que precisam ser determinísticos, e a saída de um
 * golden test deixa de ser comparável. Quando o horário importa (job de
 * render), o sink que quiser pode acrescentá-lo.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  readonly scope: string;
  debug(message: string, ...detail: readonly unknown[]): void;
  info(message: string, ...detail: readonly unknown[]): void;
  warn(message: string, ...detail: readonly unknown[]): void;
  error(message: string, ...detail: readonly unknown[]): void;
  /** Sub-logger com escopo aninhado: `export` → `export:encoder`. */
  child(sub: string): Logger;
}

export interface LogRecord {
  readonly level: Exclude<LogLevel, "silent">;
  readonly scope: string;
  readonly message: string;
  readonly detail: readonly unknown[];
}

export type LogSink = (record: LogRecord) => void;

/**
 * Superfície mínima de `console`.
 *
 * core-utils é L0: sem `lib.dom`, sem `@types/node`. Declarar só os quatro
 * métodos que o sink usa mantém essa invariante honesta, em vez de arrastar
 * toda a tipagem de DOM ou de Node para dentro do núcleo por causa de um log.
 * `declare` não emite código — em runtime é o `console` global.
 */
declare const console: {
  log(...args: readonly unknown[]): void;
  info(...args: readonly unknown[]): void;
  warn(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
};

/** Sink padrão: console, com o escopo em prefixo. */
export const consoleSink: LogSink = ({ level, scope, message, detail }) => {
  const line = `[${scope}] ${message}`;
  const method = level === "debug" ? "log" : level;
  // Único ponto do projeto que fala com o console. A regra `no-console` não
  // dispara aqui porque o `declare const console` acima sombreia o global.
  console[method](line, ...detail);
};

export interface LoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
}

export function createLogger(scope: string, options?: LoggerOptions): Logger {
  const level = options?.level ?? "info";
  const sink = options?.sink ?? consoleSink;
  const threshold = RANK[level];

  const emit =
    (recordLevel: Exclude<LogLevel, "silent">) =>
    (message: string, ...detail: readonly unknown[]): void => {
      if (RANK[recordLevel] < threshold) return;
      sink({ level: recordLevel, scope, message, detail });
    };

  return {
    scope,
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child(sub: string): Logger {
      return createLogger(`${scope}:${sub}`, { level, sink });
    },
  };
}

/** Sink que só coleta — para testes e para o painel de diagnóstico. */
export function createMemorySink(): { sink: LogSink; records: readonly LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    sink: (record) => records.push(record),
    records,
  };
}
