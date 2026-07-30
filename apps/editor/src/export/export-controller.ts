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
import type { MotionBlurSpec } from "@theatrum/export";
import {
  startAlphaPngSequenceExport,
  startGifExport,
  startPngSequenceExport,
  startProRes4444Export,
  startVideoExport,
  type ExportPhase,
  type OverlayProbe,
} from "./export-service.js";
import type { ExportProgress, ExportReport } from "./run-export.js";

export type ExportFormat = "png" | "png-alpha" | "mp4" | "gif" | "prores4444";

export interface ExportJobState {
  readonly status: "idle" | "running" | "done" | "failed" | "aborted";
  readonly phase: ExportPhase | "idle";
  readonly done: number;
  readonly total: number;
  readonly currentSample: number;
  readonly samplesPerFrame: number;
  readonly samplesDone: number;
  readonly totalSamples: number;
  /** Última medida de settle, em ms. Útil para ver o mapa engasgando. */
  readonly settleMs: number;
  /** Milissegundos por frame, média móvel; base da estimativa de conclusão. */
  readonly msPerFrame: number;
  readonly directory: string;
  readonly message: string | null;
  readonly report: ExportReport | null;
  /** Qual formato este job produziu. */
  readonly format: ExportFormat;
  /** Nome e tamanho do arquivo único, quando houve um. */
  readonly videoFile: string | null;
  readonly videoBytes: number;
  readonly fileSha256: string | null;
}

const IDLE: ExportJobState = Object.freeze({
  status: "idle",
  phase: "idle",
  done: 0,
  total: 0,
  currentSample: 0,
  samplesPerFrame: 1,
  samplesDone: 0,
  totalSamples: 0,
  settleMs: 0,
  msPerFrame: 0,
  directory: "",
  message: null,
  report: null,
  format: "png",
  videoFile: null,
  videoBytes: 0,
  fileSha256: null,
});

interface ViewportBinding {
  readonly map?: MapLibreMap;
  readonly probe: () => OverlayProbe;
}

interface BoundViewport extends ViewportBinding {
  readonly token: symbol;
}

let state: ExportJobState = IDLE;
let binding: BoundViewport | null = null;
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

/**
 * A superfície ativa se anuncia e recebe um lease para a própria desmontagem.
 *
 * O token evita que o cleanup atrasado do mapa apague o binding que o palco
 * acabou de publicar durante uma troca de aba do dockview.
 */
export function bindExportViewport(next: ViewportBinding): () => void {
  const current: BoundViewport = { ...next, token: Symbol("export-viewport") };
  binding = current;
  emit({});
  return () => {
    if (binding?.token !== current.token) return;
    binding = null;
    emit({});
  };
}

export function isExportReady(): boolean {
  return binding !== null;
}

export function requestExportAbort(): void {
  abortRequested = true;
}

export interface StartJobOptions {
  /** Formato final; matte é explícito nos dois formatos com alfa. */
  readonly format?: ExportFormat;
  readonly range?: { readonly first: number; readonly last: number };
  readonly outputFps?: number;
  readonly directory?: string;
  /**
   * Escala sobre o tamanho autorado ([ADR-022](../../../../docs/adr/ADR-022-export-resolution-from-composition.md)).
   *
   * Chega aqui do seletor do painel de fila e atravessa para o serviço, que é
   * quem conduz as superfícies. Ausente, 1.
   */
  readonly scale?: number;
  /** Fator box por eixo do arquivo. Ausente, 1 (ADR-024). */
  readonly supersampling?: number;
  readonly motionBlur?: MotionBlurSpec;
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
  emit({ ...IDLE, status: "running", phase: "rendering", format });
  const executar =
    format === "mp4"
      ? startVideoExport
      : format === "gif"
        ? startGifExport
        : format === "prores4444"
          ? startProRes4444Export
          : format === "png-alpha"
            ? startAlphaPngSequenceExport
            : startPngSequenceExport;
  const result = await executar({
    probe: current.probe,
    ...(current.map === undefined ? {} : { map: current.map }),
    ...options,
    onProgress: (progress) => {
      const msPerFrame = nextAverageMsPerFrame(state, progress);
      emit({
        done: progress.done,
        total: progress.total,
        currentSample: progress.currentSample,
        samplesPerFrame: progress.samplesPerFrame,
        samplesDone: progress.samplesDone,
        totalSamples: progress.totalSamples,
        settleMs: progress.settleMs,
        msPerFrame,
      });
    },
    onPhase: (phase) => emit({ phase }),
    // Trocar de aba desmonta a fonte capturada. Continuar usaria uma sonda
    // congelada por até N×4 s e poderia compor uma pilha diferente.
    shouldAbort: () => abortRequested || binding?.token !== current.token,
  });

  const report = result.report ?? null;
  emit({
    status: report?.aborted === true ? "aborted" : result.ok ? "done" : "failed",
    phase: "idle",
    directory: result.directory,
    report,
    videoFile: result.videoFile ?? null,
    videoBytes: result.videoBytes ?? 0,
    fileSha256: result.fileSha256 ?? null,
    // A primeira falha, quando há: uma lista de mil erros iguais não diz mais
    // que um, e o relatório completo fica acessível ao lado.
    message: result.message ?? report?.errors[0] ?? null,
  });
}

/**
 * Heartbeats de subamostra não concluem um frame e, portanto, não podem
 * recalcular uma média por frame com tempo parcial no numerador.
 */
export function nextAverageMsPerFrame(
  previous: Pick<ExportJobState, "done" | "msPerFrame">,
  progress: Pick<ExportProgress, "done" | "elapsedMs">,
): number {
  return progress.done > previous.done && progress.done > 0
    ? progress.elapsedMs / progress.done
    : previous.msPerFrame;
}

/**
 * Segundos restantes estimados, ou `null` quando ainda não há base.
 *
 * A média é sobre o job inteiro, não sobre os últimos frames: o custo por frame
 * varia muito no começo, enquanto o mapa ainda tem tile chegando, e uma média
 * curta faria a estimativa pular de trinta segundos para cinco minutos e voltar.
 */
export function estimatedSecondsLeft(job: ExportJobState): number | null {
  if (
    job.status !== "running" ||
    job.phase !== "rendering" ||
    job.msPerFrame <= 0 ||
    job.total === 0 ||
    job.done < 2
  ) {
    return null;
  }
  return ((job.total - job.done) * job.msPerFrame) / 1000;
}
