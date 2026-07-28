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

import { sanitizeBasename } from "@theatrum/export";
import type { Map as MapLibreMap } from "maplibre-gl";
import { bridge } from "../bridge/index.js";
import { editorActions, getEditorSessionSnapshot } from "../document/editor-session.js";
import { FrameComposer, type ComposedFrame } from "./frame-composer.js";
import { runExport, type ExportProgress, type ExportReport } from "./run-export.js";
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
}

export interface StartExportOptions {
  readonly map: MapLibreMap;
  readonly probe: () => OverlayProbe;
  readonly onProgress?: (progress: ExportProgress) => void;
  readonly shouldAbort?: () => boolean;
  /** Trecho a exportar. Sem ele, a composição inteira. */
  readonly range?: { readonly first: number; readonly last: number };
  readonly outputFps?: number;
  /** Destino já conhecido; presente, o diálogo de pasta é pulado. */
  readonly directory?: string;
}

export interface StartExportResult {
  readonly ok: boolean;
  readonly directory: string;
  readonly report?: ExportReport;
  readonly message?: string;
  /** Nome do arquivo de vídeo, quando o export foi para MP4. */
  readonly videoFile?: string;
  readonly videoBytes?: number;
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
  const state = getEditorSessionSnapshot();
  const composition = state.document.compositions.find(
    (candidate) => candidate.id === state.selectedCompositionId,
  );
  if (composition === undefined) {
    return { ok: false, directory: "", message: "nenhuma composição selecionada" };
  }

  editorActions.pause();

  const begin = await bridge.export.begin({
    jobName: composition.name,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
  });
  if (!begin.ok) {
    return { ok: false, directory: "", message: begin.message ?? "pasta não escolhida" };
  }

  const composer = new FrameComposer();
  try {
    const report = await runExport({
      plan: {
        compositionId: composition.id,
        durationFrames: composition.duration,
        compositionFps: composition.fps,
        ...(options.outputFps === undefined ? {} : { outputFps: options.outputFps }),
        ...(options.range === undefined ? {} : { range: options.range }),
        basename: composition.name,
      },
      host: {
        seek: (frame) => editorActions.setPlayhead(frame),
        observe: options.probe,
        // `isMoving` cobre animação de câmera; `areTilesLoaded` cobre o que ainda
        // está vindo do disco. Capturar com tile pendente grava o mapa pela
        // metade, e qual metade depende da velocidade do disco.
        mapBusy: () => options.map.isMoving() || !options.map.areTilesLoaded(),
        compose: () => composer.compose(),
        writeFrame: async (filename, frame) => {
          const result = await bridge.export.frame({
            directory: begin.directory,
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
      },
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(options.shouldAbort === undefined ? {} : { shouldAbort: options.shouldAbort }),
    });
    return { ok: report.errors.length === 0, directory: begin.directory, report };
  } catch (error: unknown) {
    return {
      ok: false,
      directory: begin.directory,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    composer.dispose();
  }
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

  editorActions.pause();

  const begin = await bridge.export.begin({
    jobName: composition.name,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
  });
  if (!begin.ok) {
    return { ok: false, directory: "", message: begin.message ?? "pasta não escolhida" };
  }

  const filename = `${sanitizeBasename(composition.name)}.mp4`;
  const composer = new FrameComposer();
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

  try {
    let encoded = 0;
    const report = await runExport({
      plan: {
        compositionId: composition.id,
        durationFrames: composition.duration,
        compositionFps: composition.fps,
        ...(options.outputFps === undefined ? {} : { outputFps: options.outputFps }),
        ...(options.range === undefined ? {} : { range: options.range }),
        basename: composition.name,
      },
      host: {
        seek: (frame) => editorActions.setPlayhead(frame),
        observe: options.probe,
        mapBusy: () => options.map.isMoving() || !options.map.areTilesLoaded(),
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
      },
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(options.shouldAbort === undefined ? {} : { shouldAbort: options.shouldAbort }),
    });

    if (encoder.current === null) {
      return { ok: false, directory: begin.directory, report, message: "nenhum frame codificado" };
    }
    const done = await encoder.current.finish();
    return {
      ok: report.errors.length === 0 && done.frames > 0,
      directory: begin.directory,
      report,
      videoFile: filename,
      videoBytes: done.bytes,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      directory: begin.directory,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    encoder.current?.close();
    composer.dispose();
  }
}
