import {
  describeExportResolution,
  estimateMotionBlurSettleMs,
  EXPORT_SCALES,
  EXPORT_SUPERSAMPLING_FACTORS,
  MOTION_BLUR_SAMPLE_COUNTS,
  MOTION_BLUR_SETTLE_REFERENCE_MS,
  MOTION_BLUR_SHUTTER_ANGLES,
  planExportResolution,
  planMotionBlur,
} from "@theatrum/export";
import type { Composition } from "@theatrum/schema";
import { hashObject } from "@theatrum/core-utils";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  type ExportFormat,
  estimatedSecondsLeft,
  getExportJobSnapshot,
  isExportReady,
  requestExportAbort,
  startExportJob,
  subscribeExportJob,
} from "../../export/export-controller.js";
import {
  enqueueCurrentExport,
  startRenderQueue,
} from "../../export/render-queue-controller.js";
import {
  clearFinishedRenderJobs,
  getRenderQueueSnapshot,
  removeRenderQueueJob,
  restartRenderQueueJob,
  resumeRenderQueueJob,
  subscribeRenderQueue,
} from "../../export/render-queue-store.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import {
  setPreviewSupersampling,
  usePreviewSupersampling,
} from "../../export/preview-supersampling.js";
import { Button, Panel } from "../../ui/index.js";
import "./RenderQueuePanel.css";

