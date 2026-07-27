/**
 * Leitura de parâmetro de efeito.
 *
 * Um parâmetro chega em duas formas, e as duas são legítimas:
 *
 * - **Wrapper animável** `{ value, keyframes, expression }`, como está no
 *   documento. É a forma que o painel edita e que guarda os keyframes.
 * - **Valor cru**, depois de `evaluate` resolver o wrapper no frame pedido.
 *
 * Aceitar as duas no schema é o que faz keyframe em parâmetro de efeito
 * realmente animar: o avaliador entrega números, e a definição do efeito não
 * precisa saber se o que recebeu já passou por lá. Sem isso, o schema recusaria a
 * forma avaliada e o consumidor seria obrigado a ler o documento cru — lendo
 * sempre o `value` estático e ignorando os keyframes em silêncio.
 */

import { animatablePropertySchema } from "@theatrum/schema";
import { z } from "zod";

/** Wrapper animável **ou** o valor já avaliado. */
export function animatableOrValue<T extends z.ZodType>(inner: T) {
  return z.union([animatablePropertySchema(inner), inner]);
}

/** Wrapper com os campos vazios — a forma canônica de um default. */
export function animatable<T>(value: T): {
  readonly value: T;
  readonly keyframes: readonly never[];
  readonly expression: null;
} {
  return { value, keyframes: [], expression: null };
}

function unwrap(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "value" in value) {
    return (value as { readonly value: unknown }).value;
  }
  return value;
}

export function numberOf(value: unknown, fallback: number): number {
  const inner = unwrap(value);
  return typeof inner === "number" && Number.isFinite(inner) ? inner : fallback;
}

/** Cor em `#rrggbb`. O documento guarda `#rrggbbaa`; o shader quer seis dígitos. */
export function colorOf(value: unknown, fallback: string): string {
  const inner = unwrap(value);
  return typeof inner === "string" && inner.startsWith("#") ? inner.slice(0, 7) : fallback;
}
