import { toDisposable, type Disposable } from "@theatrum/core-utils";
import { EXTENSION_POINT_NAMES, type ExtensionPointName } from "./manifest.js";

export type PluginContributionTypes = Readonly<Record<ExtensionPointName, unknown>>;

export interface RegistrationTarget<T> {
  readonly size: number;
  register(contribution: T): Disposable;
}

export type PluginExtensionTargets<C extends PluginContributionTypes> = {
  readonly [K in ExtensionPointName]: RegistrationTarget<C[K]>;
};

export interface PluginRegistrationPoint<T> {
  register(contribution: T): Disposable;
}

export type PluginRegistrationApi<C extends PluginContributionTypes> = {
  readonly [K in ExtensionPointName]: PluginRegistrationPoint<C[K]>;
};

export interface IdentifiedContribution {
  readonly id: string;
}

export interface NamedExtensionRegistry<
  T extends IdentifiedContribution,
> extends RegistrationTarget<T> {
  get(id: string): T | undefined;
  has(id: string): boolean;
  list(): readonly T[];
}

export class ExtensionRegistrationError extends Error {
  readonly code: "duplicate-id" | "invalid-id";
  readonly id: string;

  constructor(code: ExtensionRegistrationError["code"], id: string, message: string) {
    super(message);
    this.name = "ExtensionRegistrationError";
    this.code = code;
    this.id = id;
  }
}

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function createNamedExtensionRegistry<
  T extends IdentifiedContribution,
>(): NamedExtensionRegistry<T> {
  const entries = new Map<string, T>();
  return {
    get size(): number {
      return entries.size;
    },
    register(contribution: T): Disposable {
      if (!CONTRIBUTION_ID_PATTERN.test(contribution.id)) {
        throw new ExtensionRegistrationError(
          "invalid-id",
          contribution.id,
          `Identificador de extensão inválido: "${contribution.id}".`,
        );
      }
      if (entries.has(contribution.id)) {
        throw new ExtensionRegistrationError(
          "duplicate-id",
          contribution.id,
          `A extensão "${contribution.id}" já está registrada.`,
        );
      }
      entries.set(contribution.id, contribution);
      return toDisposable(() => {
        if (entries.get(contribution.id) === contribution) {
          entries.delete(contribution.id);
        }
      });
    },
    get(id: string): T | undefined {
      return entries.get(id);
    },
    has(id: string): boolean {
      return entries.has(id);
    },
    list(): readonly T[] {
      return Object.freeze([...entries.values()]);
    },
  };
}

export function targetSizes<C extends PluginContributionTypes>(
  targets: PluginExtensionTargets<C>,
): Readonly<Record<ExtensionPointName, number>> {
  return Object.freeze(
    Object.fromEntries(EXTENSION_POINT_NAMES.map((name) => [name, targets[name].size])),
  ) as Readonly<Record<ExtensionPointName, number>>;
}
