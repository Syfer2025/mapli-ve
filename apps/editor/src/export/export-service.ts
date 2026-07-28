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

import type { Map as MapLibreMap } from "maplibre-gl";
import { bridge } from "../bridge/index.js";
import { editorActions, getEditorSessionSnapshot } from "../document/editor-session.js";
import { FrameComposer } from "./frame-composer.js";
import { runExport, type ExportProgress, type ExportReport } from "./run-export.js";

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
