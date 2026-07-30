import {
  createLogger,
  disposeAll,
  err,
  ok,
  type Disposable,
  type Logger,
  type Result,
} from "@theatrum/core-utils";
import type { PluginCandidate } from "./discovery.js";
import {
  type PluginContributionTypes,
  type PluginExtensionTargets,
  type PluginRegistrationApi,
  type RegistrationTarget,
} from "./extensions.js";
import { EXTENSION_POINT_NAMES, type ExtensionPointName, type PluginManifest } from "./manifest.js";

export interface PluginApi<C extends PluginContributionTypes> extends PluginRegistrationApi<C> {
  readonly manifest: PluginManifest;
  readonly logger: Logger;
}

export interface PluginModule<C extends PluginContributionTypes> {
  activate(api: PluginApi<C>): void | Disposable | Promise<void | Disposable>;
}

export interface PluginModuleLoader<C extends PluginContributionTypes> {
  load(entryPath: string): Promise<PluginModule<C>>;
}

export type PluginErrorCode =
  "already-loaded" | "not-loaded" | "load-failed" | "activation-failed" | "unload-failed";

export interface PluginError {
  readonly code: PluginErrorCode;
  readonly pluginId: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly contributionCounts: Readonly<Record<ExtensionPointName, number>>;
}

export interface PluginHost<C extends PluginContributionTypes> extends Disposable {
  readonly size: number;
  has(pluginId: string): boolean;
  list(): readonly LoadedPlugin[];
  load(candidate: PluginCandidate): Promise<Result<LoadedPlugin, PluginError>>;
  loadModule(
    manifest: PluginManifest,
    module: PluginModule<C>,
  ): Promise<Result<LoadedPlugin, PluginError>>;
  unload(pluginId: string): Result<void, PluginError>;
}

interface LoadedState {
  readonly plugin: LoadedPlugin;
  readonly scope: PluginScope;
}

class PluginScope implements Disposable {
  readonly #disposables: Disposable[] = [];
  #active = true;

  get active(): boolean {
    return this.#active;
  }

