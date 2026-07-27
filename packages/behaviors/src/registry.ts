/**
 * Registry de comportamentos — mesma forma do registry de tipos de nó: um
 * comportamento novo é um arquivo de definição e uma linha de registro, sem
 * ramificação por `type` em nenhum consumidor.
 */

import { toDisposable, type Disposable } from "@theatrum/core-utils";
import type { BehaviorInstanceData, Node } from "@theatrum/schema";
import {
  BehaviorError,
  type BehaviorContext,
  type BehaviorDefinition,
  type PropertyContribution,
} from "./contracts.js";

export type BehaviorResolution =
  | { readonly status: "applied"; readonly contribution: PropertyContribution }
  | { readonly status: "disabled" }
  | { readonly status: "unknown-type"; readonly type: string }
  | { readonly status: "invalid-params"; readonly type: string; readonly message: string };

export interface BehaviorRegistry {
  readonly size: number;
  register<P>(definition: BehaviorDefinition<P>): Disposable;
  get(type: string): BehaviorDefinition<never> | undefined;
  has(type: string): boolean;
  list(): readonly string[];
  /** Valida os params da instância e devolve a contribuição, sem lançar. */
  resolve(
    instance: BehaviorInstanceData,
    node: Node,
    frame: number,
    context: BehaviorContext,
  ): BehaviorResolution;
}

class DefaultBehaviorRegistry implements BehaviorRegistry {
  readonly #definitions = new Map<string, BehaviorDefinition<never>>();

  get size(): number {
    return this.#definitions.size;
  }

  register<P>(definition: BehaviorDefinition<P>): Disposable {
    if (this.#definitions.has(definition.type)) {
      throw new BehaviorError(
        "duplicate-type",
        definition.type,
        `O comportamento "${definition.type}" já está registrado.`,
      );
    }
    const stored = definition as unknown as BehaviorDefinition<never>;
    this.#definitions.set(definition.type, stored);
    return toDisposable(() => {
      if (this.#definitions.get(definition.type) === stored) {
        this.#definitions.delete(definition.type);
      }
    });
  }

  get(type: string): BehaviorDefinition<never> | undefined {
    return this.#definitions.get(type);
  }

  has(type: string): boolean {
    return this.#definitions.has(type);
  }

  list(): readonly string[] {
    return Object.freeze([...this.#definitions.keys()]);
  }

  resolve(
    instance: BehaviorInstanceData,
    node: Node,
    frame: number,
    context: BehaviorContext,
  ): BehaviorResolution {
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

    // Sem deslocamento de tempo próprio: `BehaviorInstanceData` não tem
    // `startFrame` (isso é de Action, na Fase 7) e atraso se expressa com
    // keyframes em `progress`, que continuam editáveis na timeline.
    return {
      status: "applied",
      contribution: definition.contribute(node, parsed.data as never, frame, context),
    };
  }
}

export function createBehaviorRegistry(
  definitions: readonly BehaviorDefinition<never>[] = [],
): BehaviorRegistry {
  const registry = new DefaultBehaviorRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
}
