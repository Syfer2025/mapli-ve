import { afterEach, describe, expect, it, vi } from "vitest";
import type { DockviewActivePanelChangeEvent, DockviewApi, IDockviewPanel } from "dockview-react";
import {
  acceptWorkspaceContentPanel,
  bindWorkspaceContentMode,
  getWorkspaceContentMode,
  inferWorkspaceContentMode,
  setWorkspaceContentMode,
  subscribeWorkspaceContentMode,
} from "./workspace-content-mode.js";

afterEach(() => {
  setWorkspaceContentMode("map");
});

describe("WorkspaceContentMode", () => {
  it("muda só com Viewport ou Palco e preserva o contexto ao focar painéis auxiliares", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceContentMode(listener);

    expect(acceptWorkspaceContentPanel("studio")).toBe(true);
    expect(getWorkspaceContentMode()).toBe("studio");
    expect(listener).toHaveBeenCalledTimes(1);

    expect(acceptWorkspaceContentPanel("timeline")).toBe(false);
    expect(acceptWorkspaceContentPanel("inspector")).toBe(false);
    expect(getWorkspaceContentMode()).toBe("studio");
    expect(listener).toHaveBeenCalledTimes(1);

    expect(acceptWorkspaceContentPanel("viewport")).toBe(true);
    expect(getWorkspaceContentMode()).toBe("map");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("infere a aba ativa do grupo compartilhado mesmo quando a Timeline tem foco global", () => {
    const group = groupWith("studio");
    const api = apiWith({
      viewport: panel("viewport", group),
      studio: panel("studio", group),
      activePanel: panel("timeline", groupWith("timeline")),
    });

    expect(inferWorkspaceContentMode(api)).toBe("studio");
  });

  it("cai para Mapa quando as superfícies foram separadas e o foco global é ambíguo", () => {
    const api = apiWith({
      viewport: panel("viewport", groupWith("viewport")),
      studio: panel("studio", groupWith("studio")),
      activePanel: panel("timeline", groupWith("timeline")),
    });

    expect(inferWorkspaceContentMode(api)).toBe("map");
  });

  it("assina ativações de usuário e API e deixa de reagir depois do dispose", () => {
    const group = groupWith("viewport");
    const callbackRef: {
      current: ((event: DockviewActivePanelChangeEvent) => void) | null;
    } = { current: null };
    const dispose = vi.fn();
    const api = apiWith({
      viewport: panel("viewport", group),
      studio: panel("studio", group),
      activePanel: panel("timeline", groupWith("timeline")),
      onDidActivePanelChange: (listener) => {
        callbackRef.current = listener;
        return { dispose };
      },
    });

    const binding = bindWorkspaceContentMode(api);
    expect(getWorkspaceContentMode()).toBe("map");

    callbackRef.current?.({ panel: panel("studio", group), origin: "api" });
    expect(getWorkspaceContentMode()).toBe("studio");
    callbackRef.current?.({
      panel: panel("inspector", groupWith("inspector")),
      origin: "user",
    });
    expect(getWorkspaceContentMode()).toBe("studio");

    binding.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

interface FakeGroup {
  activePanel: IDockviewPanel | undefined;
}

function groupWith(activeId: string): FakeGroup {
  const group: FakeGroup = { activePanel: undefined };
  group.activePanel = panel(activeId, group);
  return group;
}

function panel(id: string, group: FakeGroup): IDockviewPanel {
  return { id, group } as unknown as IDockviewPanel;
}

function apiWith(options: {
  readonly viewport: IDockviewPanel;
  readonly studio: IDockviewPanel;
  readonly activePanel: IDockviewPanel;
  readonly onDidActivePanelChange?: DockviewApi["onDidActivePanelChange"];
}): Pick<DockviewApi, "activePanel" | "getPanel" | "onDidActivePanelChange"> {
  const panels = new Map([
    ["viewport", options.viewport],
    ["studio", options.studio],
  ]);
  return {
    activePanel: options.activePanel,
    getPanel: (id) => panels.get(id),
    onDidActivePanelChange:
      options.onDidActivePanelChange ??
      (() => ({
        dispose() {
          // Sem evento neste fake.
        },
      })),
  };
}
