/**
 * Invariantes — asserções sobre coisas que **não podem** acontecer.
 *
 * Se uma condição pode falhar por causa de entrada do usuário, de arquivo ou de
 * plugin, ela não é invariante: use `Result`. Invariante é contrato interno, e
 * violá-la é bug no nosso código.
 */

export class InvariantError extends Error {
  override readonly name = "InvariantError";

  constructor(message: string) {
    super(`Invariante violada: ${message}`);
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

/**
 * Marca um ponto inalcançável. Em união discriminada, faz o TypeScript provar
 * que todos os casos foram tratados — se um `case` novo for adicionado ao tipo
 * e esquecido aqui, o build quebra.
 */
export function assertNever(value: never, context?: string): never {
  const detail = context === undefined ? "" : ` em ${context}`;
  throw new InvariantError(`caso não tratado${detail}: ${JSON.stringify(value)}`);
}

/** Estreita `T | null | undefined` para `T`. */
export function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new InvariantError(`${message} (recebido ${value === null ? "null" : "undefined"})`);
  }
}

/** Versão-expressão de `assertDefined`, para usar em cadeia. */
export function required<T>(value: T | null | undefined, message: string): T {
  assertDefined(value, message);
  return value;
}
