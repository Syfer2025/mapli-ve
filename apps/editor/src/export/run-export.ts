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
  /**
   * O que fazer quando o frame não estabiliza dentro do orçamento.
   *
   * Ausente significa `fail`: um export final nunca grava silenciosamente o
   * estado parcial que estava na tela no instante do timeout. `continue` existe
   * para diagnóstico e compatibilidade com bancadas que querem inspecionar o
   * frame duvidoso; precisa ser pedido de forma explícita.
   */
  readonly settlePolicy?: SettlePolicy;
  readonly onProgress?: (progress: ExportProgress) => void;
  /**
   * Consultado antes de frames/amostras e durante o settle temporal. Deve ser
   * idempotente e sem efeitos colaterais; devolver `true` interrompe.
   */
  readonly shouldAbort?: () => boolean;
  /** Ausente, ângulo zero ou uma amostra preserva o caminho anterior. */
  readonly motionBlur?: MotionBlurSpec;
  /**
   * Quantos frames iniciais já estão confirmados no destino. O pump preserva os
   * nomes/índices do plano e começa no próximo, permitindo retomar sequências.
   */
  readonly resumeFromOutputIndex?: number;
  /** Total registrado junto ao checkpoint; precisa continuar idêntico ao plano. */
  readonly resumeExpectedTotalFrames?: number;
  /** Manifesto SHA-256 do prefixo já confirmado, exatamente na ordem do plano. */
  readonly resumeFrameHashes?: readonly ExportFrameHash[];
  /** Persistência durável do progresso; chamada a cada 300 frames por padrão. */
  readonly onCheckpoint?: (checkpoint: ExportCheckpointProgress) => void | Promise<void>;
  readonly checkpointEvery?: number;
}

export type SettlePolicy = "fail" | "continue";

export type SettleFailureReason =
  "map-busy" | "assets-busy" | "surfaces-busy" | "frame-mismatch" | "repaint-timeout";

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
  readonly reason: SettleFailureReason;
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
  /** Só o Float32Array; em UHD são 132 MB e no teto 8192², 1 GiB (ADR-025/034). */
  readonly accumulatorFloatBytes: number;
  /** Limitado para diagnóstico; os contadores acima continuam completos. */
  readonly sampleTrace: readonly MotionBlurSampleTrace[];
}

export interface ExportReport {
  readonly plan: ExportPlan;
  readonly settlePolicy: SettlePolicy;
  readonly written: number;
  /** Frames confirmados por um checkpoint anterior e não renderizados de novo. */
  readonly reused: number;
  /** SHA-256 por nome de arquivo, na ordem de escrita. */
  readonly hashes: readonly ExportFrameHash[];
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
  /** O pump parou antes de compor o frame cujo settle falhou. */
  readonly terminatedBySettle: boolean;
  readonly errors: readonly string[];
}

export interface ExportCheckpointProgress {
  readonly completedFrames: number;
  readonly totalFrames: number;
  readonly lastFilename: string | null;
  readonly complete: boolean;
  /** Manifesto cumulativo do prefixo contíguo, incluindo frames retomados. */
  readonly hashes: readonly ExportFrameHash[];
}

export interface ExportFrameHash {
  readonly filename: string;
  readonly sha256: string;
}

/** Quietude exigida antes de capturar. Três frames a 60 Hz, com folga. */
const QUIET_MS = 60;

