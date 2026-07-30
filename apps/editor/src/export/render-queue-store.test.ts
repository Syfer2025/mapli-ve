import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFinishedRenderJobs,
  enqueueRenderJob,
  getRenderQueueSnapshot,
  nextRunnableRenderJob,
  removeRenderQueueJob,
  resetRenderQueueForTest,
  restartRenderQueueJob,
  resumeRenderQueueJob,
  setRenderQueueActiveJob,
  setRenderQueueJobStatus,
  updateRenderQueueCheckpoint,
  type RenderQueueStorage,
} from "./render-queue-store.js";

const DOCUMENT_FINGERPRINT = "0123456789abcdef";

function memoryStorage(): RenderQueueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  resetRenderQueueForTest(storage);
});

describe("render queue store", () => {
  it("mantém ordem, escolhe somente pendentes e impede ID duplicado", () => {
    enqueueRenderJob({
      id: "job_a",
      compositionId: "cmp_a",
      compositionName: "A",
      documentFingerprint: DOCUMENT_FINGERPRINT,
      options: { format: "png", scale: 1 },
    });
    enqueueRenderJob({
      id: "job_b",
      compositionId: "cmp_b",
      compositionName: "B",
      documentFingerprint: DOCUMENT_FINGERPRINT,
      options: { format: "gif", scale: 2 },
    });

    expect(getRenderQueueSnapshot().jobs.map(({ id }) => id)).toEqual(["job_a", "job_b"]);
    expect(nextRunnableRenderJob()?.id).toBe("job_a");
    setRenderQueueJobStatus("job_a", "running");
    expect(nextRunnableRenderJob()?.id).toBe("job_b");
    expect(() =>
      enqueueRenderJob({
        id: "job_a",
        compositionId: "cmp_c",
        compositionName: "C",
        documentFingerprint: DOCUMENT_FINGERPRINT,
        options: { format: "mp4" },
      }),
    ).toThrow("duplicado");
  });

  it("persiste checkpoint e converte running em paused depois de reiniciar", () => {
    enqueueRenderJob({
      id: "job_resume",
      compositionId: "cmp_main",
      compositionName: "Hormuz",
      documentFingerprint: DOCUMENT_FINGERPRINT,
      options: { format: "prores4444", supersampling: 2 },
    });
    setRenderQueueJobStatus("job_resume", "running");
    setRenderQueueActiveJob("job_resume");
    updateRenderQueueCheckpoint("job_resume", {
      completedFrames: 600,
      totalFrames: 5400,
      directory: "D:\\renders\\hormuz",
      framesDirectory: "D:\\renders\\hormuz\\.theatrum-frames-abc",
    });

    resetRenderQueueForTest(storage);
    const restored = getRenderQueueSnapshot();
    expect(restored.jobs[0]).toMatchObject({
      id: "job_resume",
      status: "paused",
      checkpoint: { completedFrames: 600, totalFrames: 5400 },
    });
    expect(restored.activeJobId).toBeNull();

    resumeRenderQueueJob("job_resume");
    expect(nextRunnableRenderJob()?.id).toBe("job_resume");

    restartRenderQueueJob("job_resume", "fedcba9876543210");
    expect(nextRunnableRenderJob()).toMatchObject({
      id: "job_resume",
      documentFingerprint: "fedcba9876543210",
    });
    expect(nextRunnableRenderJob()).not.toHaveProperty("checkpoint");
  });

  it("descarta entrada corrompida sem impedir a hidratação das válidas", () => {
    enqueueRenderJob({
      id: "job_good",
      compositionId: "cmp",
      compositionName: "Cena",
      documentFingerprint: DOCUMENT_FINGERPRINT,
      options: { format: "png" },
    });
    const [key, raw] = [...storage.values.entries()][0] ?? [];
    if (key === undefined || raw === undefined) throw new Error("fixture inválido");
    const parsed = JSON.parse(raw) as { jobs: unknown[] };
    parsed.jobs.push({ id: 42, options: null });
    parsed.jobs.push({
      id: "job_bad_options",
      compositionId: "cmp",
      compositionName: "Inválido",
      status: "pending",
      options: { format: "png", scale: "muito" },
    });
    storage.values.set(key, JSON.stringify(parsed));

    resetRenderQueueForTest(storage);
    expect(getRenderQueueSnapshot().jobs.map(({ id }) => id)).toEqual(["job_good"]);
  });

  it("não remove job ativo e limpa somente concluídos/falhos", () => {
    for (const id of ["job_pending", "job_done", "job_failed"]) {
      enqueueRenderJob({
        id,
        compositionId: "cmp",
        compositionName: id,
        documentFingerprint: DOCUMENT_FINGERPRINT,
        options: { format: "png" },
      });
    }
    setRenderQueueJobStatus("job_done", "done");
    setRenderQueueJobStatus("job_failed", "failed", "falha");
    setRenderQueueActiveJob("job_pending");
    expect(() => removeRenderQueueJob("job_pending")).toThrow("job ativo");
    setRenderQueueActiveJob(null);

    clearFinishedRenderJobs();
    expect(getRenderQueueSnapshot().jobs.map(({ id }) => id)).toEqual(["job_pending"]);
  });

  it("recusa checkpoint que avança além do total", () => {
    enqueueRenderJob({
      id: "job_bad_checkpoint",
      compositionId: "cmp",
      compositionName: "Cena",
      documentFingerprint: DOCUMENT_FINGERPRINT,
      options: { format: "png" },
    });
    expect(() =>
      updateRenderQueueCheckpoint("job_bad_checkpoint", {
        completedFrames: 11,
        totalFrames: 10,
        directory: "D:\\render",
      }),
    ).toThrow("checkpoint");
  });

  it("interrompe o avanço quando o armazenamento recusa o checkpoint", () => {
    const readOnlyStorage: RenderQueueStorage = {
      getItem: storage.getItem.bind(storage),
      setItem() {
        throw new Error("perfil somente leitura");
      },
    };
    resetRenderQueueForTest(readOnlyStorage);
    enqueueRenderJob({
      id: "job_read_only",
      compositionId: "cmp",
      compositionName: "Cena",
      documentFingerprint: DOCUMENT_FINGERPRINT,
      options: { format: "png" },
    });

    expect(() =>
      updateRenderQueueCheckpoint("job_read_only", {
        completedFrames: 300,
        totalFrames: 600,
        directory: "D:\\render",
      }),
    ).toThrow("perfil somente leitura");
  });
});
