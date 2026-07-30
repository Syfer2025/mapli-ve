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

import {
  MotionBlurAccumulator,
  motionBlurSampleFrames,
  planExport,
  planMotionBlur,
  type ExportPlan,
  type ExportPlanInput,
  type MotionBlurSpec,
  type PlannedMotionBlur,
} from "@theatrum/export";
import type { ComposedFrame } from "./frame-composer.js";

/**
 * O que o export precisa saber fazer com o aplicativo, sem conhecê-lo.
 *
 * `compose` entra aqui em vez de o motor construir um `FrameComposer`: o export
 * não precisa saber que o frame vem de três canvases empilhados, e injetar isso
 * é o que permite provar a política de `settle` sem DOM nenhum.
 */
export interface ExportHost {
  /**
   * Põe o render no frame pedido.
   *
   * `centerFrame` é o frame inteiro do arquivo. Durante motion blur, `frame` é a
   * amostra fracionária e o segundo valor permite que um host congele superfícies
   * que não têm sampling temporal próprio, como a câmera do mapa.
   */
  readonly seek: (frame: number, centerFrame: number) => void;
  /** Frame que o overlay desenhou por último, e quantas vezes ele repintou. */
  readonly observe: () => { readonly frame: number; readonly renders: number };
  /** Verdadeiro enquanto câmera ou tiles do mapa ainda têm trabalho pendente. */
  readonly mapBusy: () => boolean;
  /**
   * Verdadeiro durante decode/parse de assets que ainda podem aparecer no
   * frame. Tem orçamento próprio porque um GLB grande legitimamente leva mais
   * que o settle normal do mapa, sobretudo na primeira execução.
   */
  readonly assetsBusy: () => boolean;
  /**
   * Verdadeiro enquanto alguma superfície composta ainda não está no tamanho do
   * frame ([ADR-022](../../../../docs/adr/ADR-022-export-resolution-from-composition.md)).
   *
   * Existe porque o tamanho das superfícies deixou de ser o do painel e passou a
   * ser conduzido pelo job, e **a condução não é instantânea**: o mapa
   * redimensiona de forma síncrona, o overlay Pixi só chega ao tamanho novo
   * depois de `ResizeObserver` → `setState` → efeito de render. Sem esta
   * condição, um redimensionamento atrasado — inclusive o da RESTAURAÇÃO do
   * export anterior — cai no meio deste, o compositor **escala** a superfície
   * fora de medida dentro do frame planejado, e o arquivo sai plausível e
   * diferente entre execuções. Medido: fazia o critério 6 do `verify:phase8`
   * oscilar entre 5/7 e 7/7 com o mesmo código.
   *
   * Não tem orçamento próprio: um redimensionamento que não converge em 4 s é
   * defeito, não trabalho legítimo, e o teto comum já o nomeia.
   */
  readonly surfacesBusy: () => boolean;
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
  /** Soma dos settles já concluídos no frame de saída corrente. */
  readonly settleMs: number;
  /** Settle da subamostra que acabou de concluir. */
  readonly lastSampleSettleMs: number;
  readonly currentSample: number;
  readonly samplesPerFrame: number;
  readonly samplesDone: number;
  readonly totalSamples: number;
  /** Relógio do pump, iniciado depois de todo preflight e diálogo de pasta. */
  readonly elapsedMs: number;
}

export interface ExportOptions {
  readonly plan: ExportPlanInput;
  readonly host: ExportHost;
  readonly onProgress?: (progress: ExportProgress) => void;
  /**
   * Consultado antes de frames/amostras e durante o settle temporal. Deve ser
   * idempotente e sem efeitos colaterais; devolver `true` interrompe.
   */
  readonly shouldAbort?: () => boolean;
  /** Ausente, ângulo zero ou uma amostra preserva o caminho anterior. */
  readonly motionBlur?: MotionBlurSpec;
}

export interface MotionBlurSampleTrace {
  readonly outputFrame: number;
  readonly sampleIndex: number;
  readonly requestedFrame: number;
  readonly observedFrame: number;
  readonly quiet: boolean;
  readonly settleMs: number;
}

