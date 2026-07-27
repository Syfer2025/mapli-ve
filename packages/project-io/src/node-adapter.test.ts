import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyProjectDocument } from "@theatrum/schema";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectFileSystemPort } from "./filesystem.js";
import { saveProjectAtomic } from "./project-io.js";

/**
 * Adapter Node de referência para o Electron main. O produto pode envolver
 * erros com telemetria, mas a fronteira necessária é deliberadamente pequena.
 */
class NodeProjectFileSystem implements ProjectFileSystemPort {
  async read(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path, bytes);
  }

  async sync(path: string): Promise<void> {
    let handle;
    try {
      handle = await open(path, "r");
      await handle.sync();
    } catch (error) {
      // Windows não permite fsync de diretório; os arquivos temporários ainda
      // são sincronizados antes do rename.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EISDIR" && code !== "EPERM") throw error;
    } finally {
      await handle?.close();
    }
  }

  async rename(source: string, destination: string): Promise<void> {
    await rename(source, destination);
  }

  async remove(path: string, options?: { readonly recursive?: boolean }): Promise<void> {
    if (options?.recursive === true) await rm(path, { recursive: true, force: true });
    else
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async list(path: string) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }));
  }
}

describe("adapter Node de referência", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("produz dois arquivos reais byte-idênticos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "theatrum-project-io-"));
    temporaryDirectories.push(directory);
    const fs = new NodeProjectFileSystem();
    const document = createEmptyProjectDocument({ id: "prj_node_io", name: "Node IO" });
    const firstPath = join(directory, "first.theatrum");
    const secondPath = join(directory, "second.theatrum");

    expect(await saveProjectAtomic(fs, { path: firstPath, document })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await saveProjectAtomic(fs, { path: secondPath, document })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await readFile(firstPath)).toEqual(await readFile(secondPath));
  });
});
