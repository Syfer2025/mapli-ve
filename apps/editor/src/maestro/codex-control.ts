import { exportDocumentToSceneScript, type SceneDiagnostic } from "@theatrum/scripting";
import type { ProjectDocument } from "@theatrum/schema";
import { compileScene } from "../scripting/scene-script-import.js";

interface MaestroSnapshot {
  readonly document: ProjectDocument;
  readonly revision: number;
  readonly dirty: boolean;
  readonly status: string;
  readonly error: string | null;
  readonly selectedCompositionId: string;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly playheadFrame: number;
  readonly isPlaying: boolean;
  readonly ready: boolean;
  readonly history: {
    readonly entries: readonly { readonly label: string }[];
    readonly cursor: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
  };
}

interface MaestroControlPorts {
  readonly initialize: () => Promise<void>;
  readonly getSnapshot: () => MaestroSnapshot;
  readonly applySceneScript: (document: ProjectDocument) => boolean;
  readonly applyCommands: (
    label: string,
    commands: readonly unknown[],
  ) => { readonly ok: boolean; readonly message: string };
  readonly setPlayhead: (frame: number) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

export interface MaestroSummary {
  readonly connected: true;
  readonly mode: "chatgpt-codex";
  readonly ready: boolean;
  readonly revision: number;
  readonly dirty: boolean;
  readonly status: string;
  readonly error: string | null;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly compositions: number;
    readonly assets: number;
    readonly paths: number;
  };
  readonly activeComposition: {
    readonly id: string;
    readonly name: string;
    readonly fps: number;
    readonly durationFrames: number;
    readonly resolution: readonly [number, number];
    readonly nodeCount: number;
    readonly mapStyle: string;
  } | null;
  readonly selection: {
    readonly compositionId: string;
    readonly nodeId: string | null;
    readonly nodeIds: readonly string[];
    readonly playheadFrame: number;
    readonly isPlaying: boolean;
  };
  readonly history: {
    readonly entries: number;
    readonly cursor: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly lastLabel: string | null;
  };
}

export interface MaestroMutationResult {
  readonly ok: boolean;
  readonly message: string;
  readonly diagnostics?: readonly SceneDiagnostic[];
  readonly revision: number;
  readonly status: string;
}

export interface TheatrumMaestroControl {
  readonly capabilities: () => {
    readonly mode: "chatgpt-codex";
    readonly embeddedModel: false;
    readonly apiKeyRequired: false;
    readonly sceneScript: true;
    readonly commandBus: true;
    readonly undoRedo: true;
  };
  readonly getSummary: () => MaestroSummary;
  readonly getContext: () => {
    readonly summary: MaestroSummary;
    readonly document: ProjectDocument;
    readonly sceneScript: ReturnType<typeof exportDocumentToSceneScript>["scene"];
    readonly diagnostics: readonly SceneDiagnostic[];
  };
  readonly applyScene: (input: unknown) => Promise<MaestroMutationResult>;
  readonly applyCommands: (input: unknown) => MaestroMutationResult;
  readonly setFrame: (frame: unknown) => MaestroSummary;
  readonly undo: () => MaestroMutationResult;
  readonly redo: () => MaestroMutationResult;
}

