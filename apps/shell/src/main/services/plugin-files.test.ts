import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalPluginModule, scanLocalPlugins } from "./plugin-files.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "theatrum-plugins-"));
  roots.push(root);
  return root;
}

async function writePlugin(
  root: string,
  directory: string,
  input: {
    readonly id?: string;
    readonly entry?: string;
    readonly source?: string;
    readonly extra?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const pluginDirectory = path.join(root, directory);
  await mkdir(pluginDirectory, { recursive: true });
  const entry = input.entry ?? "index.mjs";
  await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify({
      id: input.id ?? `com.test.${directory}`,
      name: directory,
      version: "1.0.0",
      apiVersion: 1,
      entry,
      contributes: { commands: [`${directory}.hello`] },
      ...input.extra,
    }),
    "utf8",
  );
  await writeFile(
    path.join(pluginDirectory, entry),
    input.source ?? "export function activate() {}",
    "utf8",
  );
}

describe("plugin-files", () => {
  it("descobre em ordem, valida e lê o módulo pelo ID", async () => {
    const root = await temporaryRoot();
    await writePlugin(root, "zeta", { source: "export const value = 42;" });
    await writePlugin(root, "alpha");

    const scan = await scanLocalPlugins(root);
    expect(scan.plugins.map(({ directory }) => directory)).toEqual(["alpha", "zeta"]);
    expect(scan.diagnostics).toEqual([]);

    const module = await readLocalPluginModule(root, "com.test.zeta");
    expect(module).toMatchObject({ ok: true, source: "export const value = 42;" });
  });

  it("recusa IDs duplicados em vez de escolher pela ordem do disco", async () => {
    const root = await temporaryRoot();
    await writePlugin(root, "one", { id: "com.test.duplicate" });
    await writePlugin(root, "two", { id: "com.test.duplicate" });

    const scan = await scanLocalPlugins(root);
    expect(scan.plugins).toEqual([]);
    expect(scan.diagnostics.filter(({ message }) => message.includes("duplicado"))).toHaveLength(2);
    await expect(readLocalPluginModule(root, "com.test.duplicate")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("recusa uma pasta simbólica que escapa da raiz", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writePlugin(outside, "escaped");
    const target = path.join(outside, "escaped");
    const link = path.join(root, "link");
    try {
      await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }

    const scan = await scanLocalPlugins(root);
    expect(scan.plugins).toEqual([]);
    expect(scan.diagnostics[0]?.message).toContain("fora da raiz");
  });

  it("não aceita entrada fora da pasta nem extensões não executáveis", async () => {
    const root = await temporaryRoot();
    await writePlugin(root, "text", { entry: "index.txt" });

    const scan = await scanLocalPlugins(root);
    expect(scan.plugins).toEqual([]);
    expect(scan.diagnostics[0]?.message).toContain(".js ou .mjs");
  });
});
