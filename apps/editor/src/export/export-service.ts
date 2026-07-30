/**
 * A ligação entre o motor de export e o aplicativo real.
 *
 * Monta o `ExportHost` a partir do que já existe: a sessão do editor move o
 * playhead, o overlay conta as repinturas, o mapa diz se ainda está carregando,
 * o compositor lê as três superfícies e a ponte do shell escreve em disco.
 *
 * Nenhuma dessas peças conhece as outras — é isto que permitiu provar a política
 * de `settle` em teste unitário sem GPU ([run-export.test.ts](./run-export.test.ts)).
 */

import {
  counterDigits,
  planExportResolution,
  planMotionBlur,
  sanitizeBasename,
  type ExportResolution,
  type FfmpegExportFormat,
  type MotionBlurSpec,
  type PlannedMotionBlur,
} from "@theatrum/export";
import { hashObject } from "@theatrum/core-utils";
import type { Composition } from "@theatrum/schema";
import type { Map as MapLibreMap } from "maplibre-gl";
import { bridge } from "../bridge/index.js";
import { editorActions, getEditorSessionSnapshot } from "../document/editor-session.js";
import { cacheRenderedPreviewFrame } from "../preview/preview-cache-session.js";
import { FrameComposer, type ComposedFrame } from "./frame-composer.js";
import { mapBusyForExport, mapExportBlockReason } from "./map-export-readiness.js";
import {
  runExport,
  type ExportHost,
  type ExportCheckpointProgress,
  type ExportFrameHash,
  type ExportProgress,
  type ExportReport,
  type SettlePolicy,
} from "./run-export.js";
import { runWithSurfaceOverride } from "./surface-override.js";
import {
  createVideoEncodeSession,
  incompleteVideoReason,
  isVideoEncodingSupported,
  type VideoEncodeSession,
} from "./video-encoder.js";

/**
 * Taxa de bits por megapixel e por segundo.
 *
 * Escalar pela área é o que faz uma exportação de 720p e uma de 4K terem a mesma
 * qualidade aparente: bitrate fixo dá um 4K borrado ou um 720p enorme. 0,12 bit
 * por pixel por frame é o patamar em que mapa e texto param de mostrar artefato
 * de bloco — medido olhando, e generoso de propósito, porque o assunto aqui tem
 * texto fino sobre fundo escuro, que é o pior caso do H.264.
 */
const BITS_PER_PIXEL_PER_FRAME = 0.12;

/** O que o overlay precisa expor para o export saber quando capturar. */
export interface OverlayProbe {
  readonly frame: number;
  readonly renders: number;
  /**
   * Assets do documento ainda carregando (GLB em parse na camada 3D ou no
   * palco). Um asset que falhou conta como resolvido, sem modelo — nunca
   * como pendente, senão o settle travaria no timeout. Sem este número o
   * settle é cego para a carga do GLB: o frame sai sem a aeronave quando o
   * export começa antes do parse, e duas execuções do mesmo projeto divergem.
   */
  readonly pendingAssets: number;
}

export type ExportPhase = "rendering" | "finalizing";

