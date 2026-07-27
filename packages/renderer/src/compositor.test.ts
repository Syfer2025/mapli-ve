import { MAT2D_IDENTITY } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import {
  EXPORT_SLOT_ORDER,
  PREVIEW_SLOT_ORDER,
  RenderableRegistry,
  RendererError,
  createCompositor,
  createHeadlessRenderBackend,
  createRenderer,
  registerBuiltinRenderables,
  type NodeLayout,
  type ScreenNode,
  type ScreenScene,
} from "./index.js";

const LAYOUT: NodeLayout = {
  matrix: MAT2D_IDENTITY,
  size: [64, 64],
  opacity: 1,
  visible: true,
  blendMode: "normal",
};

describe("compositor de slots", () => {
  it("expõe alvos estáveis e rejeita slot duplicado", async () => {
    const backend = createHeadlessRenderBackend();
    await backend.init({ overlay: {} });
    const compositor = createCompositor(backend);

    expect(compositor.slot("scene")).toBe(compositor.slot("scene"));
    expect(() => compositor.composite(["scene", "scene"])).toThrowError(RendererError);
  });

  it("preserva drawOrder dentro de cada slot e a ordem explícita dos slots", async () => {
    const backend = createHeadlessRenderBackend();
    const registry = new RenderableRegistry();
    registerBuiltinRenderables(registry);
    const renderer = createRenderer({ backend, registry });
    await renderer.init({ overlay: {} });

    const nodes = new Map<string, ScreenNode>([
      ["hud", node("hud", "text.title", "ui-overlay")],
      ["unit-b", node("unit-b", "unit.armor", "scene")],
      ["title", node("title", "text.title", "above-all")],
      ["unit-a", node("unit-a", "unit.infantry", "scene")],
    ]);
    const scene: ScreenScene = {
      frame: 0,
      size: [800, 450],
      pixelRatio: 2,
      nodes,
      drawOrder: ["hud", "unit-b", "title", "unit-a"],
    };

    renderer.render(scene, PREVIEW_SLOT_ORDER);
    const preview = backend.snapshot();

    expect(preview.compositeOrder).toEqual(PREVIEW_SLOT_ORDER);
    expect(preview.slots.map((slot) => slot.id)).toEqual(PREVIEW_SLOT_ORDER);
    expect(preview.slots.find((slot) => slot.id === "scene")?.nodes.map((item) => item.id)).toEqual(
      ["unit-b", "unit-a"],
    );

    const capture = await renderer.capture(EXPORT_SLOT_ORDER);
    const exported = backend.snapshot();
    expect(exported.compositeOrder).toEqual(EXPORT_SLOT_ORDER);
    expect(exported.slots.some((slot) => slot.id === "ui-overlay")).toBe(false);
    expect(capture).toMatchObject({
      width: 1600,
      height: 900,
      pixelRatio: 2,
      encoding: "command-buffer",
    });
  });
});

function node(id: string, type: string, slot: ScreenNode["slot"]): ScreenNode {
  return {
    id,
    type,
    name: id,
    slot,
    props: {},
    layout: LAYOUT,
  };
}