export function installMaestroControl(ports: MaestroControlPorts): TheatrumMaestroControl {
  const control: TheatrumMaestroControl = Object.freeze({
    capabilities: () =>
      Object.freeze({
        mode: "chatgpt-codex" as const,
        embeddedModel: false as const,
        apiKeyRequired: false as const,
        sceneScript: true as const,
        commandBus: true as const,
        undoRedo: true as const,
      }),

    getSummary: () => summarize(ports.getSnapshot()),

    getContext: () => {
      const current = ports.getSnapshot();
      const exported = exportDocumentToSceneScript(current.document);
      return Object.freeze({
        summary: summarize(current),
        document: current.document,
        sceneScript: exported.scene,
        diagnostics: exported.diagnostics,
      });
    },

    applyScene: async (input: unknown) => {
      await ports.initialize();
      const compiled = await compileScene(input);
      if (!compiled.ok) {
        const current = ports.getSnapshot();
        return Object.freeze({
          ok: false,
          message: "Scene Script rejeitado; o projeto não foi alterado.",
          diagnostics: compiled.diagnostics,
          revision: current.revision,
          status: current.status,
        });
      }

      const applied = ports.applySceneScript(compiled.document);
      const current = ports.getSnapshot();
      return Object.freeze({
        ok: applied,
        message: applied
          ? "Cena compilada e aplicada como uma única operação."
          : (current.error ?? "O editor rejeitou o documento compilado."),
        diagnostics: compiled.diagnostics,
        revision: current.revision,
        status: current.status,
      });
    },

    applyCommands: (input: unknown) => {
      if (!isCommandBatch(input)) {
        const current = ports.getSnapshot();
        return Object.freeze({
          ok: false,
          message: "Esperado { label: string, commands: array }.",
          revision: current.revision,
          status: current.status,
        });
      }
      const result = ports.applyCommands(input.label, input.commands);
      const current = ports.getSnapshot();
      return Object.freeze({
        ...result,
        revision: current.revision,
        status: current.status,
      });
    },

    setFrame: (frame: unknown) => {
      if (typeof frame !== "number" || !Number.isFinite(frame) || frame < 0) {
        throw new RangeError("O frame precisa ser um número finito não negativo.");
      }
      ports.setPlayhead(Math.round(frame));
      return summarize(ports.getSnapshot());
    },

    undo: () => moveHistory("undo", ports),
    redo: () => moveHistory("redo", ports),
  });

  Object.defineProperty(window, "__theatrumMaestro", {
    value: control,
    configurable: true,
  });
  return control;
}

function summarize(current: MaestroSnapshot): MaestroSummary {
  const composition =
    current.document.compositions.find(
      (candidate) => candidate.id === current.selectedCompositionId,
    ) ?? current.document.compositions[0];
  const appliedEntries = current.history.entries.slice(0, current.history.cursor + 1);
  return Object.freeze({
    connected: true,
    mode: "chatgpt-codex",
    ready: current.ready,
    revision: current.revision,
    dirty: current.dirty,
    status: current.status,
    error: current.error,
    project: Object.freeze({
      id: current.document.id,
      name: current.document.name,
      compositions: current.document.compositions.length,
      assets: current.document.assets.length,
      paths: Object.keys(current.document.paths).length,
    }),
    activeComposition:
      composition === undefined
        ? null
        : Object.freeze({
            id: composition.id,
            name: composition.name,
            fps: composition.fps,
            durationFrames: composition.duration,
            resolution: Object.freeze([composition.width, composition.height] as const),
            nodeCount: Object.keys(composition.nodes).length,
            mapStyle: composition.map.styleId,
          }),
    selection: Object.freeze({
      compositionId: current.selectedCompositionId,
      nodeId: current.selectedNodeId,
      nodeIds: current.selectedNodeIds,
      playheadFrame: current.playheadFrame,
      isPlaying: current.isPlaying,
    }),
    history: Object.freeze({
      entries: current.history.entries.length,
      cursor: current.history.cursor,
      canUndo: current.history.canUndo,
      canRedo: current.history.canRedo,
      lastLabel: appliedEntries.at(-1)?.label ?? null,
    }),
  });
}

function isCommandBatch(
  input: unknown,
): input is { readonly label: string; readonly commands: readonly unknown[] } {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof Reflect.get(input, "label") === "string" &&
    Array.isArray(Reflect.get(input, "commands"))
  );
}

function moveHistory(
  direction: "undo" | "redo",
  ports: MaestroControlPorts,
): MaestroMutationResult {
  const before = ports.getSnapshot();
  ports[direction]();
  const current = ports.getSnapshot();
  const moved = current.history.cursor !== before.history.cursor;
  return Object.freeze({
    ok: moved,
    message: moved
      ? direction === "undo"
        ? "Última operação desfeita."
        : "Última operação refeita."
      : direction === "undo"
        ? "Não há operação para desfazer."
        : "Não há operação para refazer.",
    revision: current.revision,
    status: current.status,
  });
}

declare global {
  interface Window {
    __theatrumMaestro?: TheatrumMaestroControl;
  }
}
