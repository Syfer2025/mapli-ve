import { useSyncExternalStore, type ReactNode } from "react";
import {
  estimatedSecondsLeft,
  getExportJobSnapshot,
  isExportReady,
  requestExportAbort,
  startExportJob,
  subscribeExportJob,
} from "../../export/export-controller.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import "./RenderQueuePanel.css";

/** `mm:ss` a partir de segundos. Acima de uma hora mostra horas. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
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

export function RenderQueuePanel(): ReactNode {
  const job = useSyncExternalStore(subscribeExportJob, getExportJobSnapshot);
  const session = useEditorSession();
  const composition = session.document.compositions.find(
    (candidate) => candidate.id === session.selectedCompositionId,
  );

  const running = job.status === "running";
  const percent = job.total === 0 ? 0 : Math.round((100 * job.done) / job.total);
  const left = estimatedSecondsLeft(job);
  const report = job.report;

  return (
    <Panel
      title="Fila de render"
      toolbar={
        <>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void startExportJob({ format: "mp4" })}
            disabled={running || !isExportReady() || composition === undefined}
            aria-label="Exportar vídeo MP4"
          >
            Exportar MP4
          </Button>
          <Button
            size="sm"
            onClick={() => void startExportJob({ format: "png" })}
            disabled={running || !isExportReady() || composition === undefined}
            aria-label="Exportar sequência PNG"
          >
            Sequência PNG
          </Button>
          <Button
            size="sm"
            onClick={() => requestExportAbort()}
            disabled={!running}
            aria-label="Interromper export"
          >
            Interromper
          </Button>
        </>
      }
      footer={
        <span>
          {composition === undefined
            ? "nenhuma composição"
            : `${composition.name} · ${composition.duration} frames a ${composition.fps} fps`}
        </span>
      }
    >
      <div className="render-queue">
        <div className="render-queue__status" role="status" aria-live="polite">
          <span className={`render-queue__badge render-queue__badge--${job.status}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
          {running ? (
            <span>
              {job.done}/{job.total} frames
              {left === null ? "" : ` · faltam ${formatDuration(left)}`}
            </span>
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
          <div className="render-queue__bar-fill" style={{ width: `${percent}%` }} />
        </div>

        {job.message === null ? null : (
          <p className="render-queue__message" role="alert">
            {job.message}
          </p>
        )}

        {report === null ? (
          <p className="render-queue__hint">
            <strong>MP4</strong> codifica em H.264 com WebCodecs e empacota num MP4 fragmentado.
            <strong> Sequência PNG</strong> escreve um arquivo por frame, sem perda. Nos dois casos
            o frame é o mapa, o palco 3D e o overlay compostos, e exportar o mesmo trecho duas vezes
            produz o mesmo resultado byte a byte.
          </p>
        ) : (
          <dl className="render-queue__report">
            <dt>{job.format === "mp4" ? "Frames codificados" : "Arquivos escritos"}</dt>
            <dd>{report.written}</dd>
            {job.videoFile === null ? null : (
              <>
                <dt>Arquivo</dt>
                <dd>
                  {job.videoFile} · {(job.videoBytes / 1048576).toFixed(1)} MB
                </dd>
              </>
            )}
            <dt>Settle falhou</dt>
            {/* Diferente de zero é o sinal de que algum frame foi capturado antes
                de o mapa terminar — o arquivo existe e não é confiável. */}
            <dd className={report.settleFailed > 0 ? "render-queue__bad" : undefined}>
              {report.settleFailed}
            </dd>
            <dt>Settle p99</dt>
            <dd>{report.settleP99Ms.toFixed(0)} ms</dd>
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
