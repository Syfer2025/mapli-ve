import { err, ok, type Result } from "@theatrum/core-utils";
import {
  parsePluginManifest,
  type ManifestDiagnostic,
  type PluginManifest,
} from "./manifest.js";

export interface PluginFileSystem {
  listDirectories(directory: string): Promise<readonly string[]>;
  readText(path: string): Promise<string>;
  join(base: string, ...parts: readonly string[]): string;
}

export interface PluginCandidate {
  readonly directory: string;
  readonly entryPath: string;
  readonly manifest: PluginManifest;
}

export interface PluginDiscoveryDiagnostic {
  readonly directory: string;
  readonly message: string;
  readonly manifestDiagnostics?: readonly ManifestDiagnostic[];
}

export interface PluginDiscovery {
  readonly plugins: readonly PluginCandidate[];
  readonly diagnostics: readonly PluginDiscoveryDiagnostic[];
}

export async function discoverPlugins(
  root: string,
  fileSystem: PluginFileSystem,
): Promise<Result<PluginDiscovery, PluginDiscoveryDiagnostic>> {
  let directories: readonly string[];
  try {
    directories = await fileSystem.listDirectories(root);
  } catch (cause: unknown) {
    return err({
      directory: root,
      message: `Não foi possível listar plugins: ${describeCause(cause)}`,
    });
  }

  const plugins: PluginCandidate[] = [];
  const diagnostics: PluginDiscoveryDiagnostic[] = [];
  for (const directory of [...directories].sort()) {
    const manifestPath = fileSystem.join(directory, "plugin.json");
    let text: string;
    try {
      text = await fileSystem.readText(manifestPath);
    } catch (cause: unknown) {
      diagnostics.push({
        directory,
        message: `Não foi possível ler plugin.json: ${describeCause(cause)}`,
      });
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (cause: unknown) {
      diagnostics.push({
        directory,
        message: `plugin.json não contém JSON válido: ${describeCause(cause)}`,
      });
      continue;
    }

    const parsed = parsePluginManifest(raw);
    if (!parsed.ok) {
      diagnostics.push({
        directory,
        message: "Manifesto de plugin inválido.",
        manifestDiagnostics: parsed.error,
      });
      continue;
    }
    plugins.push(
      Object.freeze({
        directory,
        entryPath: fileSystem.join(
          directory,
          ...parsed.value.entry.replaceAll("\\", "/").split("/"),
        ),
        manifest: parsed.value,
      }),
    );
  }

  return ok(
    Object.freeze({
      plugins: Object.freeze(plugins),
      diagnostics: Object.freeze(diagnostics),
    }),
  );
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
