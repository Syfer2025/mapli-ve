/**
 * O motor do export de sequência: avança o frame, espera estabilizar, compõe,
 * escreve.
 *
 * O `settle` é a peça que decide se o critério byte-idêntico da
 * [Fase 8](../../../../docs/08-ROADMAP.md#fase-8--exportação) se sustenta. Não
 * basta pedir o frame e capturar: o mapa carrega tiles, o overlay repinta em
 * resposta, e capturar antes disso grava um frame incompleto — e *quanto*
 * incompleto depende da velocidade do disco, o que é a definição de
 * não-determinístico.
 *
 * A política aqui é **esperar quietude**, não esperar um tempo fixo: o frame só
 * é capturado depois de N milissegundos sem nenhum repintar novo. Timeout fixo
 * grava frame errado em máquina lenta e desperdiça tempo em máquina rápida.
 */

import { planExport, type ExportPlan, type ExportPlanInput } from "@theatrum/export";
import type { ComposedFrame } from "./frame-composer.js";

/**
 * O que o export precisa saber fazer com o aplicativo, sem conhecê-lo.
 *
 * `compose` entra aqui em vez de o motor construir um `FrameComposer`: o export
 * não precisa saber que o frame vem de três canvases empilhados, e injetar isso
 * é o que permite provar a política de `settle` sem DOM nenhum.
 */
export interface ExportHost {
  /** Põe o playhead no frame e devolve quando o documento o registrou. */
  readonly seek: (frame: number) => void;
  /** Frame que o overlay desenhou por último, e quantas vezes ele repintou. */
  readonly observe: () => { readonly frame: number; readonly renders: number };
  /** Verdadeiro enquanto o mapa ainda tem trabalho pendente. */
  readonly mapBusy: () => boolean;
  /** Pixels do frame atual, ou `null` se não há o que compor. */
  readonly compose: () => ComposedFrame | null;
  readonly writeFrame: (
    filename: string,
    frame: ComposedFrame,
  ) => Promise<{ readonly ok: boolean; readonly sha256: string; readonly message?: string }>;
}

export interface ExportProgress {
  readonly done: number;
  readonly total: number;
  /** Milissegundos esperando quietude no último frame. */
  readonly settleMs: number;
}

export interface ExportOptions {
  readonly plan: ExportPlanInput;
  readonly host: ExportHost;
  readonly onProgress?: (progress: ExportProgress) => void;
  /** Chamado a cada frame; devolver `true` interrompe. */
  readonly shouldAbort?: () => boolean;
}

export interface ExportReport {
  readonly plan: ExportPlan;
  readonly written: number;
  /** SHA-256 por nome de arquivo, na ordem de escrita. */
  readonly hashes: readonly { readonly filename: string; readonly sha256: string }[];
  /** Frames em que a quietude não chegou dentro do teto. Tem de ser zero. */
  readonly settleFailed: number;
  readonly settleP99Ms: number;
  readonly aborted: boolean;
  readonly errors: readonly string[];
}

/** Quietude exigida antes de capturar. Três frames a 60 Hz, com folga. */
const QUIET_MS = 60;

/** Teto por frame. Estourar conta em `settleFailed` e não interrompe o job. */
const SETTLE_TIMEOUT_MS = 4_000;

const POLL_MS = 8;

export async function runExport(options: ExportOptions): Promise<ExportReport> {
  const plan = planExport(options.plan);
  const hashes: { filename: string; sha256: string }[] = [];
  const errors: string[] = [];
  const settleTimes: number[] = [];
  let settleFailed = 0;
  let aborted = false;

  for (const planned of plan.frames) {
    if (options.shouldAbort?.() === true) {
      aborted = true;
      break;
    }
    options.host.seek(planned.frame);
    const settle = await waitForQuiet(options.host, planned.frame);
    settleTimes.push(settle.elapsedMs);
    if (!settle.quiet) settleFailed += 1;

    const composed = options.host.compose();
    if (composed === null) {
      errors.push(`${planned.filename}: nenhuma superfície para compor`);
      continue;
    }
    const result = await options.host.writeFrame(planned.filename, composed);
    if (!result.ok) {
      errors.push(`${planned.filename}: ${result.message ?? "falha ao escrever"}`);
      continue;
    }
    hashes.push({ filename: planned.filename, sha256: result.sha256 });
    options.onProgress?.({
      done: hashes.length,
      total: plan.frames.length,
      settleMs: settle.elapsedMs,
    });
  }

  return {
    plan,
    written: hashes.length,
    hashes: Object.freeze(hashes),
    settleFailed,
    settleP99Ms: percentile(settleTimes, 0.99),
    aborted,
    errors: Object.freeze(errors),
  };
}

/**
 * Espera o frame pedido aparecer no overlay e parar de mudar.
 *
 * Duas condições, e as duas importam. `frame === alvo` garante que estamos
 * olhando o frame certo — o overlay pode estar terminando o anterior. Contador de
 * repinturas estável por `QUIET_MS` garante que ele terminou: um repintar novo
 * significa que geometria ou tile acabou de chegar, e capturar ali gravaria um
 * frame pela metade.
 *
 * `mapBusy` entra como terceira condição porque o mapa pode estar carregando um
 * tile **sem** ter causado repintura ainda.
 */
async function waitForQuiet(
  host: ExportHost,
  frame: number,
): Promise<{ readonly quiet: boolean; readonly elapsedMs: number }> {
  const startedAt = performance.now();
  let quietSince: number | null = null;
  let lastRenders = -1;

  while (performance.now() - startedAt < SETTLE_TIMEOUT_MS) {
    const observed = host.observe();
    const busy = host.mapBusy();
    if (observed.frame === frame && !busy) {
      if (observed.renders === lastRenders) {
        if (quietSince !== null && performance.now() - quietSince >= QUIET_MS) {
          return { quiet: true, elapsedMs: performance.now() - startedAt };
        }
      } else {
        lastRenders = observed.renders;
        quietSince = performance.now();
      }
    } else {
      // Frame errado ou mapa ocupado zera a contagem: quietude parcial não conta.
      quietSince = null;
      lastRenders = observed.renders;
    }
    await sleep(POLL_MS);
  }
  return { quiet: false, elapsedMs: performance.now() - startedAt };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Percentil por interpolação nenhuma: o elemento na posição, e pronto. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] as number;
}
