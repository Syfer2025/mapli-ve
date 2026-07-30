import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeExportFile } from "./export-publication.js";

const roots: string[] = [];

async function jobDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "theatrum-publication-"));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("finalizeExportFile", () => {
  it("publica por rename somente depois de o temporário estar completo", async () => {
    const directory = await jobDirectory();
    const temporaryFilename = ".theatrum-job-1234.mp4";
    await writeFile(join(directory, temporaryFilename), "arquivo completo");

    const result = await finalizeExportFile({
      action: "publish",
      directory,
      temporaryFilename,
      finalFilename: "Cena.mp4",
    });

    expect(result).toMatchObject({
      ok: true,
      filename: "Cena.mp4",
      bytes: 16,
      temporaryDisposition: "published",
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(join(directory, "Cena.mp4"), "utf8")).resolves.toBe("arquivo completo");
    await expect(readFile(join(directory, temporaryFilename))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("substitui um resultado anterior sem anexar bytes do job novo", async () => {
    const directory = await jobDirectory();
    const temporaryFilename = ".theatrum-job-novo.mp4";
    await writeFile(join(directory, temporaryFilename), "novo completo");
    await writeFile(join(directory, "Cena.mp4"), "resultado anterior");

    const result = await finalizeExportFile({
      action: "publish",
      directory,
      temporaryFilename,
      finalFilename: "Cena.mp4",
    });

    expect(result.ok).toBe(true);
    await expect(readFile(join(directory, "Cena.mp4"), "utf8")).resolves.toBe("novo completo");
  });

  it("descarta um MP4 parcial e relata a remoção", async () => {
    const directory = await jobDirectory();
    const temporaryFilename = ".theatrum-job-parcial.mp4";
    await writeFile(join(directory, temporaryFilename), "prefixo inválido");

    const result = await finalizeExportFile({
      action: "discard",
      directory,
      temporaryFilename,
    });

    expect(result).toMatchObject({ ok: true, temporaryDisposition: "removed" });
    expect(result.message).toContain("temporário removido");
    await expect(readFile(join(directory, temporaryFilename))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserva o temporário e diagnostica quando a publicação falha", async () => {
    const directory = await jobDirectory();
    const temporaryFilename = ".theatrum-job-recuperavel.mov";
    await writeFile(join(directory, temporaryFilename), "recuperável");
    await mkdir(join(directory, "Cena.mov"));

    const result = await finalizeExportFile({
      action: "publish",
      directory,
      temporaryFilename,
      finalFilename: "Cena.mov",
    });

    expect(result.ok).toBe(false);
    expect(result.temporaryDisposition).toBe("preserved");
    expect(result.message).toContain("temporário preservado");
    await expect(readFile(join(directory, temporaryFilename), "utf8")).resolves.toBe("recuperável");
  });

  it("recusa publicar um nome que não pertence à reserva do Theatrum", async () => {
    const directory = await jobDirectory();
    await writeFile(join(directory, "qualquer.mp4"), "não autorizado");

    const result = await finalizeExportFile({
      action: "publish",
      directory,
      temporaryFilename: "qualquer.mp4",
      finalFilename: "Cena.mp4",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nome temporário");
    await expect(readFile(join(directory, "Cena.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
