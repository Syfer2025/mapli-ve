/**
 * Registry de Action Templates. O consumidor nunca decide por `switch(type)`.
 */

import { toDisposable, type Disposable } from "@theatrum/core-utils";
import type { ActionInstanceData, Composition, Node, ProjectDocument } from "@theatrum/schema";
import {
  type ActionExpansionContext,
  type ActionResolution,
  type ActionTemplate,
} from "./action-contracts.js";

export type ActionErrorCode = "duplicate-type";

export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly type: string;

  constructor(code: ActionErrorCode, type: string, message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.type = type;
  }
}

export interface ActionRegistry {
  readonly size: number;
  register<P>(definition: ActionTemplate<P>): Disposable;
  get(type: string): ActionTemplate<never> | undefined;
  has(type: string): boolean;
  list(): readonly string[];
  resolve(
    instance: ActionInstanceData,
    owner: Node,
    composition: Composition,
    document: ProjectDocument,
  ): ActionResolution;
}

class DefaultActionRegistry implements ActionRegistry {
  readonly #definitions = new Map<string, ActionTemplate<never>>();

  get size(): number {
    return this.#definitions.size;
  }

  register<P>(definition: ActionTemplate<P>): Disposable {
    if (this.#definitions.has(definition.type)) {
      throw new ActionError(
        "duplicate-type",
        definition.type,
        `A ação "${definition.type}" já está registrada.`,
      );
    }
    const stored = definition as unknown as ActionTemplate<never>;
    this.#definitions.set(definition.type, stored);
    return toDisposable(() => {
      if (this.#definitions.get(definition.type) === stored) {
        this.#definitions.delete(definition.type);
      }
    });
  }

  get(type: string): ActionTemplate<never> | undefined {
    return this.#definitions.get(type);
  }

  has(type: string): boolean {
    return this.#definitions.has(type);
  }

  list(): readonly string[] {
    return Object.freeze([...this.#definitions.keys()]);
  }

  resolve(
    instance: ActionInstanceData,
    owner: Node,
    composition: Composition,
    document: ProjectDocument,
  ): ActionResolution {
    if (!instance.enabled) return { status: "disabled" };
    if (instance.mode === "baked") return { status: "baked" };
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
    const context: ActionExpansionContext = { document, composition, owner, action: instance };
    return {
      status: "expanded",
      expansion: definition.expand(parsed.data as never, context),
    };
  }
}

export function createActionRegistry(
  definitions: readonly ActionTemplate<never>[] = [],
): ActionRegistry {
  const registry = new DefaultActionRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
}
