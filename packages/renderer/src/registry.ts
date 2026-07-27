import type { Disposable } from "@theatrum/core-utils";
import type { RenderableFactory } from "./contracts.js";
import { RendererError } from "./errors.js";

export interface RenderableRegistration {
  readonly type: string;
  readonly factory: RenderableFactory;
}

/**
 * Registry orientado a dados. O lifecycle nunca contém `switch (node.type)`;
 * adicionar um tipo é somente registrar outra factory.
 */
export class RenderableRegistry {
  readonly #factories = new Map<string, RenderableFactory>();

  register<P>(type: string, factory: RenderableFactory<P>): Disposable {
    const normalizedType = type.trim();
    if (normalizedType.length === 0) {
      throw new RendererError("missing-renderable", "O tipo do renderable não pode ser vazio.");
    }
    if (this.#factories.has(normalizedType)) {
      throw new RendererError(
        "duplicate-renderable",
        `Já existe uma factory registrada para "${normalizedType}".`,
      );
    }

    const erasedFactory: RenderableFactory = factory as RenderableFactory;
    this.#factories.set(normalizedType, erasedFactory);
    let disposed = false;

    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.#factories.get(normalizedType) === erasedFactory) {
          this.#factories.delete(normalizedType);
        }
      },
    };
  }

  get(type: string): RenderableFactory | undefined {
    return this.#factories.get(type);
  }

  has(type: string): boolean {
    return this.#factories.has(type);
  }

  list(): readonly string[] {
    return [...this.#factories.keys()].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
  }
}
