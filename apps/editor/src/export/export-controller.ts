/**
 * Estado de um export em curso, compartilhado entre o viewport e o painel de
 * fila.
 *
 * Existe porque as duas peças ficam em painéis diferentes do dockview e não têm
 * relação de parentesco em React: o mapa e a sonda de repinturas moram no
 * viewport; o botão e a barra de progresso, no painel de fila. Passar props
 * entre eles exigiria erguer o estado até a raiz do aplicativo, o que arrastaria
 * um re-render de tudo a cada frame exportado.
 *
 * É um `useSyncExternalStore` de dez linhas, e não um contexto React, por essa
 * razão: só quem assina o estado do export re-renderiza.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { startPngSequenceExport, startVideoExport, type OverlayProbe } from "./export-service.js";
import type { ExportReport } from "./run-export.js";

export interface ExportJobState {
  readonly status: "idle" | "running" | "done" | "failed" | "aborted";
  readonly done: number;
  readonly total: number;
  /** Última medida de settle, em ms. Útil para ver o mapa engasgando. */
  readonly settleMs: number;
  /** Milissegundos por frame, média móvel; base da estimativa de conclusão. */
  readonly msPerFrame: number;
  readonly directory: string;
  readonly message: string | null;
  readonly report: ExportReport | null;
  /** Qual formato este job produziu. */
  readonly format: "png" | "mp4";
  /** Nome e tamanho do arquivo de video, quando houve um. */
  readonly videoFile: string | null;
  readonly videoBytes: number;
}

const IDLE: ExportJobState = Object.freeze({
  status: "idle",
  done: 0,
  total: 0,
  settleMs: 0,
  msPerFrame: 0,
  directory: "",
  message: null,
  report: null,
  format: "png",
  videoFile: null,
  videoBytes: 0,
});

interface ViewportBinding {
  readonly map: MapLibreMap;
  readonly probe: () => OverlayProbe;
}

let state: ExportJobState = IDLE;
let binding: ViewportBinding | null = null;
let abortRequested = false;
const listeners = new Set<() => void>();

function emit(next: Partial<ExportJobState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeExportJob(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getExportJobSnapshot(): ExportJobState {
  return state;
}

/** O viewport se anuncia quando o mapa existe, e se retira ao desmontar. */
export function bindExportViewport(next: ViewportBinding | null): void {
  binding = next;
}

export function isExportReady(): boolean {
  return binding !== null;
}

export function requestExportAbort(): void {
  abortRequested = true;
}

export interface StartJobOptions {
  /** `mp4` codifica com WebCodecs; `png` escreve um arquivo por frame. */
  readonly format?: "png" | "mp4";
  readonly range?: { readonly first: number; readonly last: number };
  readonly outputFps?: number;
  readonly directory?: string;
}

/**
 * Dispara um export e mantém o estado observável enquanto ele corre.
 *
 * Recusa começar se já houver um rodando. Dois pumps sobre o mesmo playhead
 * escreveriam frames trocados: cada um daria `seek` por conta e o outro
 * capturaria no frame errado — e o pior é que o arquivo sairia plausível.
 */
export async function startExportJob(options: StartJobOptions = {}): Promise<void> {
  if (state.status === "running") return;
  const current = binding;
  if (current === null) {
    emit({ status: "failed", message: "o viewport ainda não está pronto" });
    return;
  }

  const format = options.format ?? "png";
  abortRequested = false;
  emit({ ...IDLE, status: "running", format });
  const startedAt = performance.now();

  const executar = format === "mp4" ? startVideoExport : startPngSequenceExport;
  const result = await executar({
    map: current.map,
    probe: current.probe,
    ...options,
    onProgress: (progress) => {
      const elapsed = performance.now() - startedAt;
      emit({
        done: progress.done,
        total: progress.total,
        settleMs: progress.settleMs,
        msPerFrame: progress.done === 0 ? 0 : elapsed / progress.done,
      });
    },
    shouldAbort: () => abortRequested,
  });

  const report = result.report ?? null;
  emit({
    status: report?.aborted === true ? "aborted" : result.ok ? "done" : "failed",
    directory: result.directory,
    report,
    videoFile: result.videoFile ?? null,
    videoBytes: result.videoBytes ?? 0,
    // A primeira falha, quando há: uma lista de mil erros iguais não diz mais
    // que um, e o relatório completo fica acessível ao lado.
    message: result.message ?? report?.errors[0] ?? null,
  });
}

/**
 * Segundos restantes estimados, ou `null` quando ainda não há base.
 *
 * A média é sobre o job inteiro, não sobre os últimos frames: o custo por frame
 * varia muito no começo, enquanto o mapa ainda tem tile chegando, e uma média
 * curta faria a estimativa pular de trinta segundos para cinco minutos e voltar.
 */
export function estimatedSecondsLeft(job: ExportJobState): number | null {
  if (job.status !== "running" || job.msPerFrame <= 0 || job.total === 0) return null;
  return ((job.total - job.done) * job.msPerFrame) / 1000;
}
