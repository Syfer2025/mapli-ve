/**
 * Registry de efeitos — mesma forma dos registros de tipo de nó e de
 * comportamento: um efeito novo é um arquivo de definição e uma linha de
 * registro, sem `switch` central em nenhum consumidor.
 */

import { toDisposable, type Disposable } from "@theatrum/core-utils";
import {
  EffectError,
  type EffectDefinition,
  type EffectInstanceLike,
  type EffectSpec,
} from "./contracts.js";

export type EffectResolution =
  | { readonly status: "resolved"; readonly spec: EffectSpec }
  | { readonly status: "disabled" }
  | { readonly status: "unknown-type"; readonly type: string }
  | { readonly status: "invalid-params"; readonly type: string; readonly message: string };

export interface EffectRegistry {
  readonly size: number;
  register<P>(definition: EffectDefinition<P>): Disposable;
  get(type: string): EffectDefinition<never> | undefined;
  has(type: string): boolean;
  list(): readonly string[];
  /**
   * Valida os params da instância e devolve a especificação, sem lançar. O
   * `seed` já deve vir combinado da composição com a identidade do nó. Aceita
   * tanto a instância do documento quanto a avaliada por keyframes.
   */
  resolve(instance: EffectInstanceLike, seed: number, fps: number): EffectResolution;
}

class DefaultEffectRegistry implements EffectRegistry {
  readonly #definitions = new Map<string, EffectDefinition<never>>();

  get size(): number {
    return this.#definitions.size;
  }

  register<P>(definition: EffectDefinition<P>): Disposable {
    if (this.#definitions.has(definition.type)) {
      throw new EffectError(
        "duplicate-type",
        definition.type,
        `O efeito "${definition.type}" já está registrado.`,
      );
    }
    const stored = definition as unknown as EffectDefinition<never>;
    this.#definitions.set(definition.type, stored);
    return toDisposable(() => {
      if (this.#definitions.get(definition.type) === stored) {
        this.#definitions.delete(definition.type);
      }
    });
  }

  get(type: string): EffectDefinition<never> | undefined {
    return this.#definitions.get(type);
  }

  has(type: string): boolean {
    return this.#definitions.has(type);
  }

  list(): readonly string[] {
    return Object.freeze([...this.#definitions.keys()]);
  }

  resolve(instance: EffectInstanceLike, seed: number, fps: number): EffectResolution {
    if (!instance.enabled) return { status: "disabled" };
    const definition = this.#definitions.get(instance.type);
    if (definition === undefined) return { status: "unknown-type", type: instance.type };

    const parsed = definition.paramSchema.safeParse(instance.params);
    if (!parsed.success) {
      return {
        status: "invalid-params",
        type: instance.type,
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }
    return { status: "resolved", spec: definition.spec(parsed.data as never, seed, fps) };
  }
}

export function createEffectRegistry(
  definitions: readonly EffectDefinition<never>[] = [],
): EffectRegistry {
  const registry = new DefaultEffectRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
}
