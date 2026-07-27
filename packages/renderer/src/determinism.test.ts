import { MAT2D_IDENTITY } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import {
  RenderableRegistry,
  circleVisual,
  createDataRenderableFactory,
  createHeadlessRenderBackend,
  createPixiRenderBackend,
  createRenderer,
  createScreenScene,
  evaluateBuiltinVisual,
  registerBuiltinRenderables,
  type HeadlessBackendSnapshot,
  type NodeLayout,
  type ScreenNode,
  type ScreenScene,
} from "./index.js";

const LAYOUT: NodeLayout = {
  matrix: MAT2D_IDENTITY,
  size: [40, 40],
  opacity: 0.75,
  visible: true,
  blendMode: "normal",
};

describe("determinismo e extensibilidade", () => {
  it("frame direto e sequência longa chegam à mesma árvore retida", async () => {
    const direct = await renderDirect(500);
    const sequential = await renderSequential(500);
    expect(sequential).toEqual(direct);
  });

  it("avalia visual como função pura e não altera os dados recebidos", () => {
    const props = Object.freeze({
      text: "Kursk",
      color: "#abcdef",
      fontSize: 22,
    });
    const node = Object.freeze({
      id: "label",
      type: "text.label",
      slot: "scene" as const,
      props,
      layout: LAYOUT,
    });
    const before = JSON.stringify(node);

    const first = evaluateBuiltinVisual("text.label", node);
    const second = evaluateBuiltinVisual("text.label", node);

    expect(second).toEqual(first);
    expect(JSON.stringify(node)).toBe(before);

    expect(
      evaluateBuiltinVisual("shape.polygon", {
        ...node,
        type: "shape.polygon",
        props: {
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          fill: "#3b82f680",
        },
      }),
    ).toMatchObject({
      kind: "polygon",
      fill: "#3b82f6",
      fillAlpha: 128 / 255,
    });
  });

  it("renderiza shape.circle apenas com o registro dos builtins", async () => {
    const registry = new RenderableRegistry();
    registerBuiltinRenderables(registry);
    const backend = createHeadlessRenderBackend();
    const renderer = createRenderer({ backend, registry });
    await renderer.init({ overlay: {} });

    renderer.render(toScene(12, circleNode("shape.circle")), ["scene"]);

    expect(registry.list()).toContain("shape.circle");
    expect(backend.snapshot().slots[0]?.nodes[0]?.visual).toEqual({
      kind: "circle",
      radius: 17,
      fill: "#ff0000",
      fillAlpha: 0.5,
      stroke: "#dbeafe",
      strokeWidth: 2,
    });
  });

  it("aceita tipo de fora do pacote somente por registro de factory", async () => {
    const registry = new RenderableRegistry();
    registerBuiltinRenderables(registry);
    const backend = createHeadlessRenderBackend();
    const renderer = createRenderer({ backend, registry });
    await renderer.init({ overlay: {} });

    const ring = circleNode("plugin.ring");
    expect(() => renderer.render(toScene(12, ring), ["scene"])).toThrow(
      /Nenhuma factory registrada/,
    );

    const registration = registry.register(
      "plugin.ring",
      createDataRenderableFactory(circleVisual),
    );
    renderer.render(toScene(12, ring), ["scene"]);
    expect(registry.list()).toContain("plugin.ring");
    expect(backend.snapshot().slots[0]?.nodes[0]?.visual).toMatchObject({
      kind: "circle",
      radius: 17,
    });

    registration.dispose();
    renderer.invalidate([ring.id]);
    expect(() => renderer.render(toScene(12, ring), ["scene"])).toThrow(
      /Nenhuma factory registrada/,
    );
  });

  it("mantém Pixi sob demanda e oferece fallback Node sem DOM", async () => {
    const pixi = createPixiRenderBackend();
    expect(pixi.kind).toBe("webgl2");
    await expect(pixi.init({ overlay: {} })).rejects.toThrow(/superfície canvas/);

    const headless = createHeadlessRenderBackend();
    await expect(headless.init({ overlay: {} })).resolves.toBeUndefined();
  });

  it("combina evaluate + layout de forma pura e atribui slots por dados", () => {
    const evaluated = {
      frame: 7,
      nodes: new Map([
        [
          "title",
          {
            id: "title",
            type: "text.title",
            props: { text: "Operação" },
            opacity: 0.8,
            visible: true,
          },
        ],
        [
          "unit",
          {
            id: "unit",
            type: "unit.armor",
            props: { callsign: "A-1" },
            opacity: 1,
            visible: true,
          },
        ],
      ]),
      drawOrder: ["unit", "title"],
    };
    const laidOut = {
      frame: 7,
      layouts: new Map([
        ["title", { matrix: MAT2D_IDENTITY, sizePx: [400, 90] as const, culled: false }],
        ["unit", { matrix: MAT2D_IDENTITY, sizePx: [32, 32] as const, culled: true }],
      ]),
      drawOrder: ["unit", "title"],
    };

    const screen = createScreenScene(evaluated, laidOut, {
      size: [1280, 720],
      pixelRatio: 2,
    });

    expect(screen.nodes.get("title")).toMatchObject({
      slot: "above-all",
      layout: { opacity: 0.8, visible: true },
    });
    expect(screen.nodes.get("unit")).toMatchObject({
      slot: "scene",
      layout: { visible: false },
    });
    expect(evaluated.drawOrder).toEqual(["unit", "title"]);
  });

  it("blend e recorte atravessam a ponte; ausência não cria campo", () => {
    const evaluated = {
      frame: 3,
      nodes: new Map([
        [
          "alvo",
          {
            id: "alvo",
            type: "shape.circle",
            props: {},
            opacity: 1,
            visible: true,
            blendMode: "add",
            trackMatte: { source: "recorte", mode: "luma-inverted" as const },
          },
        ],
        ["recorte", { id: "recorte", type: "shape.circle", props: {}, opacity: 1, visible: true }],
      ]),
      drawOrder: ["alvo", "recorte"],
    };
    const laidOut = {
      frame: 3,
      layouts: new Map([
        ["alvo", { matrix: MAT2D_IDENTITY, sizePx: [10, 10] as const, culled: false }],
        ["recorte", { matrix: MAT2D_IDENTITY, sizePx: [10, 10] as const, culled: false }],
      ]),
      drawOrder: ["alvo", "recorte"],
    };

    const screen = createScreenScene(evaluated, laidOut, { size: [640, 480], pixelRatio: 1 });
    expect(screen.nodes.get("alvo")?.layout.blendMode).toBe("add");
    expect(screen.nodes.get("alvo")?.layout.matte).toEqual({
      source: "recorte",
      mode: "luma-inverted",
    });
    // Sem recorte o campo nem aparece: o backend distingue "não pediu" de "pediu
    // nada", e um `matte: undefined` explícito faria a máscara ser remontada.
    expect("matte" in (screen.nodes.get("recorte")?.layout ?? {})).toBe(false);
    expect(screen.nodes.get("recorte")?.layout.blendMode).toBe("normal");
  });
});