  add(disposable: Disposable): Disposable {
    if (!this.#active) {
      disposable.dispose();
      throw new Error("O escopo do plugin já foi descarregado.");
    }
    this.#disposables.push(disposable);
    return disposable;
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;
    const disposables = [...this.#disposables].reverse();
    this.#disposables.length = 0;
    disposeAll(disposables);
  }
}

export function createPluginHost<C extends PluginContributionTypes>(options: {
  readonly targets: PluginExtensionTargets<C>;
  readonly loader?: PluginModuleLoader<C>;
  readonly logger?: Logger;
}): PluginHost<C> {
  const loaded = new Map<string, LoadedState>();
  const loading = new Set<string>();
  const logger = options.logger ?? createLogger("plugins", { level: "silent" });
  let disposed = false;

  const loadModule = async (
    manifest: PluginManifest,
    module: PluginModule<C>,
  ): Promise<Result<LoadedPlugin, PluginError>> => {
    if (disposed) {
      return err(pluginError("load-failed", manifest.id, "O host de plugins foi descartado."));
    }
    if (loaded.has(manifest.id) || loading.has(manifest.id)) {
      return err(
        pluginError("already-loaded", manifest.id, `O plugin "${manifest.id}" já está carregado.`),
      );
    }

    loading.add(manifest.id);
    const scope = new PluginScope();
    const contributionCounts = emptyContributionCounts();
    const api = createScopedApi(
      manifest,
      options.targets,
      scope,
      contributionCounts,
      logger.child(manifest.id),
    );
    try {
      const activationDisposable = await module.activate(api);
      if (activationDisposable !== undefined) scope.add(activationDisposable);
    } catch (cause: unknown) {
      loading.delete(manifest.id);
      try {
        scope.dispose();
      } catch (rollbackCause: unknown) {
        logger.error("Falha adicional ao reverter ativação.", rollbackCause);
      }
      return err(
        pluginError(
          "activation-failed",
          manifest.id,
          `O plugin "${manifest.id}" falhou durante a ativação.`,
          cause,
        ),
      );
    }

    if (disposed) {
      loading.delete(manifest.id);
      try {
        scope.dispose();
      } catch (rollbackCause: unknown) {
        logger.error("Falha adicional ao reverter ativação.", rollbackCause);
      }
      return err(pluginError("load-failed", manifest.id, "O host de plugins foi descartado."));
    }

    loading.delete(manifest.id);
    const plugin = Object.freeze({
      manifest,
      contributionCounts: Object.freeze({ ...contributionCounts }),
    });
    loaded.set(manifest.id, { plugin, scope });
    logger.info(`Plugin carregado: ${manifest.id}@${manifest.version}.`);
    return ok(plugin);
  };

  return {
    get size(): number {
      return loaded.size;
    },
    has(pluginId: string): boolean {
      return loaded.has(pluginId);
    },
    list(): readonly LoadedPlugin[] {
      return Object.freeze([...loaded.values()].map(({ plugin }) => plugin));
    },
    async load(candidate: PluginCandidate): Promise<Result<LoadedPlugin, PluginError>> {
      if (options.loader === undefined) {
        return err(
          pluginError(
            "load-failed",
            candidate.manifest.id,
            "Nenhum carregador de módulos foi configurado.",
          ),
        );
      }
      let module: PluginModule<C>;
      try {
        module = await options.loader.load(candidate.entryPath);
      } catch (cause: unknown) {
        return err(
          pluginError(
            "load-failed",
            candidate.manifest.id,
            `Não foi possível carregar "${candidate.entryPath}".`,
            cause,
          ),
        );
      }
      return loadModule(candidate.manifest, module);
    },
    loadModule,
    unload(pluginId: string): Result<void, PluginError> {
      const state = loaded.get(pluginId);
      if (state === undefined) {
        return err(
          pluginError("not-loaded", pluginId, `O plugin "${pluginId}" não está carregado.`),
        );
      }
      loaded.delete(pluginId);
      try {
        state.scope.dispose();
      } catch (cause: unknown) {
        return err(
          pluginError(
            "unload-failed",
            pluginId,
            `O plugin "${pluginId}" foi removido, mas um descarte falhou.`,
            cause,
          ),
        );
      }
      logger.info(`Plugin descarregado: ${pluginId}.`);
      return ok(undefined);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const states = [...loaded.values()].reverse();
      loaded.clear();
      disposeAll(states.map(({ scope }) => scope));
    },
  };
}

function createScopedApi<C extends PluginContributionTypes>(
  manifest: PluginManifest,
  targets: PluginExtensionTargets<C>,
  scope: PluginScope,
  contributionCounts: Record<ExtensionPointName, number>,
  logger: Logger,
): PluginApi<C> {
  const registrationPoints = Object.fromEntries(
    EXTENSION_POINT_NAMES.map((name) => [
      name,
      scopedRegistrationPoint(targets[name], scope, manifest.id, () => {
        contributionCounts[name] += 1;
      }),
    ]),
  ) as PluginRegistrationApi<C>;
  return Object.freeze({ ...registrationPoints, manifest, logger });
}

function scopedRegistrationPoint<T>(
  target: RegistrationTarget<T>,
  scope: PluginScope,
  pluginId: string,
  onRegistered: () => void,
): { register(contribution: T): Disposable } {
  return Object.freeze({
    register(contribution: T): Disposable {
      if (!scope.active) {
        throw new Error(`O plugin "${pluginId}" já foi descarregado.`);
      }
      const disposable = scope.add(target.register(contribution));
      onRegistered();
      return disposable;
    },
  });
}

function emptyContributionCounts(): Record<ExtensionPointName, number> {
  return Object.fromEntries(EXTENSION_POINT_NAMES.map((name) => [name, 0])) as Record<
    ExtensionPointName,
    number
  >;
}

function pluginError(
  code: PluginErrorCode,
  pluginId: string,
  message: string,
  cause?: unknown,
): PluginError {
  return Object.freeze({ code, pluginId, message, ...(cause === undefined ? {} : { cause }) });
}
