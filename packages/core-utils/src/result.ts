/**
 * Result — para falhas **esperadas**, que fazem parte do domínio.
 *
 * Bugs (invariantes violadas) lançam via `invariant()`. A distinção está em
 * docs/07-CONVENTIONS.md § 4 e é levada a sério: um arquivo ausente é `Result`,
 * um ciclo no grafo de cena é exceção.
 */

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

/** Transforma o valor de sucesso; propaga o erro intacto. */
export function mapOk<T, E, U>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Transforma o erro; propaga o sucesso intacto. */
export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

/** Encadeia operações que também podem falhar. */
export function andThen<T, E, U>(r: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function unwrapOrElse<T, E>(r: Result<T, E>, fn: (error: E) => T): T {
  return r.ok ? r.value : fn(r.error);
}

/**
 * Extrai o valor ou lança. Use apenas quando o erro seria um bug no ponto de
 * chamada — nunca para converter erro de domínio em exceção por preguiça.
 */
export function expectOk<T, E>(r: Result<T, E>, message: string): T {
  if (r.ok) return r.value;
  throw new Error(`${message}: ${describeError(r.error)}`);
}

/**
 * Coleta uma lista de Results: devolve todos os valores, ou **todos** os erros.
 * Falhar com a lista completa é o que permite ao compilador de Scene Script
 * relatar 5 problemas de uma vez em vez de um por rodada.
 */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "kind" in error) {
    return String((error as { kind: unknown }).kind);
  }
  return String(error);
}
