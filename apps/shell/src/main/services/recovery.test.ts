import {
  createEmbeddedAsset,
  parseProjectContainer,
  serializeProjectContainer,
} from "@theatrum/project-io";
import { createEmptyProjectDocument, ProjectDocumentSchema } from "@theatrum/schema";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => electron.userDataPath,
  },
}));

import { closeRecoveryClean, recordRecovery, recoverDocument, startRecovery } from "./recovery.js";

describe("recovery container sidecar", () => {
  beforeEach(async () => {
    electron.userDataPath = await mkdtemp(path.join(tmpdir(), "theatrum-recovery-sidecar-"));
  });

  afterEach(async () => {
    await closeRecoveryClean();
    await rm(electron.userDataPath, { recursive: true, force: true });
  });

  it("preserva assets no sidecar e devolve o documento incremental recuperado", async () => {
    const embedded = createEmbeddedAsset(Uint8Array.of(1, 3, 3, 7), "bin");
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;

    const document = ProjectDocumentSchema.parse({
      ...createEmptyProjectDocument({ id: "prj_sidecar" }),
      assets: [
        {
          id: "ast_sidecar",
          kind: "binary",
          src: embedded.value.path,
          meta: {},
        },
      ],
    });
    const container = serializeProjectContainer({
      document,
      assets: [embedded.value],
      notes: "Notas preservadas",
    });
    expect(container.ok).toBe(true);
    if (!container.ok) return;

    await expect(
      startRecovery({
        document,
        projectPath: null,
        container: container.value,
      }),
    ).resolves.toEqual({ ok: true });

    const edited = ProjectDocumentSchema.parse({
      ...document,
      name: "Documento recuperado",
    });
    await expect(recordRecovery({ document: edited, commands: 1, force: true })).resolves.toEqual({
      ok: true,
    });

    const recovered = await recoverDocument(document.id);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.document).toMatchObject({ name: "Documento recuperado" });
    expect(recovered.container).not.toBeNull();

    const parsedContainer = parseProjectContainer(recovered.container as Uint8Array);
    expect(parsedContainer.ok).toBe(true);
    if (!parsedContainer.ok) return;
    expect(parsedContainer.value.assets.get(embedded.value.path)).toEqual(embedded.value.bytes);
    expect(parsedContainer.value.notes).toBe("Notas preservadas");

    await expect(closeRecoveryClean()).resolves.toEqual({ ok: true });
    await expect(
      stat(path.join(electron.userDataPath, "recovery", document.id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("mantém o sidecar opcional para projeto novo", async () => {
    const document = createEmptyProjectDocument({ id: "prj_without_sidecar" });
    await expect(startRecovery({ document, projectPath: null })).resolves.toEqual({ ok: true });

    const recovered = await recoverDocument(document.id);
    expect(recovered).toMatchObject({ ok: true, container: null });
  });
});
