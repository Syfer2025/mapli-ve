import { createEmptyProjectDocument, type Node } from "@theatrum/schema";
import { describe, expect, it, vi } from "vitest";
import { discoverPlugins, type PluginFileSystem } from "./discovery.js";
import {
  createNamedExtensionRegistry,
  type PluginContributionTypes,
  type PluginExtensionTargets,
} from "./extensions.js";
import { createPluginHost, type PluginApi } from "./host.js";
import {
  EXTENSION_POINT_NAMES,
  parsePluginManifest,
  type ExtensionPointName,
  type PluginManifest,
} from "./manifest.js";
import { createUnresolvedNodePlaceholder, restoreUnresolvedNode } from "./unresolved.js";

interface TestContribution {
  readonly id: string;
  readonly value?: string;
}

type TestContributions = Readonly<Record<ExtensionPointName, TestContribution>> &
  PluginContributionTypes;

function manifest(id = "com.example.armored"): PluginManifest {
  return {
    id,
    name: "Armored",
    version: "1.2.3",
    apiVersion: 1,
    entry: "dist/index.js",
    contributes: {},
  };
}

function targets(): PluginExtensionTargets<TestContributions> {
  return Object.fromEntries(
    EXTENSION_POINT_NAMES.map((name) => [name, createNamedExtensionRegistry<TestContribution>()]),
  ) as unknown as PluginExtensionTargets<TestContributions>;
}

describe("plugin manifest e descoberta", () => {
  it("valida API, SemVer, pontos de extensão e impede fuga do diretório", () => {
    const valid = parsePluginManifest({
      ...manifest(),
      contributes: {
        nodeTypes: ["unit.tank-heavy"],
        actions: ["breakthrough"],
        verbs: ["avancar"],
      },
    });
    expect(valid.ok).toBe(true);

    const invalid = parsePluginManifest({
      ...manifest("invalid"),
      version: "latest",
      apiVersion: 99,
      entry: "../outside.js",
      contributes: { unknown: ["x"] },
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error("fixture inválido");
    expect(invalid.error.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["/id", "/version", "/apiVersion", "/entry", "/contributes/unknown"]),
    );
  });

  it("descobre candidatos válidos e isola manifests quebrados", async () => {
    const contents = new Map<string, string>([
      ["/plugins/a/plugin.json", JSON.stringify(manifest("com.example.a"))],
      ["/plugins/b/plugin.json", "not-json"],
    ]);
    const fileSystem: PluginFileSystem = {
      async listDirectories() {
        return ["/plugins/b", "/plugins/a"];
      },
      async readText(path) {
        const value = contents.get(path);
        if (value === undefined) throw new Error("ausente");
        return value;
      },
      join(base, ...parts) {
        return [base, ...parts].join("/");
      },
    };

    const result = await discoverPlugins("/plugins", fileSystem);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture inválido");
    expect(result.value.plugins).toMatchObject([
      {
        directory: "/plugins/a",
        entryPath: "/plugins/a/dist/index.js",
        manifest: { id: "com.example.a" },
      },
    ]);
    expect(result.value.diagnostics).toHaveLength(1);
  });
});

describe("plugin host", () => {
  it("adiciona tipo de unidade, Action e verbo e remove tudo no unload", async () => {
    const registries = targets();
    const host = createPluginHost<TestContributions>({ targets: registries });
    const loaded = await host.loadModule(manifest(), {
      activate(api) {
        api.nodeTypes.register({ id: "plugin.tank-heavy" });
        api.actions.register({ id: "plugin.breakthrough" });
        api.verbs.register({ id: "plugin.advance" });
      },
    });

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        contributionCounts: {
          nodeTypes: 1,
          actions: 1,
          verbs: 1,
        },
      },
    });
    expect(registries.nodeTypes.size).toBe(1);
    expect(registries.actions.size).toBe(1);
    expect(registries.verbs.size).toBe(1);

    expect(host.unload(manifest().id)).toEqual({ ok: true, value: undefined });
    expect(EXTENSION_POINT_NAMES.map((name) => registries[name].size)).toEqual(
      Array.from({ length: EXTENSION_POINT_NAMES.length }, () => 0),
    );
  });

  it("reverte registros feitos antes de uma falha de ativação", async () => {
    const registries = targets();
    const host = createPluginHost<TestContributions>({ targets: registries });
    const result = await host.loadModule(manifest(), {
      activate(api) {
        api.nodeTypes.register({ id: "plugin.partial" });
        api.effects.register({ id: "plugin.partial-effect" });
        throw new Error("falha deliberada");
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "activation-failed" } });
    expect(host.size).toBe(0);
    expect(registries.nodeTypes.size).toBe(0);
    expect(registries.effects.size).toBe(0);
  });

  it("não aceita registro tardio depois de descarregar", async () => {
    const registries = targets();
    const host = createPluginHost<TestContributions>({ targets: registries });
    let captured: PluginApi<TestContributions> | undefined;
    await host.loadModule(manifest(), {
      activate(api) {
        captured = api;
      },
    });
    host.unload(manifest().id);

    expect(() => captured?.panels.register({ id: "plugin.late" })).toThrow(
      "já foi descarregado",
    );
    expect(registries.panels.size).toBe(0);
  });

  it("chama o cleanup do módulo e torna unload idempotente por diagnóstico", async () => {
    const cleanup = vi.fn();
    const host = createPluginHost<TestContributions>({ targets: targets() });
    await host.loadModule(manifest(), { activate: () => ({ dispose: cleanup }) });

    expect(host.unload(manifest().id).ok).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.unload(manifest().id)).toMatchObject({
      ok: false,
      error: { code: "not-loaded" },
    });
  });
});

describe("nó de plugin ausente", () => {
  it("produz placeholder visível e preserva todos os dados no round-trip", () => {
    const document = createEmptyProjectDocument();
    const base = document.compositions[0]?.nodes["nd_root"];
    if (base === undefined) throw new Error("fixture inválido");
    const node = {
      ...base,
      type: "plugin.future-tank",
      props: { nested: { values: [1, 2, 3] } },
      pluginPayload: { opaque: true, revision: 7 },
    } as Node;

    const placeholder = createUnresolvedNodePlaceholder(node);
    expect(placeholder.label).toContain("plugin.future-tank");
    expect(restoreUnresolvedNode(placeholder)).toEqual(node);
  });
});