/** Teto por frame. Estourar obedece à política explícita do job. */
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
  const settlePolicy = options.settlePolicy ?? "fail";
  const reused = options.resumeFromOutputIndex ?? 0;
  const checkpointEvery = options.checkpointEvery ?? 300;
  if (!Number.isInteger(reused) || reused < 0 || reused > plan.frames.length) {
    throw new Error(
      `checkpoint inválido: ${String(reused)} de ${String(plan.frames.length)} frames`,
    );
  }
  if (
    options.resumeExpectedTotalFrames !== undefined &&
    options.resumeExpectedTotalFrames !== plan.frames.length
  ) {
    throw new Error(
      `checkpoint pertence a um plano de ${String(options.resumeExpectedTotalFrames)} frames, mas o plano atual tem ${String(plan.frames.length)}`,
    );
  }
  if (!Number.isInteger(checkpointEvery) || checkpointEvery <= 0) {
    throw new Error(`intervalo de checkpoint inválido: ${String(checkpointEvery)}`);
  }
  const resumeFrameHashes = options.resumeFrameHashes ?? [];
  if (resumeFrameHashes.length !== reused) {
    throw new Error(
      `manifesto do checkpoint inválido: ${String(resumeFrameHashes.length)} hashes para ${String(reused)} frames`,
    );
  }
  for (let index = 0; index < resumeFrameHashes.length; index += 1) {
    const frame = resumeFrameHashes[index];
    const expected = plan.frames[index];
    if (
      frame === undefined ||
      expected === undefined ||
      frame.filename !== expected.filename ||
      !/^[a-f0-9]{64}$/u.test(frame.sha256)
    ) {
      throw new Error(`manifesto do checkpoint inválido no frame ${String(index)}`);
    }
  }
  // Validação antes do primeiro seek, compose ou write. O serviço faz a mesma
  // validação antes de abrir a pasta; esta fronteira continua segura sozinha.
  const motionBlur = planMotionBlur(options.motionBlur);
  const hashes: ExportFrameHash[] = [];
  const contiguousHashes: ExportFrameHash[] = [...resumeFrameHashes];
  const errors: string[] = [];
  const settleTimes: number[] = [];
  const settleFailedFrames: number[] = [];
  const settleFailures: SettleFailureTrace[] = [];
  const settleFailedOutputIndices = new Set<number>();
  const sampleTrace: MotionBlurSampleTrace[] = [];
  const accumulator = motionBlur.enabled ? new MotionBlurAccumulator() : null;
  const totalSamples = (plan.frames.length - reused) * motionBlur.effectiveSamples;
  const startedAt = performance.now();
  let settleFailed = 0;
  let processedSamples = 0;
  let settledSamples = 0;
  let accumulatedSamples = 0;
  let aborted = false;
  let terminatedBySettle = false;
  let contiguousCompleted = reused;
  let lastCheckpoint = reused;
  let checkpointFailed = false;

  const persistCheckpoint = async (
    lastFilename: string | null,
    complete: boolean,
  ): Promise<boolean> => {
    if (options.onCheckpoint === undefined || contiguousCompleted === lastCheckpoint) return true;
    try {
      await options.onCheckpoint({
        completedFrames: contiguousCompleted,
        totalFrames: plan.frames.length,
        lastFilename,
        complete,
        hashes: Object.freeze([...contiguousHashes]),
      });
      lastCheckpoint = contiguousCompleted;
      return true;
    } catch (error: unknown) {
      checkpointFailed = true;
      errors.push(
        `checkpoint ${String(contiguousCompleted)}/${String(plan.frames.length)} falhou: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  };

  const recordSettleFailure = (
    outputIndex: number,
    outputFrame: number,
    sampleIndex: number,
    sampleFrame: number,
    reason: SettleFailureReason,
  ): void => {
    settleFailed += 1;
    if (!settleFailedOutputIndices.has(outputIndex)) {
      settleFailedOutputIndices.add(outputIndex);
      if (settleFailedFrames.length < 64) settleFailedFrames.push(outputFrame);
    }
    if (settleFailures.length < 64) {
      settleFailures.push({ outputIndex, outputFrame, sampleIndex, sampleFrame, reason });
    }
  };

  const failClosed = (
    filename: string,
    outputIndex: number,
    outputFrame: number,
    sampleIndex: number,
    sampleFrame: number,
    reason: SettleFailureReason,
  ): boolean => {
    recordSettleFailure(outputIndex, outputFrame, sampleIndex, sampleFrame, reason);
    if (settlePolicy === "continue") return false;
    terminatedBySettle = true;
    errors.push(
      `${filename}: settle falhou (${reason}) no frame ${String(outputFrame)}, amostra ${String(sampleIndex + 1)}; nenhum pixel desse frame foi escrito`,
    );
    return true;
  };

  outputFrames: for (const planned of plan.frames.slice(reused)) {
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
        if (
          failClosed(
            planned.filename,
            planned.index,
            planned.frame,
            0,
            planned.frame,
            settle.reason ?? "repaint-timeout",
          )
        ) {
          break;
        }
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
            if (
              failClosed(
                planned.filename,
                planned.index,
                planned.frame,
                sampleIndex,
                sampleFrame,
                settle.reason ?? "repaint-timeout",
              )
            ) {
              break outputFrames;
            }
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
            done: reused + hashes.length,
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

    let result: Awaited<ReturnType<ExportHost["writeFrame"]>>;
    try {
      result = await options.host.writeFrame(planned.filename, composed);
    } catch (error: unknown) {
      errors.push(
        `${planned.filename}: falha inesperada ao escrever: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      break;
    }
    if (!result.ok) {
      errors.push(`${planned.filename}: ${result.message ?? "falha ao escrever"}`);
      break;
    }
    const frameHash = { filename: planned.filename, sha256: result.sha256 };
    hashes.push(frameHash);
    if (planned.index === contiguousCompleted) {
      contiguousCompleted += 1;
      contiguousHashes.push(frameHash);
    }
    options.onProgress?.({
      done: reused + hashes.length,
      total: plan.frames.length,
      settleMs: frameSettleMs,
      lastSampleSettleMs,
      currentSample: motionBlur.effectiveSamples,
      samplesPerFrame: motionBlur.effectiveSamples,
      samplesDone: processedSamples,
      totalSamples,
      elapsedMs: performance.now() - startedAt,
    });
    if (
      (contiguousCompleted % checkpointEvery === 0 || contiguousCompleted === plan.frames.length) &&
      !(await persistCheckpoint(planned.filename, contiguousCompleted === plan.frames.length))
    ) {
      break;
    }
  }

  if (!checkpointFailed && contiguousCompleted > lastCheckpoint && (aborted || errors.length > 0)) {
    await persistCheckpoint(
      contiguousCompleted === 0 ? null : (plan.frames[contiguousCompleted - 1]?.filename ?? null),
      false,
    );
  }

  return {
    plan,
    settlePolicy,
    written: hashes.length,
    reused,
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
    terminatedBySettle,
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
  readonly reason: SettleFailureReason | null;
}> {
  const startedAt = performance.now();
  let ordinaryDeadline = startedAt + SETTLE_TIMEOUT_MS;
  let quietSince: number | null = null;
  let lastRenders = -1;
  let lastObservedFrame = -1;
  let lastReason: SettleFailureReason;

  while (true) {
    if (shouldAbort?.() === true) {
      return {
        quiet: false,
        elapsedMs: performance.now() - startedAt,
        observedFrame: lastObservedFrame,
        aborted: true,
        reason: null,
      };
    }
    const now = performance.now();
    const observed = host.observe();
    lastObservedFrame = observed.frame;
    // Superfície fora de medida entra junto com o mapa: as duas significam "o
    // que eu capturaria agora não é o frame final".
    const mapBusy = host.mapBusy();
    const surfacesBusy = host.surfacesBusy();
    const assetsBusy = host.assetsBusy();
    lastReason = assetsBusy
      ? "assets-busy"
      : surfacesBusy
        ? "surfaces-busy"
        : mapBusy
          ? "map-busy"
          : observed.frame !== frame
            ? "frame-mismatch"
            : "repaint-timeout";
    if (assetsBusy) {
      if (now - startedAt >= ASSET_SETTLE_TIMEOUT_MS) {
        return {
          quiet: false,
          elapsedMs: now - startedAt,
          observedFrame: observed.frame,
          aborted: false,
          reason: lastReason,
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
        reason: lastReason,
      };
    }

    if (observed.frame === frame && !mapBusy && !surfacesBusy && !assetsBusy) {
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
          reason: null,
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
