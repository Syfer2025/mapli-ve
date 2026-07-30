import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProjectDocument, type ProjectDocument } from "@theatrum/schema";
import { installMaestroControl } from "./codex-control.js";

describe("ponte local do Maestro", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declara que o Maestro é o ChatGPT/Codex e não exige chave", () => {
    vi.stubGlobal("window", {});
    const fixture = createFixture();
    const control = installMaestroControl(fixture.ports);

    expect(control.capabilities()).toEqual({
      mode: "chatgpt-codex",
      embeddedModel: false,
      apiKeyRequired: false,
      sceneScript: true,
      commandBus: true,
      undoRedo: true,
    });
    expect(control.getSummary()).toMatchObject({
      connected: true,
      mode: "chatgpt-codex",
      revision: 0,
      project: { name: "Sem título" },
    });
  });

  it("devolve diagnósticos sem mutar quando o Scene Script é inválido", async () => {
    vi.stubGlobal("window", {});
    const fixture = createFixture();
    const control = installMaestroControl(fixture.ports);

    const result = await control.applyScene({});

    expect(result.ok).toBe(false);
    expect(result.revision).toBe(0);
    expect(result.diagnostics?.map((entry) => entry.path)).toEqual([
      "/format",
      "/meta",
      "/timeline",
      "/version",
    ]);
    expect(fixture.applySceneScript).not.toHaveBeenCalled();
  });

  it("encaminha lotes ao Command Bus e expõe undo", () => {
    vi.stubGlobal("window", {});
    const fixture = createFixture();
    const control = installMaestroControl(fixture.ports);

    const applied = control.applyCommands({
      label: "Renomear projeto",
      commands: [{ type: "project.rename", payload: { name: "Operação" } }],
    });

    expect(applied).toMatchObject({ ok: true, revision: 1 });
    expect(fixture.applyCommands).toHaveBeenCalledOnce();
    expect(control.undo()).toMatchObject({ ok: true, revision: 2 });
    expect(control.getSummary().history.canRedo).toBe(true);
  });
});

function createFixture() {
  let document: ProjectDocument = createEmptyProjectDocument();
  let revision = 0;
  let cursor = -1;
  const entries = [{ label: "Maestro · Renomear projeto" }];

  const getSnapshot = () => ({
    document,
    revision,
    dirty: revision > 0,
    status: "Pronto",
    error: null,
    selectedCompositionId: document.compositions[0]?.id ?? "",
    selectedNodeId: null,
    selectedNodeIds: [],
    playheadFrame: 0,
    isPlaying: false,
    ready: true,
    history: {
      entries: cursor < 0 ? [] : entries,
      cursor,
      canUndo: cursor >= 0,
      canRedo: cursor < entries.length - 1,
    },
  });

  const applySceneScript = vi.fn((nextDocument: ProjectDocument) => {
    document = nextDocument;
    revision += 1;
    cursor = 0;
    return true;
  });
  const applyCommands = vi.fn(() => {
    revision += 1;
    cursor = 0;
    return { ok: true, message: "1 comando aplicado." };
  });

  return {
    applySceneScript,
    applyCommands,
    ports: {
      initialize: () => Promise.resolve(),
      getSnapshot,
      applySceneScript,
      applyCommands,
      setPlayhead: () => undefined,
      undo: () => {
        if (cursor < 0) return;
        cursor -= 1;
        revision += 1;
      },
      redo: () => {
        if (cursor >= entries.length - 1) return;
        cursor += 1;
        revision += 1;
      },
    },
  };
}
