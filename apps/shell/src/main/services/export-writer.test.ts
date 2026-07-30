import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {},
  dialog: {},
}));

import {
  appendExportBytes,
  beginExport,
  verifyExportFrames,
  writeExportFrame,
} from "./export-writer.js";
import { finalizeExportFile } from "./export-publication.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("appendExportBytes", () => {
  it("preserva o namespace oculto que a publicação atômica consumirá", async () => {
    const directory = await mkdtemp(join(tmpdir(), "theatrum-append-"));
    roots.push(directory);
    const filename = ".theatrum-job-Cena.mp4";

    await expect(
      appendExportBytes({
        directory,
        filename,
        bytes: Uint8Array.from([1, 2]),
        truncate: true,
      }),
    ).resolves.toMatchObject({ ok: true, bytes: 2 });
    await expect(
      appendExportBytes({
        directory,
        filename,
        bytes: Uint8Array.from([3]),
        truncate: false,
      }),
    ).resolves.toMatchObject({ ok: true, bytes: 1 });

    await expect(readFile(join(directory, filename))).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(stat(join(directory, "theatrum-job-Cena.mp4"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await expect(
      finalizeExportFile({
        action: "publish",
        directory,
        temporaryFilename: filename,
        finalFilename: "Cena.mp4",
      }),
    ).resolves.toMatchObject({ ok: true, temporaryDisposition: "published", bytes: 3 });
    await expect(readFile(join(directory, "Cena.mp4"))).resolves.toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("beginExport com checkpoint", () => {
  it("reabre a mesma pasta privada de frames quando ela pertence ao job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "theatrum-resume-"));
    roots.push(directory);
    const framesDirectory = join(directory, ".theatrum-frames-known");

    await expect(
      beginExport({} as Parameters<typeof beginExport>[0], {
        jobName: "Cena",
        directory,
        staging: true,
        framesDirectory,
      }),
    ).resolves.toEqual({ ok: true, directory, framesDirectory });
    expect((await stat(framesDirectory)).isDirectory()).toBe(true);
  });

  it("recusa pasta de checkpoint fora do diretório do job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "theatrum-resume-"));
    const outside = await mkdtemp(join(tmpdir(), "theatrum-outside-"));
    roots.push(directory, outside);

    await expect(
      beginExport({} as Parameters<typeof beginExport>[0], {
        jobName: "Cena",
        directory,
        staging: true,
        framesDirectory: join(outside, ".theatrum-frames-escape"),
      }),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining("não pertence") });
  });
});

describe("verifyExportFrames", () => {
  it("confere todos os hashes do prefixo persistido", async () => {
    const directory = await mkdtemp(join(tmpdir(), "theatrum-verify-"));
    roots.push(directory);
    const written = await writeExportFrame({
      directory,
      filename: "frame_000001.png",
      width: 1,
      height: 1,
      rgba: Uint8Array.from([7, 11, 13, 255]),
    });

    await expect(
      verifyExportFrames({
        directory,
        frames: [{ filename: "frame_000001.png", sha256: written.sha256 }],
      }),
    ).resolves.toEqual({ ok: true, verified: 1 });
  });

  it("recusa frame apagado, alterado ou nome inseguro", async () => {
    const directory = await mkdtemp(join(tmpdir(), "theatrum-verify-"));
    roots.push(directory);
    const written = await writeExportFrame({
      directory,
      filename: "frame_000001.png",
      width: 1,
      height: 1,
      rgba: Uint8Array.from([1, 2, 3, 255]),
    });
    await writeFile(join(directory, "frame_000001.png"), Uint8Array.from([0]));

    await expect(
      verifyExportFrames({
        directory,
        frames: [{ filename: "frame_000001.png", sha256: written.sha256 }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      verified: 0,
      invalidFilename: "frame_000001.png",
      message: expect.stringContaining("hash divergente"),
    });
    await expect(
      verifyExportFrames({
        directory,
        frames: [{ filename: "frame_000002.png", sha256: "0".repeat(64) }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      verified: 0,
      invalidFilename: "frame_000002.png",
    });
    await expect(
      verifyExportFrames({
        directory,
        frames: [{ filename: "../escape.png", sha256: "0".repeat(64) }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      verified: 0,
      invalidFilename: "../escape.png",
    });
  });
});
