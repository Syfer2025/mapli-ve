import { createEmptyProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";

import { openProject, saveProjectAtomic } from "./project-io.js";
import { MemoryProjectFileSystem } from "./test-support.js";

const document = createEmptyProjectDocument({ id: "prj_atomic", name: "Atomicidade" });

describe("saveProjectAtomic", () => {
  it("grava tmp, sincroniza, renomeia e sincroniza o diretório", async () => {
    const fs = new MemoryProjectFileSystem();
    fs.directories.add("projects");
    const result = await saveProjectAtomic(fs, {
      document,
      path: "projects/demo.theatrum",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fs.operations.slice(-4)).toEqual([
      "write:projects/demo.theatrum.tmp",
      "sync:projects/demo.theatrum.tmp",
      "rename:projects/demo.theatrum.tmp:projects/demo.theatrum",
      "sync:projects",
    ]);
    const opened = await openProject(fs, "projects/demo.theatrum");
    expect(opened.ok && opened.value.document).toEqual(document);
  });

  it("preserva o arquivo anterior quando rename falha e limpa tmp", async () => {
    const fs = new MemoryProjectFileSystem();
    const path = "demo.theatrum";
    fs.files.set(path, Uint8Array.of(4, 2));
    fs.failRename = true;

    const result = await saveProjectAtomic(fs, { document, path });
    expect(result).toMatchObject({ ok: false, error: { code: "io", path } });
    expect(fs.files.get(path)).toEqual(Uint8Array.of(4, 2));
    expect(fs.files.has(`${path}.tmp`)).toBe(false);
  });
});