export interface StartExportOptions {
  /**
   * O mapa, quando existe.
   *
   * **Opcional desde que o palco exporta.** O `studio` é um dos dois modos que o
   * `frame-composer` detecta ([ADR-014](../../../../docs/adr/ADR-014-studio-own-panel.md)),
   * e nele não há MapLibre nenhum: o painel do Viewport está desmontado. Exigir o
   * mapa aqui era o que obrigava todo export a ser disparado de lá, e por isso os
   * vídeos do palco vinham de captura de tela — com barra de botões e diagnóstico
   * dentro da imagem, exatamente o que o critério 8 da Fase 8 proíbe.
   *
   * Ausente, `mapBusy` é sempre falso. Isso **não** afrouxa o `settle`: no palco
   * não há tile para carregar, e o que segura o frame é o contador de repinturas
   * do overlay mais os GLB pendentes, que continuam valendo por `probe`.
   */
  readonly map?: MapLibreMap;
  readonly probe: () => OverlayProbe;
  readonly onProgress?: (progress: ExportProgress) => void;
  /** Mudança de fase para a fila não confundir render concluído com arquivo pronto. */
  readonly onPhase?: (phase: ExportPhase) => void;
  readonly shouldAbort?: () => boolean;
  /**
   * Política de timeout do mapa. O produto não a informa e recebe o padrão
   * seguro `fail`; `continue` fica reservado a diagnósticos explícitos.
   */
  readonly settlePolicy?: SettlePolicy;
  /** Trecho a exportar. Sem ele, a composição inteira. */
  readonly range?: { readonly first: number; readonly last: number };
  readonly outputFps?: number;
  /** Destino já conhecido; presente, o diálogo de pasta é pulado. */
  readonly directory?: string;
  /**
   * Multiplicador sobre o tamanho autorado ([ADR-022](../../../../docs/adr/ADR-022-export-resolution-from-composition.md)).
   *
   * Vive no job e não no documento porque é preferência de saída, como
   * `outputFps` e o trecho — não conteúdo. Ausente, 1: a composição como ela foi
   * autorada, que é o que `compToScreen` vira na identidade.
   */
  readonly scale?: number;
  /**
   * Fator inteiro renderizado por eixo antes do box determinístico (ADR-024).
   * Ausente, 1 — o caminho anterior sem redutor.
   */
  readonly supersampling?: number;
  /**
   * Sampling temporal só no arquivo (ADR-025). Ausente mantém uma amostra e o
   * caminho byte-idêntico anterior.
   */
  readonly motionBlur?: MotionBlurSpec;
  /** Estado durável de uma sequência interrompida. MP4 direto reinicia do zero. */
  readonly resume?: {
    readonly completedFrames: number;
    readonly totalFrames: number;
    readonly directory: string;
    readonly framesDirectory?: string;
    readonly hashes: readonly ExportFrameHash[];
  };
  readonly onOutputPrepared?: (location: {
    readonly directory: string;
    readonly framesDirectory?: string;
  }) => void;
  readonly onCheckpoint?: (checkpoint: ExportCheckpointProgress) => void | Promise<void>;
}

/**
 * Superfície de verificação embutida no renderer.
 *
 * Ela prova somente os dois caminhos que rodam sem sidecar: PNG e MP4. GIF,
 * ProRes e PNG-alpha atravessam a fila de produto, não esta API de bancada.
 */
export type DebugExportOptions = Pick<
  StartExportOptions,
  "range" | "outputFps" | "directory" | "scale" | "supersampling" | "motionBlur"
> & {
  readonly format?: "png" | "mp4";
};

export interface StartExportResult {
  readonly ok: boolean;
  readonly directory: string;
  readonly report?: ExportReport;
  readonly message?: string;
  /** Nome do arquivo único, quando o formato não é uma sequência PNG. */
  readonly videoFile?: string;
  readonly videoBytes?: number;
  /** Hash do arquivo único produzido por FFmpeg. */
  readonly fileSha256?: string;
  /** Plano efetivamente usado, inclusive render ampliado e saída final. */
  readonly resolution?: ExportResolution;
  /** Frames que realmente atravessaram o box determinístico em CPU. */
  readonly boxReducedFrames?: number;
}

/** Despacho único da bancada; formato fora do contrato falha em vez de virar PNG. */
export function startDebugExport(
  options: StartExportOptions & Pick<DebugExportOptions, "format">,
): Promise<StartExportResult> {
  const { format, ...job } = options;
  if (format === undefined || format === "png") return startPngSequenceExport(job);
  if (format === "mp4") return startVideoExport(job);
  return Promise.resolve({
    ok: false,
    directory: "",
    message: `formato indisponível na bancada: ${String(format)}`,
  });
}

