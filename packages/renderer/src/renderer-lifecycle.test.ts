import { MAT2D_IDENTITY } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import {
  RenderableRegistry,
  createDataRenderableFactory,
  createHeadlessRenderBackend,
  createRenderer,
  type NodeLayout,
  type RenderContext,
  type Renderable,
  type ScreenNode,
  type ScreenScene,
} from "./index.js";

const LAYOUT: NodeLayout = {
  matrix: MAT2D_IDENTITY,
  size: [10, 10],
  opacity: 1,
  visible: true,
  blendMode: "normal",
};

describe("lifecycle de renderables", () => {
  it("monta uma vez, atualiza, recicla por tipo e desmonta recursos", async () => {
    const events: string[] = [];
    const registry = new RenderableRegistry();
    registry.register("test.a", trackedFactory("a", events));
    registry.register("test.b", trackedFactory("b", events));

    const backend = createHeadlessRenderBackend();
    const renderer = createRenderer({ backend, registry });
    await renderer.init({ overlay: {} });

    renderer.render(scene([node("one", "test.a"), node("two", "test.a")]), ["scene"]);
    renderer.render(scene([node("two", "test.a")]), ["scene"]);
    renderer.render(scene([node("two", "test.b")]), ["scene"]);
    renderer.invalidate(["two", "two"]);
    renderer.render(scene([node("two", "test.b")]), ["scene"]);
    renderer.dispose();
    renderer.dispose();

    expect(events).toEqual([
      "mount:a:one",
      "update:a:one",
      "mount:a:two",
      "update:a:two",
      "update:a:two",
      "unmount:a:one",
      "unmount:a:two",
      "mount:b:two",
      "update:b:two",
      "unmount:b:two",
      "mount:b:two",
      "update:b:two",
      "unmount:b:two",
    ]);
    expect(backend.events().filter((event) => event.kind === "dispose")).toHaveLength(1);
  });

  it("impõe a ordem mount → update → unmount no adaptador de dados", () => {
    const factory = createDataRenderableFactory(() => ({ kind: "none" }));
    const first = factory();
    expect(() => first.update(node("one", "data"), LAYOUT)).toThrow(/antes de mount/);

    const context: RenderContext = { nodeId: "one", submit() {} };
    first.mount(context);
    expect(() => first.mount(context)).toThrow(/duas vezes/);
    first.update(node("one", "data"), LAYOUT);
    first.unmount();
    expect(() => first.unmount()).toThrow(/sem mount/);
  });
});

function trackedFactory(label: string, events: string[]): () => Renderable {
  return () => {
    let context: RenderContext | undefined;
    return {
      mount(nextContext) {
        context = nextContext;
        events.push(`mount:${label}:${nextContext.nodeId}`);
      },
      update(node, layout) {
        events.push(`update:${label}:${node.id}`);
        context?.submit({ kind: "none" }, layout);
      },
      unmount() {
        events.push(`unmount:${label}:${context?.nodeId ?? "missing"}`);
        context = undefined;
      },
    };
  };
}

function node(id: string, type: string): ScreenNode {
  return { id, type, slot: "scene", props: {}, layout: LAYOUT };
}

function scene(nodes: readonly ScreenNode[]): ScreenScene {
  return {
    frame: 0,
    size: [100, 100],
    pixelRatio: 1,
    nodes: new Map(nodes.map((item) => [item.id, item])),
    drawOrder: nodes.map((item) => item.id),
  };
}
