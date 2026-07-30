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
import type { Composition } from "@theatrum/schema";
import type { Map as MapLibreMap } from "maplibre-gl";
import { bridge } from "../bridge/index.js";
import { editorActions, getEditorSessionSnapshot } from "../document/editor-session.js";
import { FrameComposer, type ComposedFrame } from "./frame-composer.js";
import {
  runExport,
  type ExportHost,
  type ExportProgress,
  type ExportReport,
} from "./run-export.js";
import { runWithSurfaceOverride } from "./surface-override.js";
import {
  createVideoEncodeSession,
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
 * A ordem importa: `planExportResolution` **recusa** acima do teto de 4096 px por
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

  editorActions.pause();

  const begin = await bridge.export.begin({
    jobName: `${composition.name}${config.jobSuffix}`,
    ...(config.staging ? { staging: true } : {}),
    ...(options.directory === undefined ? {} : { directory: options.directory }),
  });
  if (!begin.ok) {
    return {
      result: { ok: false, directory: "", message: begin.message ?? "pasta não escolhida" },
    };
  }

  const framesDirectory = begin.framesDirectory ?? begin.directory;
  const composer = new FrameComposer({
    includeMap: !config.alpha,
    size: { width: planned.resolution.output[0], height: planned.resolution.output[1] },
    renderSize: { width: planned.resolution.render[0], height: planned.resolution.render[1] },
    supersampling: planned.resolution.supersampling,
    lockMode: temporal.motionBlur.enabled,
  });
  const host: ExportHost = {
    // O caminho desligado continua chamando o setter inteiro anterior. Só um job
    // realmente temporal recebe a exceção fracionária reservada ao export.
    seek: temporal.motionBlur.enabled
      ? (frame) => editorActions.setExportPlayhead(frame)
      : (frame) => editorActions.setPlayhead(frame),
    observe: options.probe,
    // `isMoving` cobre animação de câmera; `areTilesLoaded` cobre o que ainda
    // está vindo do disco. Capturar com tile pendente grava o mapa pela
    // metade, e qual metade depende da velocidade do disco.
    mapBusy: () =>
      options.map !== undefined && (options.map.isMoving() || !options.map.areTilesLoaded()),
    // GLB em parse tem orçamento próprio no pump: pode legitimamente levar
    // mais que os 4 s do mapa sem autorizar tile/câmera presos por 30 s.
    assetsBusy: () => options.probe().pendingAssets > 0,
    // Superfície ainda a caminho do tamanho do frame conta como ocupada:
    // capturar aqui esticaria o overlay dentro do frame planejado.
    surfacesBusy: () => composer.surfacesResizing(),
    compose: () => composer.compose(),
    writeFrame: async (filename, frame) => {
      const result = await bridge.export.frame({
        directory: framesDirectory,
        filename,
        width: frame.width,
        height: frame.height,
        rgba: frame.rgba,
      });
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
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
          // O plano e o nome pertencem ao snapshot acima. Editar ou trocar a
          // composição no meio interrompe, em vez de misturar dois documentos.
          shouldAbort,
        });
      },
      { shouldAbort },
    );
    return {
      result: {
        ok: report.errors.length === 0 && report.settleFailed === 0 && !report.aborted,
        directory: begin.directory,
        report,
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

  editorActions.pause();

  const begin = await bridge.export.begin({
    jobName: composition.name,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
  });
  if (!begin.ok) {
    return { ok: false, directory: "", message: begin.message ?? "pasta não escolhida" };
  }

  const filename = `${sanitizeBasename(composition.name)}.mp4`;
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

  const appendBytes = async (bytes: Uint8Array): Promise<void> => {
    const result = await bridge.export.append({
      directory: begin.directory,
      filename,
      bytes,
      truncate: firstWrite,
    });
    firstWrite = false;
    if (!result.ok) throw new Error(result.message ?? "falha ao anexar ao arquivo");
  };

  let encoded = 0;
  const host: ExportHost = {
    seek: temporal.motionBlur.enabled
      ? (frame) => editorActions.setExportPlayhead(frame)
      : (frame) => editorActions.setPlayhead(frame),
    observe: options.probe,
    // Mesma trinca do caminho PNG acima: câmera, tiles e GLB pendente.
    mapBusy: () =>
      options.map !== undefined && (options.map.isMoving() || !options.map.areTilesLoaded()),
    assetsBusy: () => options.probe().pendingAssets > 0,
    // Superfície ainda a caminho do tamanho do frame conta como ocupada:
    // capturar aqui esticaria o overlay dentro do frame planejado.
    surfacesBusy: () => composer.surfacesResizing(),
    compose: () => composer.compose(),
    writeFrame: async (_name, frame: ComposedFrame) => {
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
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
          shouldAbort,
        });
      },
      { shouldAbort },
    );

    if (encoder.current === null) {
      return {
        ok: false,
        directory: begin.directory,
        report,
        message: "nenhum frame codificado",
        resolution: planned.resolution,
        boxReducedFrames: composer.boxReducedFrames,
      };
    }
    options.onPhase?.("finalizing");
    const done = await encoder.current.finish();
    return {
      ok:
        report.errors.length === 0 &&
        report.settleFailed === 0 &&
        !report.aborted &&
        done.frames > 0,
      directory: begin.directory,
      report,
      videoFile: filename,
      videoBytes: done.bytes,
      resolution: planned.resolution,
      boxReducedFrames: composer.boxReducedFrames,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      directory: begin.directory,
      message: error instanceof Error ? error.message : String(error),
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