/**
 * Roda um export de sequência PNG da composição selecionada.
 *
 * Pausa a reprodução antes de começar. Um export com a composição tocando
 * disputaria o playhead com o próprio pump: o `seek` do frame N seria
 * atropelado pelo avanço automático, e o arquivo `frame_0007.png` conteria um
 * frame qualquer. Já aconteceu na verificação de fases anteriores.
 */
export async function startPngSequenceExport(
  options: StartExportOptions,
): Promise<StartExportResult> {
  const rendered = await renderPngFrames(options, {
    alpha: false,
    staging: false,
    jobSuffix: "",
  });
  return rendered.result;
}

/** Sequência PNG com o mapa removido e o canal alfa preservado. */
export async function startAlphaPngSequenceExport(
  options: StartExportOptions,
): Promise<StartExportResult> {
  const rendered = await renderPngFrames(options, {
    alpha: true,
    staging: false,
    jobSuffix: " - alpha",
  });
  return rendered.result;
}

/** GIF em dois passos: render dos PNGs, palettegen e paletteuse. */
export function startGifExport(options: StartExportOptions): Promise<StartExportResult> {
  return startFfmpegSequenceExport(options, "gif");
}

/** ProRes 4444 em MOV, com mapa removido e alfa de 16 bits no codec. */
export function startProRes4444Export(options: StartExportOptions): Promise<StartExportResult> {
  return startFfmpegSequenceExport(options, "prores4444");
}

interface FrameRenderConfig {
  readonly alpha: boolean;
  readonly staging: boolean;
  readonly jobSuffix: string;
}

type PlannedResolution =
  | { readonly ok: true; readonly resolution: ExportResolution }
  | { readonly ok: false; readonly message: string };

type PlannedMotion =
  | { readonly ok: true; readonly motionBlur: PlannedMotionBlur }
  | { readonly ok: false; readonly message: string };

/**
 * O tamanho do frame, antes de qualquer diálogo de pasta.
 *
 * A ordem importa: `planExportResolution` **recusa** acima do teto de 8192 px por
 * eixo em vez de cortar em silêncio, e recusar depois de o usuário escolher a
 * pasta seria pedir trabalho para jogar fora. A mensagem dele já nomeia o teto e
 * de onde ele vem, então basta repassá-la.
 */