/** `mm:ss` a partir de segundos. Acima de uma hora mostra horas. */
function formatDuration(seconds: number): string {
  const total = Math.max(seconds > 0 ? 1 : 0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const STATUS_LABEL: Record<string, string> = {
  idle: "pronto",
  running: "exportando",
  done: "concluído",
  failed: "falhou",
  aborted: "interrompido",
};

const QUEUE_STATUS_LABEL: Record<string, string> = {
  pending: "aguardando",
  running: "renderizando",
  paused: "pausado",
  done: "concluído",
  failed: "falhou",
};

const FORMAT_LABEL: Record<ExportFormat, string> = {
  mp4: "MP4 · H.264",
  gif: "GIF animado",
  prores4444: "ProRes 4444 · alfa",
  png: "Sequência PNG",
  "png-alpha": "Sequência PNG · alfa",
};

const FORMAT_HINT: Record<ExportFormat, string> = {
  mp4: "Vídeo H.264 para reprodução e publicação, codificado com WebCodecs.",
  gif: "GIF com paleta calculada em dois passos sobre a sequência inteira.",
  prores4444: "MOV ProRes 4444 para composição em NLE, sem mapa e com transparência.",
  png: "Um PNG RGBA sem perda por frame, com mapa, palco 3D e overlay.",
  "png-alpha": "Um PNG RGBA sem perda por frame, sem mapa e com transparência.",
};

/** Rótulo de cada escala oferecida. Meia resolução existe para revisão rápida. */
const SCALE_LABEL: Record<string, string> = {
  "0.5": "½ · rascunho",
  "1": "1× · a composição",
  "2": "2× · alta",
  "4": "4× · 8K em composição HD",
};

const SUPERSAMPLING_LABEL: Record<string, string> = {
  "1": "SS desligado",
  "2": "SS 2× · suave",
};

const PREVIEW_QUALITY_LABEL: Record<string, string> = {
  "1": "Preview normal",
  "2": "Preview suave 2×",
};

const MOTION_SAMPLES_LABEL: Record<string, string> = {
  "1": "Blur desligado",
  "4": "Blur · 4 amostras",
  "8": "Blur · 8 amostras",
};

/**
 * A resolução de saída, ou por que ela não existe.
 *
 * O número na tela é **mitigação declarada** do ADR-022, não enfeite: com o
 * tamanho vindo da composição, o preview deixa de ser o enquadramento quando a
 * proporção do painel difere da dela. Sem isto o usuário só descobriria a
 * resolução abrindo o arquivo.
 *
 * A recusa também aparece aqui, e antes de escolher a pasta: `planExportResolution`
 * estoura acima do teto de 8192 px por eixo em vez de cortar em silêncio, e a
 * mensagem dele já nomeia o teto.
 */
function describeOutput(
  composition: Composition | undefined,
  scale: number,
  supersampling: number,
): { readonly ok: boolean; readonly text: string } {
  if (composition === undefined) return { ok: false, text: "nenhuma composição" };
  try {
    return {
      ok: true,
      text: describeExportResolution(
        planExportResolution({
          compositionWidth: composition.width,
          compositionHeight: composition.height,
          scale,
          supersampling,
        }),
      ),
    };
  } catch (error: unknown) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

export function RenderQueuePanel(): ReactNode {
  const job = useSyncExternalStore(subscribeExportJob, getExportJobSnapshot);
  const queue = useSyncExternalStore(subscribeRenderQueue, getRenderQueueSnapshot);
  const session = useEditorSession();
  const composition = session.document.compositions.find(
    (candidate) => candidate.id === session.selectedCompositionId,
  );
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [scale, setScale] = useState(1);
  const [supersampling, setSupersampling] = useState(1);
  const [motionBlurSamples, setMotionBlurSamples] = useState(1);
  const [shutterAngle, setShutterAngle] = useState(180);
  const previewSupersampling = usePreviewSupersampling();
  const output = useMemo(
    () => describeOutput(composition, scale, supersampling),
    [composition, scale, supersampling],
  );
  const motionBlur = useMemo(
    () => planMotionBlur({ shutterAngle, samples: motionBlurSamples }),
    [motionBlurSamples, shutterAngle],
  );
  const motionSettleSeconds =
    composition === undefined
      ? 0
      : estimateMotionBlurSettleMs(composition.duration, motionBlur) / 1000;

  const running = job.status === "running";
  const finalizing = running && job.phase === "finalizing";
  const percent = job.total === 0 ? 0 : Math.round((100 * job.done) / job.total);
  const left = estimatedSecondsLeft(job);
  const report = job.report;
  const selectedOptions = useMemo(
    () => ({
      format,
      scale,
      supersampling,
      ...(motionBlur.enabled
        ? {
            motionBlur: {
              shutterAngle: motionBlur.shutterAngle,
              samples: motionBlur.samples,
            },
          }
        : {}),
    }),
    [format, motionBlur, scale, supersampling],
  );
  const hasRunnableQueueJob = queue.jobs.some(({ status }) => status === "pending");
  const currentDocumentFingerprint = useMemo(
    () => hashObject(session.document),
    [session.document],
  );

  return (
    <Panel
      title="Fila de render"
      toolbar={
        <div className="render-queue__controls">
          <select
            className="render-queue__format"
            aria-label="Formato de exportação"
            value={format}
            disabled={running}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((value) => (
              <option key={value} value={value}>
                {FORMAT_LABEL[value]}
              </option>
            ))}
          </select>
          <select
            className="render-queue__scale"
            aria-label="Escala de exportação"
            value={String(scale)}
            disabled={running}
            onChange={(event) => setScale(Number(event.target.value))}
          >
            {EXPORT_SCALES.map((value) => (
              <option key={value} value={String(value)}>
                {SCALE_LABEL[String(value)] ?? `${value}×`}
              </option>
            ))}
          </select>
          <select
            className="render-queue__supersampling"
            aria-label="Supersampling do export"
            value={String(supersampling)}
            disabled={running}
            onChange={(event) => setSupersampling(Number(event.target.value))}
          >
            {EXPORT_SUPERSAMPLING_FACTORS.map((value) => (
              <option key={value} value={String(value)}>
                {SUPERSAMPLING_LABEL[String(value)] ?? `SS ${value}×`}
              </option>
            ))}
          </select>
          <select
            className="render-queue__preview-quality"
            aria-label="Qualidade do preview"
            value={String(previewSupersampling)}
            disabled={running}
            onChange={(event) => setPreviewSupersampling(Number(event.target.value))}
          >
            {EXPORT_SUPERSAMPLING_FACTORS.map((value) => (
              <option key={value} value={String(value)}>
                {PREVIEW_QUALITY_LABEL[String(value)] ?? `Preview ${value}×`}
              </option>
            ))}
          </select>
          <select
            className="render-queue__motion-samples"
            aria-label="Amostras de motion blur do export"
            value={String(motionBlurSamples)}
            disabled={running}
            onChange={(event) => setMotionBlurSamples(Number(event.target.value))}
          >
            {MOTION_BLUR_SAMPLE_COUNTS.map((value) => (
              <option key={value} value={String(value)}>
                {MOTION_SAMPLES_LABEL[String(value)] ?? `${String(value)} amostras`}
              </option>
            ))}
          </select>
          <select
            className="render-queue__shutter"
            aria-label="Ângulo do obturador do motion blur"
            value={String(shutterAngle)}
            disabled={running || !motionBlur.enabled}
            onChange={(event) => setShutterAngle(Number(event.target.value))}
          >
            {MOTION_BLUR_SHUTTER_ANGLES.map((value) => (
              <option key={value} value={String(value)}>
                Obturador {value}°
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void startExportJob(selectedOptions)}
            // Escala que não cabe desabilita o botão em vez de deixar o export
            // estourar depois do diálogo de pasta.
            disabled={running || !isExportReady() || composition === undefined || !output.ok}
            aria-label={`Exportar ${FORMAT_LABEL[format]}`}
          >
            Exportar
          </Button>
          <Button
            size="sm"
            onClick={() => {
              enqueueCurrentExport(selectedOptions);
            }}
            disabled={running || composition === undefined || !output.ok}
            aria-label="Adicionar configuração à fila"
          >
            Adicionar à fila
          </Button>
          <Button
            size="sm"
            onClick={() => void startRenderQueue()}
            disabled={running || !isExportReady() || !hasRunnableQueueJob}
            aria-label="Iniciar fila de render"
          >
            Iniciar fila
          </Button>
          <Button
            size="sm"
            onClick={() => requestExportAbort()}
            disabled={!running || finalizing}
            aria-label="Interromper export"
            title={finalizing ? "O arquivo já está sendo finalizado" : undefined}
          >
            Interromper
          </Button>
        </div>
      }
      footer={
        <span className="render-queue__footer">
          {composition === undefined
            ? "nenhuma composição"
            : `${composition.name} · ${composition.duration} frames a ${composition.fps} fps`}
          {/* A resolução de saída vive ao lado da duração porque as duas são o
              contrato do arquivo. Vermelha quando a escala não cabe: o teto de
              8192 px por eixo é compartilhado com o MapLibre; acima disso o
              export recusa em vez de reduzir a saída silenciosamente. */}
          <span
            className={
              output.ok ? "render-queue__output" : "render-queue__output render-queue__bad"
            }
          >
            {" · "}
            {output.text}
            {motionBlur.enabled
              ? ` · blur ${String(motionBlur.samples)}×/${String(motionBlur.shutterAngle)}°`
              : " · motion blur desligado"}
          </span>
        </span>
      }
    >
      <div className="render-queue">
        {queue.jobs.length > 0 ? (
          <section className="render-queue__jobs" aria-label="Jobs de render">
            <div className="render-queue__jobs-head">
              <strong>{queue.jobs.length} job(s) na fila</strong>
              <Button size="sm" onClick={() => clearFinishedRenderJobs()} disabled={running}>
                Limpar concluídos
              </Button>
            </div>
            <ol>
              {queue.jobs.map((queued) => (
                <li
                  key={queued.id}
                  className={
                    queued.id === queue.activeJobId
                      ? "render-queue__job render-queue__job--active"
                      : "render-queue__job"
                  }
                >
                  <span>
                    <strong>{queued.compositionName}</strong>
                    <small>
                      {FORMAT_LABEL[queued.options.format]} ·{" "}
                      {QUEUE_STATUS_LABEL[queued.status] ?? queued.status}
                      {queued.checkpoint === undefined
                        ? ""
                        : ` · checkpoint ${String(queued.checkpoint.completedFrames)}/${String(
                            queued.checkpoint.totalFrames,
                          )}`}
                    </small>
                    {queued.message === undefined ? null : <small>{queued.message}</small>}
                  </span>
                  <span className="render-queue__job-actions">
                    {queued.status === "paused" || queued.status === "failed" ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (queued.documentFingerprint === currentDocumentFingerprint) {
                            resumeRenderQueueJob(queued.id);
                          } else {
                            restartRenderQueueJob(queued.id, currentDocumentFingerprint);
                          }
                          void startRenderQueue();
                        }}
                        disabled={running}
                      >
                        {queued.documentFingerprint !== currentDocumentFingerprint
                          ? "Reiniciar · documento mudou"
                          : queued.checkpoint === undefined
                            ? "Reiniciar"
                            : "Retomar"}
                      </Button>
                    ) : null}
                    {queued.status !== "running" ? (
                      <Button
                        size="sm"
                        onClick={() => removeRenderQueueJob(queued.id)}
                        disabled={running || queued.id === queue.activeJobId}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <div className="render-queue__status" role="status" aria-live="polite">
          <span className={`render-queue__badge render-queue__badge--${job.status}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
          {running ? (
            finalizing ? (
              <span>codificando e finalizando · sem previsão</span>
            ) : (
              <span>
                {job.done}/{job.total} frames
                {job.samplesPerFrame > 1
                  ? ` · amostra ${String(job.currentSample)}/${String(job.samplesPerFrame)} · ${String(
                      job.samplesDone,
                    )}/${String(job.totalSamples)} processadas`
                  : ""}
                {left === null ? "" : ` · ≈${formatDuration(left)} restantes`}
              </span>
            )
          ) : null}
        </div>

        {/* A barra existe em qualquer estado terminal, não só rodando: depois de
            concluir, ela é a confirmação visual de que foi até o fim. */}
        <div
          className="render-queue__bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`render-queue__bar-fill${finalizing ? " render-queue__bar-fill--finalizing" : ""}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {job.message === null ? null : (
          <p className="render-queue__message" role="alert">
            {job.message}
          </p>
        )}

        {report === null ? (
          <p className="render-queue__hint">
            <strong>{FORMAT_LABEL[format]}.</strong> {FORMAT_HINT[format]} Todos usam o mesmo pump
            determinístico: o frame só é capturado depois de mapa, assets e overlay estabilizarem.
            {motionBlur.enabled
              ? ` Motion blur roda só no arquivo; o preview continua instantâneo. Referência: ≈${formatDuration(
                  motionSettleSeconds,
                )} só de estabilização para ${String(composition?.duration ?? 0)} frames × ${String(
                  motionBlur.effectiveSamples,
                )} amostras no p99 de referência de ≈${String(MOTION_BLUR_SETTLE_REFERENCE_MS)} ms; assets, render e codificação podem aumentar o total.`
              : ""}
          </p>
        ) : (
          <dl className="render-queue__report">
            <dt>
              {job.format === "png" || job.format === "png-alpha"
                ? "Arquivos escritos"
                : "Frames codificados"}
            </dt>
            <dd>{report.written + report.reused}</dd>
            {report.reused === 0 ? null : (
              <>
                <dt>Reaproveitados do checkpoint</dt>
                <dd>{report.reused}</dd>
              </>
            )}
            {job.videoFile === null ? null : (
              <>
                <dt>Arquivo</dt>
                <dd>
                  {job.videoFile} · {(job.videoBytes / 1048576).toFixed(1)} MB
                </dd>
                {job.fileSha256 === null ? null : (
                  <>
                    <dt>SHA-256</dt>
                    <dd className="render-queue__hash" title={job.fileSha256}>
                      {job.fileSha256.slice(0, 16)}…
                    </dd>
                  </>
                )}
              </>
            )}
            <dt>Settle falhou · amostras</dt>
            {/* Diferente de zero é o sinal de que algum frame foi capturado antes
                de o mapa terminar — o arquivo existe e não é confiável. */}
            <dd className={report.settleFailed > 0 ? "render-queue__bad" : undefined}>
              {report.settleFailed}
            </dd>
            <dt>Frames contaminados</dt>
            <dd className={report.settleFailedOutputFrames > 0 ? "render-queue__bad" : undefined}>
              {report.settleFailedOutputFrames}
            </dd>
            <dt>Settle p99 · por amostra</dt>
            <dd>{report.settleP99Ms.toFixed(0)} ms</dd>
            <dt>Motion blur</dt>
            <dd>
              {report.motionBlur.enabled
                ? `${String(report.motionBlur.samples)} amostras · ${String(
                    report.motionBlur.shutterAngle,
                  )}°`
                : "desligado"}
            </dd>
            {report.motionBlur.enabled ? (
              <>
                <dt>Subframes assentados</dt>
                <dd>
                  {report.motionBlur.settledSamples}/{report.motionBlur.totalSamples}
                </dd>
                <dt>Acumulador</dt>
                <dd>
                  {report.motionBlur.accumulatorAllocations} alocação ·{" "}
                  {(report.motionBlur.accumulatorBytes / 1048576).toFixed(1)} MB total ·{" "}
                  {(report.motionBlur.accumulatorFloatBytes / 1048576).toFixed(1)} MB float
                </dd>
              </>
            ) : null}
            <dt>Taxa de saída</dt>
            <dd>{report.plan.outputFps} fps</dd>
            <dt>Duração</dt>
            <dd>{report.plan.durationSeconds.toFixed(2)} s</dd>
            <dt>Pasta</dt>
            <dd className="render-queue__path" title={job.directory}>
              {job.directory}
            </dd>
          </dl>
        )}

        {report !== null && report.errors.length > 0 ? (
          <ul className="render-queue__errors">
            {report.errors.slice(0, 8).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {report.errors.length > 8 ? <li>e mais {report.errors.length - 8}…</li> : null}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
