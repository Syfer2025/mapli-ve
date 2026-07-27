import { err, ok, type Result } from "@theatrum/core-utils";

import { describeCause, projectError, type ProjectError } from "./errors.js";

export interface FileSystemEntry {
  readonly name: string;
  readonly kind: "directory" | "file";
}

/**
 * Porta mínima implementada pelo shell. `rename` deve substituir o destino de
 * forma atômica no mesmo volume; `sync` torna bytes anteriores duráveis.
 */
export interface ProjectFileSystemPort {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  sync(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<readonly FileSystemEntry[]>;
}

export async function writeAtomic(
  fileSystem: ProjectFileSystemPort,
  path: string,
  bytes: Uint8Array,
): Promise<Result<void, ProjectError>> {
  const temporaryPath = `${path}.tmp`;
  try {
    await fileSystem.write(temporaryPath, bytes);
    await fileSystem.sync(temporaryPath);
    await fileSystem.rename(temporaryPath, path);
    await fileSystem.sync(parentPath(path));
    return ok(undefined);
  } catch (cause) {
    try {
      await fileSystem.remove(temporaryPath);
    } catch {
      // O erro original é mais útil; adapters devem aceitar remoção idempotente.
    }
    return err(
      projectError(
        "io",
        `Não foi possível gravar "${path}" de forma atômica: ${describeCause(cause)}`,
        {
          path,
          cause,
        },
      ),
    );
  }
}

export async function readFile(
  fileSystem: ProjectFileSystemPort,
  path: string,
): Promise<Result<Uint8Array, ProjectError>> {
  try {
    return ok(await fileSystem.read(path));
  } catch (cause) {
    const missing =
      typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT";
    return err(
      projectError(
        missing ? "file-not-found" : "io",
        `Não foi possível ler "${path}": ${describeCause(cause)}`,
        {
          path,
          cause,
        },
      ),
    );
  }
}

export function joinPath(...segments: readonly string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) =>
      index === 0 ? segment.replace(/[\\/]+$/g, "") : segment.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .filter((segment) => segment.length > 0)
    .join("/");
}

function parentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  return separator <= 0 ? "." : normalized.slice(0, separator);
}