async function renderDirect(frame: number): Promise<HeadlessBackendSnapshot> {
  const registry = new RenderableRegistry();
  registerBuiltinRenderables(registry);
  const backend = createHeadlessRenderBackend();
  const renderer = createRenderer({ backend, registry });
  await renderer.init({ overlay: {} });
  renderer.render(toScene(frame, lineNode(frame)), ["scene"]);
  return backend.snapshot();
}

async function renderSequential(frame: number): Promise<HeadlessBackendSnapshot> {
  const registry = new RenderableRegistry();
  registerBuiltinRenderables(registry);
  const backend = createHeadlessRenderBackend();
  const renderer = createRenderer({ backend, registry });
  await renderer.init({ overlay: {} });
  for (let current = 0; current <= frame; current += 1) {
    renderer.render(toScene(current, lineNode(current)), ["scene"]);
  }
  return backend.snapshot();
}

function circleNode(type: string): ScreenNode {
  return {
    id: "circle",
    type,
    slot: "scene",
    props: { radius: 17, fill: "#ff0000", fillAlpha: 0.5 },
    layout: LAYOUT,
  };
}

function lineNode(frame: number): ScreenNode {
  return {
    id: "line",
    type: "shape.line",
    slot: "scene",
    props: {
      points: [
        [0, 0],
        [frame, frame / 2],
      ],
      color: "#ffffff",
      width: 2,
    },
    layout: {
      ...LAYOUT,
      matrix: [1, 0, 0, 1, frame, frame / 3],
    },
  };
}

function toScene(frame: number, node: ScreenNode): ScreenScene {
  return {
    frame,
    size: [1920, 1080],
    pixelRatio: 1,
    nodes: new Map([[node.id, node]]),
    drawOrder: [node.id],
  };
}
