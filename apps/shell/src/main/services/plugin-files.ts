/**
 * Descoberta e leitura segura de plugins locais.
 *
 * O renderer nunca recebe um caminho arbitrário para ler. Ele pede um ID já
 * descoberto e o processo main resolve novamente manifesto e entrypoint dentro
 * de `userData/plugins`, conferindo `realpath` nas duas etapas. Assim uma junção
 * ou symlink não transforma a pasta de plugins numa capacidade de leitura do
 * restante da máquina.
 */

import { parsePluginManifest, type PluginManifest } from "@theatrum/plugin-host";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const MANIFEST_FILE = "plugin.json";
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_MODULE_BYTES = 2 * 1024 * 1024;
const MODULE_EXTENSIONS = new Set([".js", ".mjs"]);

export interface LocalPluginInfo {
  readonly directory: string;
  readonly manifest: PluginManifest;
}

export interface LocalPluginDiagnostic {
  readonly directory: string;
  readonly message: string;
  readonly details?: readonly { readonly path: string; readonly message: string }[];
}

export interface LocalPluginScanResult {
  readonly root: string;
  readonly plugins: readonly LocalPluginInfo[];
  readonly diagnostics: readonly LocalPluginDiagnostic[];
}

export type LocalPluginModuleResult =
  | {
      readonly ok: true;
      readonly plugin: LocalPluginInfo;
      readonly source: string;
    }
  | { readonly ok: false; readonly message: string };

interface ResolvedPlugin {
  readonly info: LocalPluginInfo;
  readonly entryPath: string;
}

export async function scanLocalPlugins(root: string): Promise<LocalPluginScanResult> {
  const resolved = await resolveLocalPlugins(root);
  return Object.freeze({
    root: resolved.root,
    plugins: Object.freeze(resolved.plugins.map(({ info }) => info)),
    diagnostics: resolved.diagnostics,
  });
}

export async function readLocalPluginModule(
  root: string,
  pluginId: string,
): Promise<LocalPluginModuleResult> {
  const resolved = await resolveLocalPlugins(root);
  const matches = resolved.plugins.filter(({ info }) => info.manifest.id === pluginId);
  if (matches.length !== 1) {
    return Object.freeze({
      ok: false,
      message:
        matches.length === 0
          ? `Plugin não encontrado ou inválido: "${pluginId}".`
          : `O ID "${pluginId}" aparece em mais de um plugin.`,
    });
  }
  const candidate = matches[0];
  if (candidate === undefined) {
    return Object.freeze({ ok: false, message: `Plugin não encontrado: "${pluginId}".` });
  }
  try {
    const entryStat = await stat(candidate.entryPath);
    if (!entryStat.isFile()) {
      return Object.freeze({ ok: false, message: "A entrada do plugin não é um arquivo." });
    }
    if (entryStat.size > MAX_MODULE_BYTES) {
      return Object.freeze({
        ok: false,
        message: `A entrada excede o limite de ${String(MAX_MODULE_BYTES)} bytes.`,
      });
    }
    const source = await readFile(candidate.entryPath, "utf8");
    return Object.freeze({ ok: true, plugin: candidate.info, source });
  } catch (cause: unknown) {
    return Object.freeze({
      ok: false,
      message: `Não foi possível ler o módulo: ${describeCause(cause)}`,
    });
  }
}

async function resolveLocalPlugins(root: string): Promise<{
  readonly root: string;
  readonly plugins: readonly ResolvedPlugin[];
  readonly diagnostics: readonly LocalPluginDiagnostic[];
}> {
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  const diagnostics: LocalPluginDiagnostic[] = [];
  const plugins: ResolvedPlugin[] = [];
  const idDirectories = new Map<string, string[]>();
  let entries;
  try {
    entries = await readdir(realRoot, { withFileTypes: true });
  } catch (cause: unknown) {
    return {
      root: realRoot,
      plugins: Object.freeze([]),
      diagnostics: Object.freeze([
        {
          directory: realRoot,
          message: `Não foi possível listar plugins: ${describeCause(cause)}`,
        },
      ]),
    };
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const directory = path.join(realRoot, entry.name);
    const relativeDirectory = entry.name;
    try {
      const realDirectory = await realpath(directory);
      if (!isContained(realRoot, realDirectory)) {
        diagnostics.push({
          directory: relativeDirectory,
          message: "A pasta resolve para fora da raiz de plugins.",
        });
        continue;
      }
      const manifestPath = await realpath(path.join(realDirectory, MANIFEST_FILE));
      if (!isContained(realDirectory, manifestPath)) {
        diagnostics.push({
          directory: relativeDirectory,
          message: "plugin.json resolve para fora da pasta do plugin.",
        });
        continue;
      }
      const manifestStat = await stat(manifestPath);
      if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_BYTES) {
        diagnostics.push({
          directory: relativeDirectory,
          message: `plugin.json ausente, inválido ou maior que ${String(MAX_MANIFEST_BYTES)} bytes.`,
        });
        continue;
      }
      const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      const parsed = parsePluginManifest(raw);
      if (!parsed.ok) {
        diagnostics.push({
          directory: relativeDirectory,
          message: "Manifesto de plugin inválido.",
          details: parsed.error,
        });
        continue;
      }
      const entryPath = await realpath(path.resolve(realDirectory, parsed.value.entry));
      if (!isContained(realDirectory, entryPath)) {
        diagnostics.push({
          directory: relativeDirectory,
          message: "A entrada resolve para fora da pasta do plugin.",
        });
        continue;
      }
      if (!MODULE_EXTENSIONS.has(path.extname(entryPath).toLowerCase())) {
        diagnostics.push({
          directory: relativeDirectory,
          message: "A entrada precisa ser um módulo .js ou .mjs.",
        });
        continue;
      }
      const info = Object.freeze({
        directory: relativeDirectory,
        manifest: parsed.value,
      });
      plugins.push(Object.freeze({ info, entryPath }));
      const directories = idDirectories.get(parsed.value.id) ?? [];
      directories.push(relativeDirectory);
      idDirectories.set(parsed.value.id, directories);
    } catch (cause: unknown) {
      diagnostics.push({
        directory: relativeDirectory,
        message: `Não foi possível inspecionar o plugin: ${describeCause(cause)}`,
      });
    }
  }

  const duplicateIds = new Set(
    [...idDirectories.entries()]
      .filter(([, directories]) => directories.length > 1)
      .map(([id]) => id),
  );
  for (const id of duplicateIds) {
    const directories = idDirectories.get(id) ?? [];
    for (const directory of directories) {
      diagnostics.push({
        directory,
        message: `ID de plugin duplicado: "${id}" (${directories.join(", ")}).`,
      });
    }
  }

  return Object.freeze({
    root: realRoot,
    plugins: Object.freeze(plugins.filter(({ info }) => !duplicateIds.has(info.manifest.id))),
    diagnostics: Object.freeze(diagnostics),
  });
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
