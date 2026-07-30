import type { ActionTemplate } from "@theatrum/behaviors";
import { createBuiltinEffectRegistry, type EffectDefinition } from "@theatrum/effects";
import {
  createNamedExtensionRegistry,
  createPluginHost,
  type IdentifiedContribution,
  type PluginContributionTypes,
  type PluginExtensionTargets,
  type PluginModule,
  type RegistrationTarget,
} from "@theatrum/plugin-host";
import type { NodeTypeDefinition } from "@theatrum/scene-graph";
import type { LocalPluginInfo, LocalPluginScanResult } from "@theatrum/shell";
import { bridge } from "../bridge/index.js";
import {
  actionTemplateRegistry,
  editorActions,
  getEditorSessionSnapshot,
  nodeTypeRegistry,
} from "../document/editor-session.js";

const ENABLED_STORAGE_KEY = "theatrum.plugins.enabled.v1";

export interface PluginCommandContext {
  readonly actions: typeof editorActions;
  readonly snapshot: typeof getEditorSessionSnapshot;
}

export interface PluginCommandContribution extends IdentifiedContribution {
  readonly label: string;
  readonly description?: string;
  run(context: PluginCommandContext): void | Promise<void>;
}

interface EditorPluginContributions extends PluginContributionTypes {
  readonly nodeTypes: NodeTypeDefinition;
  readonly effects: EffectDefinition<unknown>;
  readonly actions: ActionTemplate<unknown>;
  readonly verbs: IdentifiedContribution;
  readonly exporters: IdentifiedContribution;
  readonly panels: IdentifiedContribution;
  readonly mapStyles: IdentifiedContribution;
  readonly commands: PluginCommandContribution;
}

export interface EditorPluginRuntimeSnapshot {
  readonly initialized: boolean;
  readonly scanning: boolean;
  readonly scan: LocalPluginScanResult | null;
  readonly loadedIds: ReadonlySet<string>;
  readonly busyIds: ReadonlySet<string>;
  readonly errors: Readonly<Record<string, string>>;
  readonly commands: readonly PluginCommandContribution[];
}

const verbs = createNamedExtensionRegistry<IdentifiedContribution>();
const exporters = createNamedExtensionRegistry<IdentifiedContribution>();
const panels = createNamedExtensionRegistry<IdentifiedContribution>();
const mapStyles = createNamedExtensionRegistry<IdentifiedContribution>();
const commands = createNamedExtensionRegistry<PluginCommandContribution>();

/** Registro compartilhado pelos consumidores do editor e por plugins. */
export const editorEffectRegistry = createBuiltinEffectRegistry();

const targets: PluginExtensionTargets<EditorPluginContributions> = {
  nodeTypes: registrationTarget(nodeTypeRegistry),
  effects: registrationTarget(editorEffectRegistry),
  actions: registrationTarget(actionTemplateRegistry),
  verbs,
  exporters,
  panels,
  mapStyles,
  commands: {
    get size(): number {
      return commands.size;
    },
    register(command): ReturnType<typeof commands.register> {
      if (
        typeof command !== "object" ||
        command === null ||
        typeof command.id !== "string" ||
        typeof command.label !== "string" ||
        command.label.trim().length === 0 ||
        typeof command.run !== "function"
      ) {
        throw new TypeError("Comando de plugin precisa de id, label e run(context).");
      }
      return commands.register(
        Object.freeze({
          ...command,
          label: command.label.trim(),
        }),
      );
    },
  },
};

const host = createPluginHost<EditorPluginContributions>({ targets });
const listeners = new Set<() => void>();
let initialized = false;
let scanning = false;
let scan: LocalPluginScanResult | null = null;
let busyIds = new Set<string>();
let errors: Record<string, string> = {};
let snapshot = buildSnapshot();
let initialization: Promise<void> | null = null;

export function subscribeEditorPluginRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEditorPluginRuntimeSnapshot(): EditorPluginRuntimeSnapshot {
  return snapshot;
}

export function initializeEditorPluginRuntime(): Promise<void> {
  initialization ??= refreshEditorPlugins(true);
  return initialization;
}

