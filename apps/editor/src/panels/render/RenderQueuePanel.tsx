import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  type ExportFormat,
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

export function RenderQueuePanel(): ReactNode {
  const job = useSyncExternalStore(subscribeExportJob, getExportJobSnapshot);
  const session = useEditorSession();
  const composition = session.document.compositions.find(
    (candidate) => candidate.id === session.selectedCompositionId,
  );
  const [format, setFormat] = useState<ExportFormat>("mp4");

  const running = job.status === "running";
  const percent = job.total === 0 ? 0 : Math.round((100 * job.done) / job.total);
  const left = estimatedSecondsLeft(job);
  const report = job.report;

  return (
    <Panel
      title="Fila de render"
      toolbar={
        <>
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
          <Button
            size="sm"
            variant="primary"
            onClick={() => void startExportJob({ format })}
            disabled={running || !isExportReady() || composition === undefined}
            aria-label={`Exportar ${FORMAT_LABEL[format]}`}
          >
            Exportar
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
            <strong>{FORMAT_LABEL[format]}.</strong> {FORMAT_HINT[format]} Todos usam o mesmo pump
            determinístico: o frame só é capturado depois de mapa, assets e overlay estabilizarem.
          </p>
        ) : (
          <dl className="render-queue__report">
            <dt>
              {job.format === "png" || job.format === "png-alpha"
                ? "Arquivos escritos"
                : "Frames codificados"}
            </dt>
            <dd>{report.written}</dd>
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
