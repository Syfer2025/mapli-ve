import { describe, expect, it } from "vitest";
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import {
  WORKSPACE_PRESETS,
  applyWorkspacePreset,
  applyWorkspacePresetSafely,
  isWorkspacePresetSelectionId,
} from "./workspace-presets.js";

const EXPECTED_PANEL_IDS = [
  "actions",
  "effects",
  "graph",
  "history",
  "inspector",
  "library",
  "project",
  "render-queue",
  "studio",
  "timeline",
  "viewport",
];

describe("presets de workspace", () => {
  it("monta todos os painéis em cada preset e ativa a superfície esperada", () => {
    for (const preset of WORKSPACE_PRESETS) {
      const fake = fakeDockview();
      applyWorkspacePreset(fake.api, preset.id);
      expect([...fake.panels.keys()].sort()).toEqual(EXPECTED_PANEL_IDS);
      expect(fake.activePanelId).toBe(preset.activePanel);
      expect(fake.sizes.get("timeline")?.height).toBe(
        Math.round(fake.api.height * preset.timelineHeight),
      );
    }
  });

  it("restaura o snapshot anterior quando a montagem falha", () => {
    const previous = { grid: { root: "anterior" } };
    const fake = fakeDockview({ previous, failAddAfter: 2 });
    const result = applyWorkspacePresetSafely(fake.api, "animation");

    expect(result).toMatchObject({
      ok: false,
      presetId: "animation",
      recoveredWith: "previous",
    });
    expect(fake.restored).toEqual(previous);
  });

  it("reconhece apenas presets e o estado personalizado", () => {
    expect(isWorkspacePresetSelectionId("editing")).toBe(true);
    expect(isWorkspacePresetSelectionId("custom")).toBe(true);
    expect(isWorkspacePresetSelectionId("desconhecido")).toBe(false);
  });
});

interface FakeDockviewOptions {
  readonly previous?: unknown;
  readonly failAddAfter?: number;
}

function fakeDockview(options: FakeDockviewOptions = {}): {
  readonly api: DockviewApi;
  readonly panels: Map<string, IDockviewPanel>;
  readonly sizes: Map<string, { width?: number; height?: number }>;
  readonly activePanelId: string | null;
  readonly restored: unknown;
} {
  const panels = new Map<string, IDockviewPanel>();
  const sizes = new Map<string, { width?: number; height?: number }>();
  let addCount = 0;
  let activePanelId: string | null = null;
  let restored: unknown = null;
  const fakeOptions = options;
  const api = {
    width: 1_200,
    height: 800,
    addPanel(options: { id: string }) {
      addCount += 1;
      if (options.id === "" || addCount === (fakeOptions.failAddAfter ?? -1)) {
        throw new Error("falha simulada");
      }
      const panel = {
        id: options.id,
        api: {
          setActive() {
            activePanelId = options.id;
          },
          setSize(size: { width?: number; height?: number }) {
            sizes.set(options.id, size);
          },
        },
      } as unknown as IDockviewPanel;
      panels.set(options.id, panel);
      return panel;
    },
    getPanel(id: string) {
      return panels.get(id);
    },
    clear() {
      panels.clear();
    },
    toJSON() {
      return fakeOptions.previous ?? { grid: { root: "atual" } };
    },
    fromJSON(value: unknown) {
      restored = value;
    },
  } as unknown as DockviewApi;
  return {
    api,
    panels,
    sizes,
    get activePanelId() {
      return activePanelId;
    },
    get restored() {
      return restored;
    },
  };
}