export interface SettleFailureTrace {
  readonly outputIndex: number;
  readonly outputFrame: number;
  readonly sampleIndex: number;
  readonly sampleFrame: number;
}

export interface MotionBlurReport extends PlannedMotionBlur {
  readonly totalSamples: number;
  /** Subframes cujo settle terminou, com quietude ou por timeout. */
  readonly processedSamples: number;
  /** Subframes que realmente alcançaram quietude. */
  readonly settledSamples: number;
  /** Subframes que entraram de fato no Float32Array. Zero no bypass. */
  readonly accumulatedSamples: number;
  readonly resolvedFrames: number;
  readonly accumulatorAllocations: number;
  /** Float32Array + destino RGBA8 reaproveitados pelo job. */
  readonly accumulatorBytes: number;
  /** Só o Float32Array; em UHD são 132 MB e no teto 4096², 256 MiB (ADR-025). */
  readonly accumulatorFloatBytes: number;
  /** Limitado para diagnóstico; os contadores acima continuam completos. */
  readonly sampleTrace: readonly MotionBlurSampleTrace[];
}

export interface ExportReport {
  readonly plan: ExportPlan;
  readonly written: number;
  /** SHA-256 por nome de arquivo, na ordem de escrita. */
  readonly hashes: readonly { readonly filename: string; readonly sha256: string }[];
  /** Amostras em que a quietude não chegou dentro do teto. Tem de ser zero. */
  readonly settleFailed: number;
  /** Quantos frames de saída contêm ao menos uma amostra sem quietude. */
  readonly settleFailedOutputFrames: number;
  /**
   * **Quais centros da composição** tiveram ao menos uma falha.
   *
   * Uma contagem sem os números não é acionável: "13 de 300 falharam" não diz se
   * foram os treze primeiros — o mapa ainda carregando, e o export está bom do
   * frame 14 em diante — ou treze espalhados, que é outro problema. Taxas de
   * saída maiores podem repetir um centro; `settleFailures` conserva o
   * índice de saída que distingue essas ocorrências. Limitado a 64.
   */
  readonly settleFailedFrames: readonly number[];
  /** Falhas por amostra, com índice de saída inequívoco. Limitado a 64. */
  readonly settleFailures: readonly SettleFailureTrace[];
  readonly settleP99Ms: number;
  readonly motionBlur: MotionBlurReport;
  readonly aborted: boolean;
  readonly errors: readonly string[];
}

/** Quietude exigida antes de capturar. Três frames a 60 Hz, com folga. */
const QUIET_MS = 60;

/** Teto por frame. Estourar conta em `settleFailed` e não interrompe o job. */
const SETTLE_TIMEOUT_MS = 4_000;

/**
 * Teto do carregamento inicial de assets. Não aumentar o teto comum para isto:
 * câmera ou tile presos precisam continuar falhando cedo, enquanto parsear um
 * GLB grande a frio pode levar vários segundos e ainda ser trabalho legítimo.
 */
const ASSET_SETTLE_TIMEOUT_MS = 30_000;

const POLL_MS = 8;
const MAX_SAMPLE_TRACE = 256;

