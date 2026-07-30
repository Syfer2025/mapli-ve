import { describe, expect, it, vi } from "vitest";

vi.mock("./export-service.js", () => ({
  startAlphaPngSequenceExport: vi.fn(),
  startGifExport: vi.fn(),
  startPngSequenceExport: vi.fn(),
  startProRes4444Export: vi.fn(),
  startVideoExport: vi.fn(),
}));
import {
  bindExportViewport,
  estimatedSecondsLeft,
  getExportJobSnapshot,
  isExportReady,
  nextAverageMsPerFrame,
  startExportJob,
  type ExportJobState,
} from "./export-controller.js";
import { startPngSequenceExport } from "./export-service.js";

function job(overrides: Partial<ExportJobState> = {}): ExportJobState {
  return {
    ...getExportJobSnapshot(),
    status: "running",
    phase: "rendering",
    done: 2,
    total: 10,
    msPerFrame: 100,
    ...overrides,
  };
}

describe("progresso do export", () => {
  it("heartbeat no mesmo frame preserva a média; escrita nova a atualiza", () => {
    expect(nextAverageMsPerFrame({ done: 1, msPerFrame: 800 }, { done: 1, elapsedMs: 1_600 })).toBe(
      800,
    );
    expect(nextAverageMsPerFrame({ done: 1, msPerFrame: 800 }, { done: 2, elapsedMs: 1_800 })).toBe(
      900,
    );
  });

  it("ETA só aparece depois de dois frames e nunca durante finalização", () => {
    expect(estimatedSecondsLeft(job({ done: 1 }))).toBeNull();
    expect(estimatedSecondsLeft(job({ done: 2 }))).toBe(0.8);
    expect(estimatedSecondsLeft(job({ phase: "finalizing" }))).toBeNull();
  });
});

describe("lease do viewport de export", () => {
  it("cleanup antigo não apaga o binding mais novo", () => {
    const cleanupA = bindExportViewport({
      probe: () => ({ frame: 0, renders: 0, pendingAssets: 0 }),
    });
    const cleanupB = bindExportViewport({
      probe: () => ({ frame: 1, renders: 1, pendingAssets: 0 }),
    });

    cleanupA();
    expect(isExportReady()).toBe(true);
    cleanupB();
    expect(isExportReady()).toBe(false);
  });

  it("trocar a fonte torna shouldAbort verdadeiro no job capturado", async () => {
    const cleanupA = bindExportViewport({
      probe: () => ({ frame: 0, renders: 0, pendingAssets: 0 }),
    });
    const png = vi.mocked(startPngSequenceExport);
    png.mockImplementationOnce(async (options) => {
      expect(options.shouldAbort?.()).toBe(false);
      const cleanupB = bindExportViewport({
        probe: () => ({ frame: 1, renders: 1, pendingAssets: 0 }),
      });
      expect(options.shouldAbort?.()).toBe(true);
      cleanupB();
      return { ok: false, directory: "", message: "fonte trocada" };
    });

    await startExportJob({ format: "png" });
    cleanupA();
    expect(getExportJobSnapshot().status).toBe("failed");
  });

  it("não deixa o estado preso em running quando o serviço lança", async () => {
    const cleanup = bindExportViewport({
      probe: () => ({ frame: 0, renders: 0, pendingAssets: 0 }),
    });
    vi.mocked(startPngSequenceExport).mockRejectedValueOnce(new Error("IPC encerrado"));

    await startExportJob({ format: "png" });

    expect(getExportJobSnapshot()).toMatchObject({
      status: "failed",
      phase: "idle",
      message: expect.stringContaining("IPC encerrado"),
    });
    cleanup();
  });
});
