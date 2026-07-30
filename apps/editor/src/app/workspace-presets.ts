import type { DockviewApi } from "dockview-react";
import { applyDefaultLayout } from "./default-layout.js";

export const WORKSPACE_PRESETS = [
  {
    id: "editing",
    label: "Edição",
    description: "Arranjo equilibrado com Timeline, Projeto e Inspector.",
    activePanel: "timeline",
    projectWidth: 0.16,
    inspectorWidth: 0.19,
    timelineHeight: 0.34,
  },
  {
    id: "map-focus",
    label: "Mapa em foco",
    description: "Mapa maior e painéis auxiliares compactos.",
    activePanel: "viewport",
    projectWidth: 0.12,
    inspectorWidth: 0.15,
    timelineHeight: 0.22,
  },
  {
    id: "animation",
    label: "Animação",
    description: "Faixa inferior ampla com o editor de curvas ativo.",
    activePanel: "graph",
    projectWidth: 0.14,
    inspectorWidth: 0.18,
    timelineHeight: 0.52,
  },
  {
    id: "studio",
    label: "Palco 3D",
    description: "Palco ativo com fila de render acessível na faixa inferior.",
    activePanel: "studio",
    projectWidth: 0.13,
    inspectorWidth: 0.17,
    timelineHeight: 0.28,
  },
] as const;

export type WorkspacePreset = (typeof WORKSPACE_PRESETS)[number];
export type WorkspacePresetId = WorkspacePreset["id"];
export type WorkspacePresetSelectionId = WorkspacePresetId | "custom";

export type ApplyWorkspacePresetResult =
  | { readonly ok: true; readonly presetId: WorkspacePresetId }
  | {
      readonly ok: false;
      readonly presetId: WorkspacePresetId;
      readonly recoveredWith: "previous" | "default" | "none";
      readonly message: string;
    };

const PRESET_IDS = new Set<string>(WORKSPACE_PRESETS.map((preset) => preset.id));

export function isWorkspacePresetId(value: unknown): value is WorkspacePresetId {
  return typeof value === "string" && PRESET_IDS.has(value);
}

export function isWorkspacePresetSelectionId(value: unknown): value is WorkspacePresetSelectionId {
  return value === "custom" || isWorkspacePresetId(value);
}

/**
 * Aplica um preset sem aceitar a janela vazia como estado intermediário final.
 *
 * Dockview não oferece transação. O snapshot anterior funciona como rollback;
 * o default é a última linha de defesa quando a própria serialização ficou
 * incompatível.
 */
export function applyWorkspacePresetSafely(
  api: DockviewApi,
  presetId: WorkspacePresetId,
): ApplyWorkspacePresetResult {
  let previous: unknown;
  try {
    previous = api.toJSON();
  } catch (error: unknown) {
    return failure(presetId, "none", error);
  }

  try {
    api.clear();
    applyWorkspacePreset(api, presetId);
    return Object.freeze({ ok: true, presetId });
  } catch (error: unknown) {
    try {
      api.clear();
      api.fromJSON(previous as never);
      return failure(presetId, "previous", error);
    } catch {
      try {
        api.clear();
        applyDefaultLayout(api);
        return failure(presetId, "default", error);
      } catch {
        return failure(presetId, "none", error);
      }
    }
  }
}

export function applyWorkspacePreset(api: DockviewApi, presetId: WorkspacePresetId): void {
  const preset = WORKSPACE_PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) throw new RangeError(`preset de workspace desconhecido: ${presetId}`);
  applyDefaultLayout(api);
  sizePanel(api, "project", "width", api.width * preset.projectWidth);
  sizePanel(api, "inspector", "width", api.width * preset.inspectorWidth);
  sizePanel(api, "timeline", "height", api.height * preset.timelineHeight);
  api.getPanel(preset.activePanel)?.api.setActive();
}

function sizePanel(
  api: DockviewApi,
  panelId: string,
  dimension: "width" | "height",
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) return;
  api.getPanel(panelId)?.api.setSize({ [dimension]: Math.round(value) });
}

function failure(
  presetId: WorkspacePresetId,
  recoveredWith: "previous" | "default" | "none",
  error: unknown,
): ApplyWorkspacePresetResult {
  return Object.freeze({
    ok: false,
    presetId,
    recoveredWith,
    message: error instanceof Error ? error.message : String(error),
  });
}
