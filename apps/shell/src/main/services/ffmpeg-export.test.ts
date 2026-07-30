import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

import type { ExportEncodeRequest } from "../../ipc/contracts.js";
import { encodeExportFrames } from "./ffmpeg-export.js";

const roots: string[] = [];

async function stagedRequest(
  format: "gif" | "prores4444",
): Promise<{ request: ExportEncodeRequest; finalPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "theatrum-ffmpeg-"));
  roots.push(directory);
  const framesDirectory = join(directory, ".theatrum-frames-prova");
  await mkdir(framesDirectory);
  await writeFile(join(framesDirectory, "Cena_0000.png"), "png");
  const outputFilename = format === "gif" ? "Cena.gif" : "Cena.mov";
  return {
    request: {
      directory,
      framesDirectory,
      format,
      fps: 30,
      framePrefix: "Cena",
      digits: 4,
      outputFilename,
    },
    finalPath: join(directory, outputFilename),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("encodeExportFrames — publicação atômica", () => {
  for (const format of ["gif", "prores4444"] as const) {
    it(`${format} só ganha o nome final depois de todos os passes`, async () => {
      const { request, finalPath } = await stagedRequest(format);
      const outputs: string[] = [];
      const result = await encodeExportFrames(request, {
        temporaryId: () => "job-fixo",
        runFfmpeg: async (args) => {
          await expect(stat(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
          const output = args.at(-1);
          if (output === undefined) throw new Error("plano sem saída");
          outputs.push(output);
          await writeFile(output, output.endsWith("palette.png") ? "paleta" : `${format}-completo`);
        },
      });

      expect(result).toMatchObject({
        ok: true,
        filename: basename(finalPath),
      });
      await expect(readFile(finalPath, "utf8")).resolves.toBe(`${format}-completo`);
      expect(outputs.at(-1)).toContain(".theatrum-job-fixo-");
      await expect(stat(request.framesDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    });
  }

  it("falha do FFmpeg não cria saída final e remove o vídeo parcial", async () => {
    const { request, finalPath } = await stagedRequest("prores4444");
    let temporaryPath = "";
    const result = await encodeExportFrames(request, {
      temporaryId: () => "falha",
      runFfmpeg: async (args) => {
        temporaryPath = args.at(-1) ?? "";
        await writeFile(temporaryPath, "mov parcial");
        throw new Error("codec interrompido");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("codec interrompido");
    expect(result.message).toContain("temporário removido");
    await expect(stat(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(request.framesDirectory)).resolves.toBeDefined();
  });
});