function planResolutionFor(
  composition: Composition,
  scale: number | undefined,
  supersampling: number | undefined,
): PlannedResolution {
  try {
    return {
      ok: true,
      resolution: planExportResolution({
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        ...(scale === undefined ? {} : { scale }),
        ...(supersampling === undefined ? {} : { supersampling }),
      }),
    };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Validação temporal antes de pause, diálogo de pasta ou criação de arquivo. */
function planMotionFor(spec: MotionBlurSpec | undefined): PlannedMotion {
  try {
    return { ok: true, motionBlur: planMotionBlur(spec) };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * O tamanho a que as superfícies são conduzidas: layout em pixels de CSS e a
 * escala no backing store. É a decisão do ADR-022 em três números.
 */
function surfaceOverrideFor(resolution: ExportResolution): {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
} {
  return {
    width: resolution.layout[0],
    height: resolution.layout[1],
    pixelRatio: resolution.renderPixelRatio,
  };
}

interface RenderedPngFrames {
  readonly result: StartExportResult;
  readonly framesDirectory?: string;
  readonly framePrefix?: string;
  readonly digits?: number;
  readonly outputFps?: number;
  readonly compositionName?: string;
}

async function renderPngFrames(
  options: StartExportOptions,
  config: FrameRenderConfig,
): Promise<RenderedPngFrames> {
  const state = getEditorSessionSnapshot();
  const composition = state.document.compositions.find(
    (candidate) => candidate.id === state.selectedCompositionId,
  );
  if (composition === undefined) {
    return {
      result: { ok: false, directory: "", message: "nenhuma composição selecionada" },
    };
  }

  const planned = planResolutionFor(composition, options.scale, options.supersampling);
  if (!planned.ok) {
    return { result: { ok: false, directory: "", message: planned.message } };
  }
  const temporal = planMotionFor(options.motionBlur);
  if (!temporal.ok) {
    return { result: { ok: false, directory: "", message: temporal.message } };
  }
  const initialMapBlock = config.alpha ? null : mapExportBlockReason(options.map);
  if (initialMapBlock !== null) {
    return {
      result: {
        ok: false,
        directory: "",
        message: `export recusado porque o mapa não está íntegro: ${initialMapBlock}`,
      },
    };
  }

  editorActions.pause();

  const begin = await bridge.export.begin({
    jobName: `${composition.name}${config.jobSuffix}`,
    ...(config.staging ? { staging: true } : {}),
    ...(options.resume?.framesDirectory === undefined
      ? {}
      : { framesDirectory: options.resume.framesDirectory }),
    ...(options.resume?.directory !== undefined
      ? { directory: options.resume.directory }
      : options.directory === undefined
        ? {}
        : { directory: options.directory }),
  });
  if (!begin.ok) {
    return {
      result: { ok: false, directory: "", message: begin.message ?? "pasta não escolhida" },
    };
  }

  const framesDirectory = begin.framesDirectory ?? begin.directory;
  if (options.resume !== undefined && options.resume.completedFrames > 0) {
    if (options.resume.hashes.length !== options.resume.completedFrames) {
      return {
        result: {
          ok: false,
          directory: begin.directory,
          message: "checkpoint sem manifesto completo dos frames já renderizados",
        },
      };
    }
    const verified = await bridge.export.verifyFrames({
      directory: framesDirectory,
      frames: options.resume.hashes,
    });
    if (!verified.ok || verified.verified !== options.resume.completedFrames) {
      return {
        result: {
          ok: false,
          directory: begin.directory,
          message:
            verified.message ??
            `checkpoint incompleto: ${String(verified.verified)}/${String(options.resume.completedFrames)} frames verificados`,
        },
      };
    }
  }
  options.onOutputPrepared?.({
    directory: begin.directory,
    ...(begin.framesDirectory === undefined ? {} : { framesDirectory: begin.framesDirectory }),
  });
  const composer = new FrameComposer({
    includeMap: !config.alpha,
    size: { width: planned.resolution.output[0], height: planned.resolution.output[1] },
    renderSize: { width: planned.resolution.render[0], height: planned.resolution.render[1] },
    supersampling: planned.resolution.supersampling,
    lockMode: temporal.motionBlur.enabled,
  });
  const documentFingerprint = hashObject(state.document);
  const previewVariant = `export:${config.alpha ? "alpha" : "composite"}:${planned.resolution.supersampling}x:${options.outputFps ?? composition.fps}`;
  let currentOutputFrame = 0;
  const seekFrame = temporal.motionBlur.enabled
    ? (frame: number) => editorActions.setExportPlayhead(frame)
    : (frame: number) => editorActions.setPlayhead(frame);
  const host: ExportHost = {
    // O caminho desligado continua chamando o setter inteiro anterior. Só um job
    // realmente temporal recebe a exceção fracionária reservada ao export.
    seek: (frame, centerFrame) => {
      currentOutputFrame = centerFrame;
      seekFrame(frame);
    },
    observe: options.probe,
    // `isMoving` cobre animação de câmera; `areTilesLoaded` cobre o que ainda
    // está vindo do disco. Capturar com tile pendente grava o mapa pela
    // metade, e qual metade depende da velocidade do disco.
    mapBusy: () => !config.alpha && mapBusyForExport(options.map),
    // GLB em parse tem orçamento próprio no pump: pode legitimamente levar
    // mais que os 4 s do mapa sem autorizar tile/câmera presos por 30 s.
    assetsBusy: () => options.probe().pendingAssets > 0,
    // Superfície ainda a caminho do tamanho do frame conta como ocupada:
    // capturar aqui esticaria o overlay dentro do frame planejado.
    surfacesBusy: () => composer.surfacesResizing(),
    compose: () => composer.compose(),
    writeFrame: async (filename, frame) => {
      const mapBlock = config.alpha ? null : mapExportBlockReason(options.map);
      if (mapBlock !== null) {
        return {
          ok: false,
          sha256: "",
          message: `recurso do mapa falhou antes da escrita: ${mapBlock}`,
        };
      }
      const result = await bridge.export.frame({
        directory: framesDirectory,
        filename,
        width: frame.width,
        height: frame.height,
        rgba: frame.rgba,
      });
      if (result.ok) {
        cacheRenderedPreviewFrame({
          compositionId: composition.id,
          documentFingerprint,
          frame: currentOutputFrame,
          width: frame.width,
          height: frame.height,
          scale: planned.resolution.scale,
          variant: previewVariant,
          rgba: frame.rgba,
        });
      }
      return {
        ok: result.ok,
        sha256: result.sha256,
        ...(result.message === undefined ? {} : { message: result.message }),
      };
    },
  };
  const shouldAbort = (): boolean => {
    const current = getEditorSessionSnapshot();
    return (
      options.shouldAbort?.() === true ||
      current.selectedCompositionId !== composition.id ||
      current.document !== state.document
    );
  };

  try {
    // As superfícies vão ao tamanho da composição pela duração do export e voltam
    // em `finally`, dentro da transação (ADR-022). O pump inteiro roda lá dentro:
    // conduzir só o primeiro frame deixaria os seguintes no tamanho do painel.
    const report = await runWithSurfaceOverride(
      surfaceOverrideFor(planned.resolution),
      async () => {
        return runExport({
          plan: {
            compositionId: composition.id,
            durationFrames: composition.duration,
            compositionFps: composition.fps,
            ...(options.outputFps === undefined ? {} : { outputFps: options.outputFps }),
            ...(options.range === undefined ? {} : { range: options.range }),
            basename: composition.name,
          },
          host,
          motionBlur: temporal.motionBlur,
          ...(options.resume === undefined
            ? {}
            : {
                resumeFromOutputIndex: options.resume.completedFrames,
                resumeExpectedTotalFrames: options.resume.totalFrames,
                resumeFrameHashes: options.resume.hashes,
              }),
          ...(options.onCheckpoint === undefined ? {} : { onCheckpoint: options.onCheckpoint }),
          ...(options.settlePolicy === undefined ? {} : { settlePolicy: options.settlePolicy }),
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
          // O plano e o nome pertencem ao snapshot acima. Editar ou trocar a
          // composição no meio interrompe, em vez de misturar dois documentos.
          shouldAbort,
        });
      },
      { shouldAbort },
    );
    const finalMapBlock = config.alpha ? null : mapExportBlockReason(options.map);
    return {
      result: {
        ok:
          report.errors.length === 0 &&
          report.settleFailed === 0 &&
          !report.aborted &&
          finalMapBlock === null,
        directory: begin.directory,
        report,
        ...(finalMapBlock === null
          ? {}
          : {
              message: `export recusado porque o mapa não está íntegro: ${finalMapBlock}`,
            }),
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      },
      framesDirectory,
      framePrefix: sanitizeBasename(composition.name),
      digits: counterDigits(report.plan.frames.length),
      outputFps: report.plan.outputFps,
      compositionName: composition.name,
    };
  } catch (error: unknown) {
    return {
      result: {
        ok: false,
        directory: begin.directory,
        message: error instanceof Error ? error.message : String(error),
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      },
    };
  } finally {
    if (temporal.motionBlur.enabled) {
      // Exceção ou cancelamento nunca deixa uma fração vazando para autoria.
      editorActions.setPlayhead(Math.round(getEditorSessionSnapshot().playheadFrame));
    }
    composer.dispose();
  }
}

async function startFfmpegSequenceExport(
  options: StartExportOptions,
  format: FfmpegExportFormat,
): Promise<StartExportResult> {
  const rendered = await renderPngFrames(options, {
    alpha: format === "prores4444",
    staging: true,
    jobSuffix: format === "gif" ? " - GIF" : " - ProRes 4444",
  });
  const result = rendered.result;
  if (!result.ok || result.report?.aborted === true) return result;
  if (
    rendered.framesDirectory === undefined ||
    rendered.framePrefix === undefined ||
    rendered.digits === undefined ||
    rendered.outputFps === undefined ||
    rendered.compositionName === undefined
  ) {
    return { ...result, ok: false, message: "sequência temporária incompleta" };
  }

  const outputFilename = `${sanitizeBasename(rendered.compositionName)}.${
    format === "gif" ? "gif" : "mov"
  }`;
  options.onPhase?.("finalizing");
  const encoded = await bridge.export.encode({
    directory: result.directory,
    framesDirectory: rendered.framesDirectory,
    format,
    fps: rendered.outputFps,
    framePrefix: rendered.framePrefix,
    digits: rendered.digits,
    outputFilename,
  });
  return {
    ...result,
    ok: encoded.ok,
    ...(encoded.ok
      ? {
          videoFile: encoded.filename,
          videoBytes: encoded.bytes,
          fileSha256: encoded.sha256,
        }
      : {}),
    ...(encoded.message === undefined ? {} : { message: encoded.message }),
  };
}

/**
 * Export para arquivo **MP4 H.264**, no lugar de uma sequência de imagens.
 *
 * Reaproveita o mesmo pump e a mesma política de `settle` do export PNG — a parte
 * que carrega o determinismo. O que muda é o destino de cada frame: em vez de um
 * PNG por frame, os pixels vão para o `VideoEncoder` e os chunks codificados são
 * empacotados em MP4 fragmentado e anexados ao arquivo.
 *
 * O `writeFrame` do hospedeiro devolve hash vazio de propósito: aqui não há
 * arquivo por frame para hashear, e inventar um hash seria pior que não ter — o
 * relatório é lido por quem verifica o critério byte-idêntico, e um valor
 * fabricado ali passaria por prova.
 */
export async function startVideoExport(options: StartExportOptions): Promise<StartExportResult> {
  if (options.resume !== undefined && options.resume.completedFrames > 0) {
    return {
      ok: false,
      directory: options.resume.directory,
      message:
        "MP4 direto não pode continuar um fluxo H.264 interrompido; reinicie este job ou use PNG/GIF/ProRes com checkpoint.",
    };
  }
  if (!isVideoEncodingSupported()) {
    return { ok: false, directory: "", message: "WebCodecs indisponível nesta versão" };
  }
  const state = getEditorSessionSnapshot();
  const composition = state.document.compositions.find(
    (candidate) => candidate.id === state.selectedCompositionId,
  );
  if (composition === undefined) {
    return { ok: false, directory: "", message: "nenhuma composição selecionada" };
  }

  const planned = planResolutionFor(composition, options.scale, options.supersampling);
  if (!planned.ok) return { ok: false, directory: "", message: planned.message };
  const temporal = planMotionFor(options.motionBlur);
  if (!temporal.ok) return { ok: false, directory: "", message: temporal.message };
  const initialMapBlock = mapExportBlockReason(options.map);
  if (initialMapBlock !== null) {
    return {
      ok: false,
      directory: "",
      message: `export recusado porque o mapa não está íntegro: ${initialMapBlock}`,
    };
  }

  editorActions.pause();

  const begin = await bridge.export.begin({
    jobName: composition.name,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
  });
  if (!begin.ok) {
    return { ok: false, directory: "", message: begin.message ?? "pasta não escolhida" };
  }
  options.onOutputPrepared?.({ directory: begin.directory });

  const filename = `${sanitizeBasename(composition.name)}.mp4`;
  const temporaryFilename = `.theatrum-${globalThis.crypto.randomUUID()}-${filename}`;
  // O tamanho vem do plano, não da primeira superfície. Isto é o que faz a
  // dimensão par sair **por construção** em vez de sair do `evenSize()` do
  // encoder, que passa a ser a última guarda em vez da única defesa (ADR-022).
  const composer = new FrameComposer({
    size: { width: planned.resolution.output[0], height: planned.resolution.output[1] },
    renderSize: { width: planned.resolution.render[0], height: planned.resolution.render[1] },
    supersampling: planned.resolution.supersampling,
    lockMode: temporal.motionBlur.enabled,
  });
  // O primeiro frame define a resolução do arquivo, e ela não pode mudar no meio:
  // um MP4 declara largura e altura no cabeçalho, uma vez.
  //
  // Portador em vez de variável solta: a análise de fluxo do TypeScript não vê a
  // atribuição feita dentro do callback, e depois do `=== null` ela estreita a
  // variável para `never` — nenhum método existiria mais. Acesso por propriedade
  // não sofre disso.
  const encoder: { current: VideoEncodeSession | null } = { current: null };
  let firstWrite = true;
  const documentFingerprint = hashObject(state.document);
  const previewVariant = `export:mp4:${planned.resolution.supersampling}x:${options.outputFps ?? composition.fps}`;
  let currentOutputFrame = 0;
  const seekFrame = temporal.motionBlur.enabled
    ? (frame: number) => editorActions.setExportPlayhead(frame)
    : (frame: number) => editorActions.setPlayhead(frame);

  const appendBytes = async (bytes: Uint8Array): Promise<void> => {
    const result = await bridge.export.append({
      directory: begin.directory,
      filename: temporaryFilename,
      bytes,
      truncate: firstWrite,
    });
    firstWrite = false;
    if (!result.ok) throw new Error(result.message ?? "falha ao anexar ao arquivo");
  };

  let encoded = 0;
  const host: ExportHost = {
    seek: (frame, centerFrame) => {
      currentOutputFrame = centerFrame;
      seekFrame(frame);
    },
    observe: options.probe,
    // Mesma trinca do caminho PNG acima: câmera, tiles e GLB pendente.
    mapBusy: () => mapBusyForExport(options.map),
    assetsBusy: () => options.probe().pendingAssets > 0,
    // Superfície ainda a caminho do tamanho do frame conta como ocupada:
    // capturar aqui esticaria o overlay dentro do frame planejado.
    surfacesBusy: () => composer.surfacesResizing(),
    compose: () => composer.compose(),
    writeFrame: async (_name, frame: ComposedFrame) => {
      const mapBlock = mapExportBlockReason(options.map);
      if (mapBlock !== null) {
        return {
          ok: false,
          sha256: "",
          message: `recurso do mapa falhou antes da codificação: ${mapBlock}`,
        };
      }
      if (encoder.current === null) {
        encoder.current = createVideoEncodeSession({
          width: frame.width,
          height: frame.height,
          fps: options.outputFps ?? composition.fps,
          bitrate: Math.round(
            frame.width *
              frame.height *
              BITS_PER_PIXEL_PER_FRAME *
              (options.outputFps ?? composition.fps),
          ),
          write: appendBytes,
        });
      }
      await encoder.current.push(frame, encoded);
      cacheRenderedPreviewFrame({
        compositionId: composition.id,
        documentFingerprint,
        frame: currentOutputFrame,
        width: frame.width,
        height: frame.height,
        scale: planned.resolution.scale,
        variant: previewVariant,
        rgba: frame.rgba,
      });
      encoded += 1;
      return { ok: true, sha256: "" };
    },
  };
  const shouldAbort = (): boolean => {
    const current = getEditorSessionSnapshot();
    return (
      options.shouldAbort?.() === true ||
      current.selectedCompositionId !== composition.id ||
      current.document !== state.document
    );
  };
  const discardTemporary = async (): Promise<string> => {
    const discarded = await bridge.export.finalize({
      action: "discard",
      directory: begin.directory,
      temporaryFilename,
    });
    return (
      discarded.message ??
      (discarded.temporaryDisposition === "preserved"
        ? "O MP4 temporário foi preservado para diagnóstico."
        : "O MP4 temporário foi removido.")
    );
  };

  try {
    const report = await runWithSurfaceOverride(
      surfaceOverrideFor(planned.resolution),
      async () => {
        return runExport({
          plan: {
            compositionId: composition.id,
            durationFrames: composition.duration,
            compositionFps: composition.fps,
            ...(options.outputFps === undefined ? {} : { outputFps: options.outputFps }),
            ...(options.range === undefined ? {} : { range: options.range }),
            basename: composition.name,
          },
          host,
          motionBlur: temporal.motionBlur,
          ...(options.settlePolicy === undefined ? {} : { settlePolicy: options.settlePolicy }),
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
          shouldAbort,
        });
      },
      { shouldAbort },
    );

    const finalMapBlock = mapExportBlockReason(options.map);
    if (finalMapBlock !== null) {
      await encoder.current?.abort();
      const cleanupMessage = await discardTemporary();
      return {
        ok: false,
        directory: begin.directory,
        report,
        message: `export recusado porque o mapa não está íntegro: ${finalMapBlock}. ${cleanupMessage}`,
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      };
    }
    const reportIsClean =
      report.errors.length === 0 &&
      report.settleFailed === 0 &&
      !report.aborted &&
      !report.terminatedBySettle;
    if (!reportIsClean) {
      await encoder.current?.abort();
      const cleanupMessage = await discardTemporary();
      return {
        ok: false,
        directory: begin.directory,
        report,
        message: `${
          report.errors[0] ??
          (report.aborted ? "export interrompido" : "export recusado por settle")
        }. ${cleanupMessage}`,
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      };
    }
    if (encoder.current === null) {
      const cleanupMessage = await discardTemporary();
      return {
        ok: false,
        directory: begin.directory,
        report,
        message: `nenhum frame codificado. ${cleanupMessage}`,
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      };
    }
    options.onPhase?.("finalizing");
    const done = await encoder.current.finish();
    const incompleteReason = incompleteVideoReason(done, encoded);
    if (incompleteReason !== null) {
      const cleanupMessage = await discardTemporary();
      return {
        ok: false,
        directory: begin.directory,
        report,
        message: `${incompleteReason}. ${cleanupMessage}`,
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      };
    }
    const published = await bridge.export.finalize({
      action: "publish",
      directory: begin.directory,
      temporaryFilename,
      finalFilename: filename,
    });
    if (!published.ok) {
      return {
        ok: false,
        directory: begin.directory,
        report,
        message: published.message ?? "não foi possível publicar o MP4 final",
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      };
    }
    return {
      ok: true,
      directory: begin.directory,
      report,
      videoFile: published.filename,
      videoBytes: published.bytes,
      fileSha256: published.sha256,
      resolution: planned.resolution,
      boxReducedFrames: composer.boxReducedFrames,
    };
  } catch (error: unknown) {
    let abortMessage = "";
    try {
      await encoder.current?.abort();
    } catch (abortError: unknown) {
      abortMessage = ` Falha ao drenar escritas pendentes: ${
        abortError instanceof Error ? abortError.message : String(abortError)
      }`;
    }
    let cleanupMessage: string;
    try {
      cleanupMessage = await discardTemporary();
    } catch (cleanupError: unknown) {
      cleanupMessage = `Falha ao remover o MP4 temporário; ele pode ter sido preservado: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`;
    }
    return {
      ok: false,
      directory: begin.directory,
      message: `${error instanceof Error ? error.message : String(error)}${abortMessage} ${cleanupMessage}`,
      resolution: planned.resolution,
      boxReducedFrames: composer.boxReducedFrames,
    };
  } finally {
    if (temporal.motionBlur.enabled) {
      editorActions.setPlayhead(Math.round(getEditorSessionSnapshot().playheadFrame));
    }
    encoder.current?.close();
    composer.dispose();
  }
}