export async function runExport(options: ExportOptions): Promise<ExportReport> {
  const plan = planExport(options.plan);
  // Validação antes do primeiro seek, compose ou write. O serviço faz a mesma
  // validação antes de abrir a pasta; esta fronteira continua segura sozinha.
  const motionBlur = planMotionBlur(options.motionBlur);
  const hashes: { filename: string; sha256: string }[] = [];
  const errors: string[] = [];
  const settleTimes: number[] = [];
  const settleFailedFrames: number[] = [];
  const settleFailures: SettleFailureTrace[] = [];
  const settleFailedOutputIndices = new Set<number>();
  const sampleTrace: MotionBlurSampleTrace[] = [];
  const accumulator = motionBlur.enabled ? new MotionBlurAccumulator() : null;
  const totalSamples = plan.frames.length * motionBlur.effectiveSamples;
  const startedAt = performance.now();
  let settleFailed = 0;
  let processedSamples = 0;
  let settledSamples = 0;
  let accumulatedSamples = 0;
  let aborted = false;

  const recordSettleFailure = (
    outputIndex: number,
    outputFrame: number,
    sampleIndex: number,
    sampleFrame: number,
  ): void => {
    settleFailed += 1;
    if (!settleFailedOutputIndices.has(outputIndex)) {
      settleFailedOutputIndices.add(outputIndex);
      if (settleFailedFrames.length < 64) settleFailedFrames.push(outputFrame);
    }
    if (settleFailures.length < 64) {
      settleFailures.push({ outputIndex, outputFrame, sampleIndex, sampleFrame });
    }
  };

  outputFrames: for (const planned of plan.frames) {
    if (options.shouldAbort?.() === true) {
      aborted = true;
      break;
    }

    let composed: ComposedFrame | null;
    let frameSettleMs = 0;
    let lastSampleSettleMs = 0;

    if (!motionBlur.enabled) {
      // Caminho legado deliberadamente literal: um seek, um settle, um compose.
      // O acumulador nem existe, que é a garantia byte-idêntica do ADR-025.
      options.host.seek(planned.frame, planned.frame);
      const settle = await waitForQuiet(options.host, planned.frame, options.shouldAbort);
      if (settle.aborted) {
        aborted = true;
        break;
      }
      frameSettleMs = settle.elapsedMs;
      lastSampleSettleMs = settle.elapsedMs;
      settleTimes.push(settle.elapsedMs);
      processedSamples += 1;
      if (!settle.quiet) {
        recordSettleFailure(planned.index, planned.frame, 0, planned.frame);
      } else {
        settledSamples += 1;
      }
      composed = options.host.compose();
    } else {
      const sampleFrames = motionBlurSampleFrames(
        planned.frame,
        options.plan.durationFrames,
        motionBlur,
      );
      try {
        for (let sampleIndex = 0; sampleIndex < sampleFrames.length; sampleIndex += 1) {
          if (options.shouldAbort?.() === true) {
            aborted = true;
            break outputFrames;
          }
          const sampleFrame = sampleFrames[sampleIndex] as number;
          options.host.seek(sampleFrame, planned.frame);
          const settle = await waitForQuiet(options.host, sampleFrame, options.shouldAbort);
          if (settle.aborted) {
            aborted = true;
            break outputFrames;
          }

          frameSettleMs += settle.elapsedMs;
          lastSampleSettleMs = settle.elapsedMs;
          settleTimes.push(settle.elapsedMs);
          processedSamples += 1;
          if (!settle.quiet) {
            recordSettleFailure(planned.index, planned.frame, sampleIndex, sampleFrame);
          } else {
            settledSamples += 1;
          }
          if (sampleTrace.length < MAX_SAMPLE_TRACE) {
            sampleTrace.push({
              outputFrame: planned.frame,
              sampleIndex,
              requestedFrame: sampleFrame,
              observedFrame: settle.observedFrame,
              quiet: settle.quiet,
              settleMs: settle.elapsedMs,
            });
          }

          // Heartbeat por subframe: oito settles não podem parecer um travamento.
          options.onProgress?.({
            done: hashes.length,
            total: plan.frames.length,
            settleMs: frameSettleMs,
            lastSampleSettleMs,
            currentSample: sampleIndex + 1,
            samplesPerFrame: motionBlur.effectiveSamples,
            samplesDone: processedSamples,
            totalSamples,
            elapsedMs: performance.now() - startedAt,
          });

          const sample = options.host.compose();
          if (sample === null) {
            errors.push(
              `${planned.filename}: nenhuma superfície para compor na amostra ${String(sampleIndex + 1)}/${String(sampleFrames.length)}`,
            );
            continue outputFrames;
          }
          if (sampleIndex === 0) accumulator?.begin(sample.width, sample.height);
          accumulator?.add(sample);
          accumulatedSamples += 1;
        }
      } finally {
        // Cancelamento, superfície ausente e exceção têm a mesma pós-condição:
        // nenhuma fração temporal pode vazar do motor para a autoria.
        options.host.seek(planned.frame, planned.frame);
      }
      composed = accumulator?.resolve(motionBlur.effectiveSamples) ?? null;
    }

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
      settleMs: frameSettleMs,
      lastSampleSettleMs,
      currentSample: motionBlur.effectiveSamples,
      samplesPerFrame: motionBlur.effectiveSamples,
      samplesDone: processedSamples,
      totalSamples,
      elapsedMs: performance.now() - startedAt,
    });
  }

  return {
    plan,
    written: hashes.length,
    hashes: Object.freeze(hashes),
    settleFailed,
    settleFailedOutputFrames: settleFailedOutputIndices.size,
    settleFailedFrames: Object.freeze(settleFailedFrames),
    settleFailures: Object.freeze(settleFailures),
    settleP99Ms: percentile(settleTimes, 0.99),
    motionBlur: Object.freeze({
      ...motionBlur,
      totalSamples,
      processedSamples,
      settledSamples,
      accumulatedSamples,
      resolvedFrames: accumulator?.resolvedFrames ?? 0,
      accumulatorAllocations: accumulator?.allocations ?? 0,
      accumulatorBytes: accumulator?.bytes ?? 0,
      accumulatorFloatBytes: accumulator?.floatBytes ?? 0,
      sampleTrace: Object.freeze(sampleTrace),
    }),
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
 * `mapBusy` e `assetsBusy` entram porque tile ou GLB podem estar carregando
 * **sem** ter causado repintura ainda. Asset tem teto próprio: o relógio comum
 * recomeça enquanto ele está pendente, mas o teto de asset continua absoluto.
 */
async function waitForQuiet(
  host: ExportHost,
  frame: number,
  shouldAbort?: () => boolean,
): Promise<{
  readonly quiet: boolean;
  readonly elapsedMs: number;
  readonly observedFrame: number;
  readonly aborted: boolean;
}> {
  const startedAt = performance.now();
  let ordinaryDeadline = startedAt + SETTLE_TIMEOUT_MS;
  let quietSince: number | null = null;
  let lastRenders = -1;
  let lastObservedFrame = -1;

  while (true) {
    if (shouldAbort?.() === true) {
      return {
        quiet: false,
        elapsedMs: performance.now() - startedAt,
        observedFrame: lastObservedFrame,
        aborted: true,
      };
    }
    const now = performance.now();
    const observed = host.observe();
    lastObservedFrame = observed.frame;
    // Superfície fora de medida entra junto com o mapa: as duas significam "o
    // que eu capturaria agora não é o frame final".
    const mapBusy = host.mapBusy() || host.surfacesBusy();
    const assetsBusy = host.assetsBusy();
    if (assetsBusy) {
      if (now - startedAt >= ASSET_SETTLE_TIMEOUT_MS) {
        return {
          quiet: false,
          elapsedMs: now - startedAt,
          observedFrame: observed.frame,
          aborted: false,
        };
      }
      // O orçamento curto mede mapa/quietude, não tempo legítimo de parse.
      ordinaryDeadline = now + SETTLE_TIMEOUT_MS;
    } else if (now >= ordinaryDeadline) {
      return {
        quiet: false,
        elapsedMs: now - startedAt,
        observedFrame: observed.frame,
        aborted: false,
      };
    }

    if (observed.frame === frame && !mapBusy && !assetsBusy) {
      if (observed.renders !== lastRenders || quietSince === null) {
        lastRenders = observed.renders;
        // `quietSince === null` cobre a transição ocupado → livre mesmo quando
        // o término do trabalho não dispara repaint. Sem isto, assets/tiles
        // podem zerar com o contador igual e a quietude nunca começa a contar.
        quietSince = now;
      } else if (now - quietSince >= QUIET_MS) {
        return {
          quiet: true,
          elapsedMs: now - startedAt,
          observedFrame: observed.frame,
          aborted: false,
        };
      }
    } else {
      // Frame errado ou mapa ocupado zera a contagem: quietude parcial não conta.
      quietSince = null;
      lastRenders = observed.renders;
    }
    await sleep(POLL_MS);
  }
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
