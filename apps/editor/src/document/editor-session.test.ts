import type { AnimatableProperty, Node } from "@theatrum/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hadWindow = "window" in globalThis;
const previousWindow = globalThis.window;
const hadDocument = "document" in globalThis;
const previousDocument = globalThis.document;

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      confirm: () => true,
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: { title: "" },
    configurable: true,
  });
});

afterAll(() => {
  if (hadWindow) {
    Object.defineProperty(globalThis, "window", {
      value: previousWindow,
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
  if (hadDocument) {
    Object.defineProperty(globalThis, "document", {
      value: previousDocument,
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
});

describe("compatibilidade de propriedades opcionais na sessão", () => {
  it("reserva frame fracionário ao seek de export e mantém o scrub inteiro", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const duration = session.getEditorSessionSnapshot().document.compositions[0]?.duration ?? 1;

    session.editorActions.setPlayhead(12.25);
    expect(session.getEditorSessionSnapshot().playheadFrame).toBe(12);

    session.editorActions.setExportPlayhead(12.25);
    expect(session.getEditorSessionSnapshot().playheadFrame).toBe(12.25);

    session.editorActions.setExportPlayhead(duration + 0.75);
    expect(session.getEditorSessionSnapshot().playheadFrame).toBe(duration - 1);
  });

  it("materializa o fallback do schema ao editar ou criar o primeiro keyframe", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const initial = session.getEditorSessionSnapshot().document;
    const composition = initial.compositions[0];
    const root = composition?.nodes[composition.root];
    if (composition === undefined || root === undefined) throw new Error("Fixture sem raiz.");

    const props = session.nodeTypeRegistry.createDefaultProps("studio.stage");
    delete props["reflectionStrength"];
    const stageId = "nd_legacy_stage";
    const stage: Node = {
      ...structuredClone(root),
      id: stageId,
      type: "studio.stage",
      name: "Palco antigo",
      parent: root.id,
      children: [],
      props,
    };
    expect(
      session.editorActions.dispatch({
        type: "node.create",
        payload: {
          compositionId: composition.id,
          parentId: root.id,
          node: stage,
        },
        source: "user",
      }),
    ).toBe(true);
    session.editorActions.selectNode(composition.id, stageId);
    session.commandBus.history.clear();

    expect(session.editorActions.setPropertyValue(stageId, "props.reflectionStrenght", 0.9)).toBe(
      false,
    );
    expect(session.commandBus.history.entries()).toHaveLength(0);

    expect(
      session.editorActions.setPropertyValue(stageId, "props.reflectionStrength", 0.65, false),
    ).toBe(true);
    expect(reflectionProperty(session.getEditorSessionSnapshot().document, stageId)).toMatchObject({
      value: 0.65,
      keyframes: [],
      expression: null,
    });
    expect(session.commandBus.history.entries()).toHaveLength(1);
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual(["property.initialize"]);

    session.editorActions.undo();
    expect(
      reflectionProperty(session.getEditorSessionSnapshot().document, stageId),
    ).toBeUndefined();

    session.editorActions.setPlayhead(12);
    expect(session.editorActions.togglePropertyKeyframe(stageId, "props.reflectionStrength")).toBe(
      true,
    );
    expect(reflectionProperty(session.getEditorSessionSnapshot().document, stageId)).toMatchObject({
      value: 0,
      keyframes: [{ frame: 12, value: 0 }],
      expression: null,
    });
    expect(session.commandBus.history.entries()).toHaveLength(1);
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual([
      "property.initialize",
      "keyframe.set",
    ]);

    session.editorActions.undo();
    expect(
      reflectionProperty(session.getEditorSessionSnapshot().document, stageId),
    ).toBeUndefined();
  });
});

function reflectionProperty(
  document: {
    readonly compositions: readonly { readonly nodes: Readonly<Record<string, Node>> }[];
  },
  nodeId: string,
): AnimatableProperty<number> | undefined {
  return document.compositions[0]?.nodes[nodeId]?.props["reflectionStrength"] as
    AnimatableProperty<number> | undefined;
}
