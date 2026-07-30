import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashObject } from "@theatrum/core-utils";

const mocked = vi.hoisted(() => {
  const state: { status: "idle" | "done" | "aborted" | "failed"; message: string | null } = {
    status: "idle",
    message: null,
  };
  const session = {
    selectedCompositionId: "cmp_a",
    document: {
      compositions: [
        { id: "cmp_a", name: "Cena A" },
        { id: "cmp_b", name: "Cena B" },
      ],
    },
  };
  return {
    state,
    session,
    selectComposition: vi.fn((id: string) => {
      session.selectedCompositionId = id;
    }),
    startExportJob: vi.fn(),
  };
});

vi.mock("../document/editor-session.js", () => ({
  editorActions: { selectComposition: mocked.selectComposition },
  getEditorSessionSnapshot: () => mocked.session,
}));

vi.mock("./export-controller.js", () => ({
  getExportJobSnapshot: () => mocked.state,
  startExportJob: mocked.startExportJob,
}));

import { enqueueCurrentExport, startRenderQueue } from "./render-queue-controller.js";
import {
  enqueueRenderJob,
  getRenderQueueSnapshot,
  resetRenderQueueForTest,
  type RenderQueueStorage,
} from "./render-queue-store.js";

function storage(): RenderQueueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  resetRenderQueueForTest(storage());
  mocked.session.selectedCompositionId = "cmp_a";
  mocked.session.document.compositions[0]!.name = "Cena A";
  mocked.session.document.compositions[1]!.name = "Cena B";
  mocked.state.status = "idle";
  mocked.state.message = null;
  mocked.selectComposition.mockClear();
  mocked.startExportJob.mockReset();
});

describe("render queue controller", () => {
  it("captura somente opções serializáveis da composição atual", () => {
    const id = enqueueCurrentExport({
      format: "gif",
      scale: 2,
      supersampling: 2,
      motionBlur: { samples: 4, shutterAngle: 180 },
      onCheckpoint: vi.fn(),
    });

    expect(id).toMatch(/^job_/);
    expect(getRenderQueueSnapshot().jobs[0]).toMatchObject({
      compositionId: "cmp_a",
      compositionName: "Cena A",
      options: {
        format: "gif",
        scale: 2,
        supersampling: 2,
        motionBlur: { samples: 4, shutterAngle: 180 },
      },
    });
    expect(getRenderQueueSnapshot().jobs[0]?.options).not.toHaveProperty("onCheckpoint");
  });

  it("executa em série, persiste checkpoint e restaura a composição original", async () => {
    enqueueRenderJob({
      id: "job_a",
      compositionId: "cmp_b",
      compositionName: "Cena B",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "png" },
    });
    enqueueRenderJob({
      id: "job_b",
      compositionId: "cmp_a",
      compositionName: "Cena A",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "mp4" },
    });
    mocked.startExportJob.mockImplementation(async (options: unknown) => {
      const typed = options as {
        format: string;
        onOutputPrepared?: (value: { directory: string; framesDirectory?: string }) => void;
        onCheckpoint?: (value: {
          completedFrames: number;
          totalFrames: number;
          lastFilename: string;
          complete: boolean;
          hashes: readonly { filename: string; sha256: string }[];
        }) => void | Promise<void>;
      };
      typed.onOutputPrepared?.({
        directory: "D:\\render\\job",
        framesDirectory: "D:\\render\\job\\.theatrum-frames-test",
      });
      await typed.onCheckpoint?.({
        completedFrames: 300,
        totalFrames: 600,
        lastFilename: "frame_0299.png",
        complete: false,
        hashes: Array.from({ length: 300 }, (_, index) => ({
          filename: `frame_${String(index).padStart(4, "0")}.png`,
          sha256: index.toString(16).padStart(64, "0"),
        })),
      });
      mocked.state.status = "done";
    });

    await startRenderQueue();

    expect(mocked.startExportJob).toHaveBeenCalledTimes(2);
    expect(mocked.selectComposition.mock.calls.map(([id]) => id)).toEqual([
      "cmp_b",
      "cmp_a",
      "cmp_a",
    ]);
    expect(getRenderQueueSnapshot()).toMatchObject({
      activeJobId: null,
      jobs: [
        {
          id: "job_a",
          status: "done",
          checkpoint: {
            completedFrames: 300,
            totalFrames: 600,
            directory: "D:\\render\\job",
          },
        },
        { id: "job_b", status: "done" },
      ],
    });
  });

  it("pausa a fila depois de interrupção", async () => {
    enqueueRenderJob({
      id: "job_pause",
      compositionId: "cmp_a",
      compositionName: "Cena A",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "png" },
    });
    enqueueRenderJob({
      id: "job_after",
      compositionId: "cmp_b",
      compositionName: "Cena B",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "png" },
    });
    mocked.startExportJob.mockImplementation(async () => {
      mocked.state.status = "aborted";
    });

    await startRenderQueue();

    expect(mocked.startExportJob).toHaveBeenCalledOnce();
    expect(getRenderQueueSnapshot().jobs).toMatchObject([
      { id: "job_pause", status: "paused" },
      { id: "job_after", status: "pending" },
    ]);
  });

  it("não mistura um checkpoint com um documento alterado", async () => {
    enqueueRenderJob({
      id: "job_stale",
      compositionId: "cmp_a",
      compositionName: "Cena A",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "png" },
    });
    mocked.session.document.compositions[0]!.name = "Cena alterada";

    await startRenderQueue();

    expect(mocked.startExportJob).not.toHaveBeenCalled();
    expect(getRenderQueueSnapshot().jobs[0]).toMatchObject({
      id: "job_stale",
      status: "failed",
      message: expect.stringContaining("documento mudou"),
    });
  });

  it("marca falha inesperada e não deixa o job seguinte misturar o viewport", async () => {
    enqueueRenderJob({
      id: "job_throw",
      compositionId: "cmp_a",
      compositionName: "Cena A",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "png" },
    });
    enqueueRenderJob({
      id: "job_after_throw",
      compositionId: "cmp_b",
      compositionName: "Cena B",
      documentFingerprint: hashObject(mocked.session.document),
      options: { format: "png" },
    });
    mocked.startExportJob.mockRejectedValueOnce(new Error("ponte caiu"));

    await startRenderQueue();

    expect(mocked.startExportJob).toHaveBeenCalledOnce();
    expect(getRenderQueueSnapshot()).toMatchObject({
      activeJobId: null,
      jobs: [
        { id: "job_throw", status: "failed", message: expect.stringContaining("ponte caiu") },
        { id: "job_after_throw", status: "pending" },
      ],
    });
    expect(mocked.session.selectedCompositionId).toBe("cmp_a");
  });
});
