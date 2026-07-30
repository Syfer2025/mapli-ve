import type { AnimatableProperty, Node } from "@theatrum/schema";
import { parseProjectContainer, serializeProjectContainer } from "@theatrum/project-io";
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
  }, 15_000);

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

  it("edita e remove expressão pelo Command Bus com undo/redo", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const composition = session.getEditorSessionSnapshot().document.compositions[0];
    const root = composition?.nodes[composition.root];
    if (composition === undefined || root === undefined) throw new Error("Fixture sem raiz.");
    session.commandBus.history.clear();

    expect(
      session.editorActions.setPropertyExpression(root.id, "transform.opacity", "value / 0"),
    ).toBe(true);
    expect(
      session.getEditorSessionSnapshot().document.compositions[0]?.nodes[root.id]?.transform.opacity
        .expression,
    ).toBe("value / 0");
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual([
      "property.set-expression",
    ]);

    session.editorActions.undo();
    expect(
      session.getEditorSessionSnapshot().document.compositions[0]?.nodes[root.id]?.transform.opacity
        .expression,
    ).toBeNull();
    session.editorActions.redo();
    expect(
      session.getEditorSessionSnapshot().document.compositions[0]?.nodes[root.id]?.transform.opacity
        .expression,
    ).toBe("value / 0");

    expect(session.editorActions.setPropertyExpression(root.id, "transform.opacity", null)).toBe(
      true,
    );
    expect(
      session.getEditorSessionSnapshot().document.compositions[0]?.nodes[root.id]?.transform.opacity
        .expression,
    ).toBeNull();
    expect(session.editorActions.setPropertyExpression(root.id, "props.unknown", "value")).toBe(
      false,
    );
  });

  it("persiste estilo e consolida a câmera do mapa em comandos reversíveis", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const initial = session.getEditorSessionSnapshot().document;
    const composition = initial.compositions[0];
    if (composition === undefined) throw new Error("Fixture sem composição.");
    const initialMap = structuredClone(composition.map);
    const initialCamera = structuredClone(composition.camera);
    session.commandBus.history.clear();

    expect(session.editorActions.setMapStyle("detail:hormuz")).toBe(true);
    expect(session.getEditorSessionSnapshot().document.compositions[0]?.map.styleId).toBe(
      "detail:hormuz",
    );
    expect(session.commandBus.history.entries()).toHaveLength(1);
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual(["composition.set-map"]);
    session.editorActions.undo();
    expect(session.getEditorSessionSnapshot().document.compositions[0]?.map).toEqual(initialMap);

    expect(session.editorActions.setMapStyle("detail:hormuz")).toBe(true);
    session.commandBus.history.clear();
    expect(
      session.editorActions.setMapCamera({
        center: [56.25, 26.5],
        zoom: 7.25,
        bearing: 18,
        pitch: 42,
      }),
    ).toBe(true);
    const changed = session.getEditorSessionSnapshot().document.compositions[0]?.camera;
    expect(changed).toMatchObject({
      center: { value: [56.25, 26.5] },
      zoom: { value: 7.25 },
      bearing: { value: 18 },
      pitch: { value: 42 },
    });
    expect(session.commandBus.history.entries()).toHaveLength(1);
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual([
      "property.set",
      "property.set",
      "property.set",
      "property.set",
    ]);
    const serialized = serializeProjectContainer({
      document: session.getEditorSessionSnapshot().document,
    });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error(serialized.error.message);
    const reopened = parseProjectContainer(serialized.value);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.value.document.compositions[0]).toMatchObject({
      map: { styleId: "detail:hormuz" },
      camera: {
        center: { value: [56.25, 26.5] },
        zoom: { value: 7.25 },
        bearing: { value: 18 },
        pitch: { value: 42 },
      },
    });

    session.editorActions.undo();
    expect(session.getEditorSessionSnapshot().document.compositions[0]?.camera).toEqual(
      initialCamera,
    );
  });

  it("aplica preset de cena inteiro em uma única entrada reversível", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const before = structuredClone(session.getEditorSessionSnapshot().document);
    session.commandBus.history.clear();

    expect(
      session.editorActions.applyScenePreset({
        name: "Hormuz",
        mapStyle: "detail:iran-hormuz",
        palette: {
          id: "hormuz",
          name: "Hormuz",
          colors: { ocean: "#163647", route: "#d49a58" },
        },
        camera: {
          center: [56.3, 26.5],
          zoom: 7.2,
          bearing: -18,
          pitch: 42,
        },
      }),
    ).toBe(true);

    const changed = session.getEditorSessionSnapshot().document;
    expect(changed.palettes).toContainEqual(expect.objectContaining({ id: "hormuz" }));
    expect(changed.compositions[0]).toMatchObject({
      map: { styleId: "detail:iran-hormuz" },
      camera: {
        center: { value: [56.3, 26.5] },
        zoom: { value: 7.2 },
        bearing: { value: -18 },
        pitch: { value: 42 },
      },
    });
    expect(session.commandBus.history.entries()).toHaveLength(1);
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual([
      "palette.add",
      "composition.set-map",
      "property.set",
      "property.set",
      "property.set",
      "property.set",
    ]);

    session.editorActions.undo();
    expect(session.getEditorSessionSnapshot().document).toEqual(before);
  });

  it("persiste áudio de referência pelo Command Bus com undo", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const src = "assets/ab/narracao.wav";
    expect(
      session.editorActions.dispatch({
        type: "asset.add",
        payload: {
          asset: {
            id: "ast_audio",
            kind: "audio",
            src,
            meta: { name: "Narração" },
          },
        },
        source: "user",
      }),
    ).toBe(true);
    session.commandBus.history.clear();

    expect(session.editorActions.setReferenceAudio(src, 12.4)).toBe(true);
    expect(session.getEditorSessionSnapshot().document.compositions[0]?.referenceAudio).toEqual({
      assetSrc: src,
      startFrame: 12,
    });
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual([
      "composition.set-reference-audio",
    ]);

    session.editorActions.undo();
    expect(session.getEditorSessionSnapshot().document.compositions[0]?.referenceAudio).toBeNull();
    expect(session.editorActions.setReferenceAudio("assets/ab/ausente.wav")).toBe(false);

    session.editorActions.redo();
    expect(session.editorActions.removeAsset("ast_audio")).toBe(true);
    expect(session.getEditorSessionSnapshot().document.assets).toEqual([]);
    expect(session.getEditorSessionSnapshot().document.compositions[0]?.referenceAudio).toBeNull();
  });

  it("gesto de câmera preserva animação e grava o keyframe no playhead", async () => {
    vi.resetModules();
    const session = await import("./editor-session.js");
    const composition = session.getEditorSessionSnapshot().document.compositions[0];
    if (composition === undefined) throw new Error("Fixture sem composição.");
    expect(
      session.editorActions.dispatch({
        type: "keyframe.set",
        payload: {
          compositionId: composition.id,
          target: { kind: "camera" },
          path: ["zoom"],
          keyframe: {
            id: "kf_zoom_existing",
            frame: 0,
            value: 2,
            in: { kind: "linear" },
            out: { kind: "linear" },
          },
        },
        source: "user",
      }),
    ).toBe(true);
    session.editorActions.setPlayhead(12);
    session.commandBus.history.clear();

    expect(
      session.editorActions.setMapCamera({
        center: [54, 25],
        zoom: 8,
        bearing: 30,
        pitch: 50,
      }),
    ).toBe(true);
    const camera = session.getEditorSessionSnapshot().document.compositions[0]?.camera;
    expect(camera?.zoom.keyframes).toEqual([
      expect.objectContaining({ id: "kf_zoom_existing", frame: 0, value: 2 }),
      expect.objectContaining({ frame: 12, value: 8 }),
    ]);
    expect(session.commandBus.history.entries()).toHaveLength(1);
    expect(session.commandBus.history.entries()[0]?.commandTypes).toEqual([
      "property.set",
      "keyframe.set",
      "property.set",
      "property.set",
    ]);

    session.editorActions.undo();
    expect(
      session.getEditorSessionSnapshot().document.compositions[0]?.camera.zoom.keyframes,
    ).toEqual([expect.objectContaining({ id: "kf_zoom_existing", frame: 0, value: 2 })]);
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