export async function refreshEditorPlugins(restoreEnabled = false): Promise<void> {
  if (scanning) return;
  scanning = true;
  publish();
  try {
    scan = await bridge.plugins.scan();
    errors = Object.fromEntries(
      Object.entries(errors).filter(([id]) =>
        scan?.plugins.some((item) => item.manifest.id === id),
      ),
    );
    if (restoreEnabled) {
      const available = new Set(scan.plugins.map(({ manifest }) => manifest.id));
      for (const id of enabledPluginIds()) {
        if (available.has(id) && !host.has(id)) await loadEditorPlugin(id, false);
      }
    }
  } catch (cause: unknown) {
    scan = {
      root: "",
      plugins: [],
      diagnostics: [
        {
          directory: "",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ],
    };
  } finally {
    initialized = true;
    scanning = false;
    publish();
  }
}

export async function loadEditorPlugin(pluginId: string, persist = true): Promise<boolean> {
  if (host.has(pluginId)) return true;
  if (busyIds.has(pluginId)) return false;
  const info = scan?.plugins.find(({ manifest }) => manifest.id === pluginId);
  if (info === undefined) {
    errors = { ...errors, [pluginId]: "Plugin não está no último escaneamento válido." };
    publish();
    return false;
  }

  busyIds = new Set([...busyIds, pluginId]);
  errors = withoutKey(errors, pluginId);
  publish();
  try {
    const moduleResult = await bridge.plugins.module(pluginId);
    if (!moduleResult.ok) throw new Error(moduleResult.message);
    const module = await importPluginSource(moduleResult.plugin, moduleResult.source);
    const result = await host.loadModule(moduleResult.plugin.manifest, module);
    if (!result.ok) throw new Error(result.error.message);
    if (persist) updateEnabled(pluginId, true);
    return true;
  } catch (cause: unknown) {
    errors = {
      ...errors,
      [pluginId]: cause instanceof Error ? cause.message : String(cause),
    };
    return false;
  } finally {
    busyIds = new Set([...busyIds].filter((id) => id !== pluginId));
    publish();
  }
}

export function unloadEditorPlugin(pluginId: string): boolean {
  const result = host.unload(pluginId);
  if (!result.ok) {
    errors = { ...errors, [pluginId]: result.error.message };
    publish();
    return false;
  }
  updateEnabled(pluginId, false);
  errors = withoutKey(errors, pluginId);
  publish();
  return true;
}

export async function runPluginCommand(commandId: string): Promise<boolean> {
  const command = commands.get(commandId);
  if (command === undefined) return false;
  try {
    await command.run({
      actions: editorActions,
      snapshot: getEditorSessionSnapshot,
    });
    errors = withoutKey(errors, commandId);
    publish();
    return true;
  } catch (cause: unknown) {
    errors = {
      ...errors,
      [commandId]: cause instanceof Error ? cause.message : String(cause),
    };
    publish();
    return false;
  }
}

function registrationTarget<T>(target: RegistrationTarget<T>): RegistrationTarget<T> {
  return {
    get size(): number {
      return target.size;
    },
    register(contribution) {
      return target.register(contribution);
    },
  };
}

async function importPluginSource(
  plugin: LocalPluginInfo,
  source: string,
): Promise<PluginModule<EditorPluginContributions>> {
  const sourceName = plugin.manifest.id.replaceAll(/[^a-z0-9.-]/gi, "-");
  const blob = new Blob([`${source}\n//# sourceURL=theatrum-plugin-${sourceName}.mjs\n`], {
    type: "text/javascript",
  });
  const url = URL.createObjectURL(blob);
  try {
    const imported = (await import(/* @vite-ignore */ url)) as {
      readonly activate?: unknown;
      readonly default?: unknown;
    };
    const candidate =
      typeof imported.activate === "function"
        ? imported.activate
        : typeof imported.default === "object" &&
            imported.default !== null &&
            "activate" in imported.default
          ? (imported.default as { readonly activate?: unknown }).activate
          : undefined;
    if (typeof candidate !== "function") {
      throw new TypeError('O módulo precisa exportar a função "activate(api)".');
    }
    return Object.freeze({
      activate: (api: Parameters<PluginModule<EditorPluginContributions>["activate"]>[0]) =>
        candidate(api) as ReturnType<PluginModule<EditorPluginContributions>["activate"]>,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildSnapshot(): EditorPluginRuntimeSnapshot {
  return Object.freeze({
    initialized,
    scanning,
    scan,
    loadedIds: new Set(host.list().map(({ manifest }) => manifest.id)),
    busyIds: new Set(busyIds),
    errors: Object.freeze({ ...errors }),
    commands: commands.list(),
  });
}

function publish(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function enabledPluginIds(): readonly string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ENABLED_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function updateEnabled(pluginId: string, enabled: boolean): void {
  try {
    const ids = new Set(enabledPluginIds());
    if (enabled) ids.add(pluginId);
    else ids.delete(pluginId);
    localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify([...ids].sort()));
  } catch {
    // Preferência local não pode transformar uma ativação bem-sucedida em erro.
  }
}

function withoutKey(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key));
}
