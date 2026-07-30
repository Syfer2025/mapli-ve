import { editorActions, getEditorSessionSnapshot } from "../document/editor-session.js";
import { hashObject } from "@theatrum/core-utils";
import { getExportJobSnapshot, startExportJob, type StartJobOptions } from "./export-controller.js";
import {
  enqueueRenderJob,
  nextRunnableRenderJob,
  setRenderQueueActiveJob,
  setRenderQueueJobStatus,
  updateRenderQueueCheckpoint,
  type QueuedExportOptions,
} from "./render-queue-store.js";

let queueRunning = false;

/** Acrescenta a composição atual à fila sem abrir diálogo nem iniciar o pump. */
export function enqueueCurrentExport(options: StartJobOptions = {}): string | null {
  const session = getEditorSessionSnapshot();
  const composition = session.document.compositions.find(
    ({ id }) => id === session.selectedCompositionId,
  );
  if (composition === undefined) return null;
  const serializable: QueuedExportOptions = {
    format: options.format ?? "mp4",
    ...(options.range === undefined ? {} : { range: options.range }),
    ...(options.outputFps === undefined ? {} : { outputFps: options.outputFps }),
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    ...(options.scale === undefined ? {} : { scale: options.scale }),
    ...(options.supersampling === undefined ? {} : { supersampling: options.supersampling }),
    ...(options.motionBlur === undefined ? {} : { motionBlur: options.motionBlur }),
  };
  return enqueueRenderJob({
    compositionId: composition.id,
    compositionName: composition.name,
    documentFingerprint: hashObject(session.document),
    options: serializable,
  });
}

/**
 * Executa jobs pendentes em série sobre o único viewport ativo. Fechar o app
 * durante um job o restaura como pausado; sequências retomam do checkpoint.
 */
export async function startRenderQueue(): Promise<void> {
  if (queueRunning || getExportJobSnapshot().status === "running") return;
  queueRunning = true;
  const originalCompositionId = getEditorSessionSnapshot().selectedCompositionId;
  try {
    for (;;) {
      const job = nextRunnableRenderJob();
      if (job === undefined) break;
      const compositionExists = getEditorSessionSnapshot().document.compositions.some(
        ({ id }) => id === job.compositionId,
      );
      if (!compositionExists) {
        setRenderQueueJobStatus(job.id, "failed", "a composição do job não existe mais");
        continue;
      }
      if (hashObject(getEditorSessionSnapshot().document) !== job.documentFingerprint) {
        setRenderQueueJobStatus(
          job.id,
          "failed",
          "o documento mudou desde o checkpoint; reinicie o job para não misturar frames",
        );
        continue;
      }

      setRenderQueueActiveJob(job.id);
      setRenderQueueJobStatus(job.id, "running");
      editorActions.selectComposition(job.compositionId);

      let outputLocation:
        { readonly directory: string; readonly framesDirectory?: string } | undefined =
        job.checkpoint;
      const resumable = job.options.format !== "mp4";
      try {
        await startExportJob({
          ...job.options,
          ...(resumable && job.checkpoint !== undefined
            ? {
                resume: {
                  completedFrames: job.checkpoint.completedFrames,
                  totalFrames: job.checkpoint.totalFrames,
                  directory: job.checkpoint.directory,
                  hashes: job.checkpoint.hashes,
                  ...(job.checkpoint.framesDirectory === undefined
                    ? {}
                    : { framesDirectory: job.checkpoint.framesDirectory }),
                },
              }
            : {}),
          onOutputPrepared: (location) => {
            outputLocation = location;
          },
          ...(resumable
            ? {
                onCheckpoint: (checkpoint) => {
                  if (outputLocation === undefined) {
                    throw new Error("destino do checkpoint ainda não foi preparado");
                  }
                  updateRenderQueueCheckpoint(job.id, {
                    completedFrames: checkpoint.completedFrames,
                    totalFrames: checkpoint.totalFrames,
                    directory: outputLocation.directory,
                    hashes: checkpoint.hashes,
                    ...(outputLocation.framesDirectory === undefined
                      ? {}
                      : { framesDirectory: outputLocation.framesDirectory }),
                  });
                },
              }
            : {}),
        });
      } catch (error: unknown) {
        setRenderQueueJobStatus(
          job.id,
          "failed",
          `falha inesperada no export: ${error instanceof Error ? error.message : String(error)}`,
        );
        setRenderQueueActiveJob(null);
        break;
      }

      const finished = getExportJobSnapshot();
      if (finished.status === "done") {
        setRenderQueueJobStatus(job.id, "done");
      } else if (finished.status === "aborted") {
        setRenderQueueJobStatus(
          job.id,
          "paused",
          resumable
            ? "interrompido; pronto para retomar do checkpoint"
            : "interrompido; MP4 direto reiniciará do começo",
        );
        break;
      } else {
        setRenderQueueJobStatus(job.id, "failed", finished.message ?? "export falhou");
      }
      setRenderQueueActiveJob(null);
    }
  } finally {
    setRenderQueueActiveJob(null);
    const document = getEditorSessionSnapshot().document;
    if (document.compositions.some(({ id }) => id === originalCompositionId)) {
      editorActions.selectComposition(originalCompositionId);
    }
    queueRunning = false;
  }
}
