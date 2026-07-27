import { mat2d, type Rect, type Vec2 } from "@theatrum/core-math";
import { createEmptyProjectDocument, type Anchor } from "@theatrum/schema";
import { describe, expect, it, vi } from "vitest";
import type { EvaluatedNodeLike, EvaluatedSceneLike, ProjectorPortLike } from "./contracts.js";
import { SceneGraphInvariantError } from "./errors.js";
import {
  layoutNode,
  layoutScene,
  localMatrix,
  resolveAnchor,
  resolveRotation,
  resolveSize,
  worldMatrix,
} from "./layout.js";

interface Snapshot {
  readonly id: string;
  readonly viewport: Vec2;
}

function projector(
  overrides: Partial<ProjectorPortLike<Snapshot>> = {},
): ProjectorPortLike<Snapshot> {
  return {
    project([lng, lat], altitude = 0) {
      return [lng * 10, lat * -10 - altitude / 10];
    },
    unproject([x, y]) {
      return [x / 10, y / -10];
    },
    metersPerPixel() {
      return 2;
    },
    bearingToScreenAngle(bearing) {
      return bearing - 30;
    },
    elevationAt() {
      return 100;
    },
    snapshot() {
      return Object.freeze({ id: "projector", viewport: [1920, 1080] as const });
    },
    ...overrides,
  };
}

function node(id: string, overrides: Partial<EvaluatedNodeLike> = {}): EvaluatedNodeLike {
  return {
    id,
    type: "symbol.icon",
    parent: null,
    anchor: { space: "comp", position: [0, 0] },
    size: { mode: "screen", size: [20, 10] },
    transform: {
      position: [0, 0],
      rotation: 0,
      scale: [1, 1],
      opacity: 1,
      anchorPoint: [0, 0],
      skew: [0, 0],
      rotationReference: "screen",
    },
    props: {},
    opacity: 1,
    visible: true,
    ...overrides,
  };
}

function scene(
  nodes: readonly EvaluatedNodeLike[],
  drawOrder?: readonly string[],
): EvaluatedSceneLike {
  return {
    frame: 42,
    nodes: new Map(nodes.map((item) => [item.id, item])),
    drawOrder: drawOrder ?? nodes.map((item) => item.id),
  };
}

describe("anchor and size resolution", () => {
  it("projeta anchor geo incluindo terreno e altitude acima dele", () => {
    const port = projector({ project: vi.fn(projector().project) });
    const anchor: Anchor = { space: "geo", lngLat: [36.19, 51.74], altitude: 800 };
    expect(resolveAnchor(anchor, port)).toEqual([361.9, -607.4]);
    expect(port.project).toHaveBeenCalledWith(anchor.lngLat, 900);
  });

  it("resolve comp pela matriz opcional e mantém parent no espaço local", () => {
    const port = projector();
    expect(
      resolveAnchor({ space: "comp", position: [10, 20] }, port, {
        compToScreen: mat2d.scaling(2, 3),
      }),
    ).toEqual([20, 60]);
    expect(
      resolveAnchor({ space: "parent", offset: [10, 20] }, port, {
        compToScreen: mat2d.scaling(9, 9),
      }),
    ).toEqual([10, 20]);
  });

  it("mantém tamanho screen e converte metros dividindo por metersPerPixel", () => {
    const port = projector();
    expect(resolveSize({ mode: "screen", size: [64, 32] }, port, [0, 50])).toEqual([64, 32]);
    expect(resolveSize({ mode: "ground", meters: [1000, 500] }, port, [0, 50])).toEqual([500, 250]);
  });

  it("rejeita tamanhos negativos e escala cartográfica inválida", () => {
    expect(() => resolveSize({ mode: "screen", size: [-1, 10] }, projector(), [0, 0])).toThrow(
      /negativo/i,
    );
    expect(() =>
      resolveSize(
        { mode: "ground", meters: [10, 10] },
        projector({ metersPerPixel: () => 0 }),
        [0, 0],
      ),
    ).toThrow(/metersPerPixel/i);
  });

  it("obtém latitude por unproject para tamanho ground em espaço comp", () => {
    const unproject = vi.fn(() => [20, 45] as const);
    const metersPerPixel = vi.fn(() => 4);
    const groundComp = node("nd_ground_comp", {
      anchor: { space: "comp", position: [300, 200] },
      size: { mode: "ground", meters: [80, 40] },
    });
    expect(
      layoutNode(scene([groundComp]), groundComp.id, projector({ unproject, metersPerPixel }))
        .sizePx,
    ).toEqual([20, 10]);
    expect(unproject).toHaveBeenCalledWith([300, 200]);
    expect(metersPerPixel).toHaveBeenCalledWith(45);
  });

  it("converte bearing geográfico e preserva rotação de tela", () => {
    const port = projector();
    expect(resolveRotation(90, "geo-bearing", port)).toBe(60);
    expect(resolveRotation(90, "screen", port)).toBe(90);
    expect(() =>
      resolveRotation(10, "geo-bearing", projector({ bearingToScreenAngle: () => Infinity })),
    ).toThrow(/rotação/i);
  });

  it("rejeita saída não finita do projector", () => {
    expect(() =>
      resolveAnchor(
        { space: "geo", lngLat: [0, 0] },
        projector({ project: () => [Number.NaN, 0] }),
      ),
    ).toThrow(SceneGraphInvariantError);
  });
});

describe("local and world transforms", () => {
  it("aplica anchorPoint normalizado, offset e escala na ordem documentada", () => {
    const item = node("nd_item", {
      anchor: { space: "comp", position: [100, 50] },
      size: { mode: "screen", size: [20, 10] },
      transform: {
        position: [5, -5],
        rotation: 0,
        scale: [2, 3],
        opacity: 1,
        anchorPoint: [0.5, 0.5],
        skew: [0, 0],
        rotationReference: "screen",
      },
    });
    const matrix = localMatrix(item, projector());
    expect(mat2d.applyPoint(matrix, [10, 5])).toEqual([105, 45]);
    expect(mat2d.applyPoint(matrix, [0, 0])).toEqual([85, 30]);
  });

  it("multiplica parent antes do filho e resolve offset no espaço do pai", () => {
    const root = node("nd_root", {
      anchor: { space: "comp", position: [100, 50] },
      size: { mode: "screen", size: [0, 0] },
    });
    const child = node("nd_child", {
      parent: root.id,
      anchor: { space: "parent", offset: [20, 10] },
      size: { mode: "screen", size: [0, 0] },
    });
    const evaluated = scene([root, child]);
    expect(mat2d.applyPoint(worldMatrix(evaluated, child.id, projector()), [0, 0])).toEqual([
      120, 60,
    ]);
  });

  it("herda rotação e escala do pai de forma determinística", () => {
    const root = node("nd_root", {
      size: { mode: "screen", size: [0, 0] },
      transform: {
        ...node("base").transform,
        rotation: 90,
        scale: [2, 2],
      },
    });
    const child = node("nd_child", {
      parent: root.id,
      anchor: { space: "parent", offset: [10, 0] },
      size: { mode: "screen", size: [0, 0] },
    });
    const point = mat2d.applyPoint(
      worldMatrix(scene([root, child]), child.id, projector()),
      [0, 0],
    );
    expect(point[0]).toBeCloseTo(0, 10);
    expect(point[1]).toBeCloseTo(20, 10);
  });

  it("detecta parent ausente e ciclo em cena avaliada", () => {
    const missing = node("nd_missing", { parent: "nd_absent" });
    expect(() => worldMatrix(scene([missing]), missing.id, projector())).toThrow(/não encontrado/i);

    const left = node("nd_left", { parent: "nd_right" });
    const right = node("nd_right", { parent: "nd_left" });
    expect(() => worldMatrix(scene([left, right]), left.id, projector())).toThrow(/ciclo/i);
  });

  it("rejeita matriz não finita antes que chegue ao renderer", () => {
    const invalid = node("nd_invalid", {
      transform: {
        ...node("base").transform,
        scale: [Number.MAX_VALUE, 1],
        skew: [0, 89],
      },
    });
    expect(() => localMatrix(invalid, projector())).toThrow(/matriz/i);
  });
});

describe("screen layout", () => {
  it("calcula bounds pelo retângulo transformado e o anchor final", () => {
    const item = node("nd_item", {
      anchor: { space: "comp", position: [100, 50] },
      transform: {
        ...node("base").transform,
        anchorPoint: [0.5, 0.5],
      },
    });
    const layout = layoutNode(scene([item]), item.id, projector());
    expect(layout.anchorPx).toEqual([100, 50]);
    expect(layout.bounds).toEqual({ x: 90, y: 45, width: 20, height: 10 });
    expect(layout.culled).toBe(false);
  });

  it("marca invisível ou fora do viewport como culled", () => {
    const viewport: Rect = { x: 0, y: 0, width: 200, height: 100 };
    const hidden = node("nd_hidden", { visible: false });
    const outside = node("nd_outside", {
      anchor: { space: "comp", position: [500, 500] },
    });
    expect(layoutNode(scene([hidden]), hidden.id, projector(), { viewport }).culled).toBe(true);
    expect(layoutNode(scene([outside]), outside.id, projector(), { viewport }).culled).toBe(true);
  });

  it("mantém título comp independente da câmera/projeção", () => {
    const title = node("nd_title", {
      type: "text.title",
      anchor: { space: "comp", position: [960, 80] },
    });
    const first = layoutNode(scene([title]), title.id, projector({ project: () => [0, 0] }));
    const second = layoutNode(
      scene([title]),
      title.id,
      projector({ project: () => [9999, -9999] }),
    );
    expect(second).toEqual(first);
  });

  it("mantém unidade geo com tamanho screen constante e norte corrigido", () => {
    const tank = node("nd_tank", {
      type: "unit.armor",
      anchor: { space: "geo", lngLat: [36.19, 51.74] },
      size: { mode: "screen", size: [64, 64] },
      transform: {
        ...node("base").transform,
        rotation: 0,
        rotationReference: "geo-bearing",
        anchorPoint: [0.5, 0.5],
      },
    });
    const firstPort = projector({
      project: () => [500, 400],
      bearingToScreenAngle: (bearing) => bearing,
    });
    const secondPort = projector({
      project: () => [700, 100],
      bearingToScreenAngle: (bearing) => bearing - 45,
    });
    const first = layoutNode(scene([tank]), tank.id, firstPort);
    const second = layoutNode(scene([tank]), tank.id, secondPort);
    expect(first.anchorPx).toEqual([500, 400]);
    expect(second.anchorPx).toEqual([700, 100]);
    expect(first.sizePx).toEqual([64, 64]);
    expect(second.sizePx).toEqual([64, 64]);
    expect(mat2d.decompose(first.matrix).rotation).toBeCloseTo(0, 10);
    expect(mat2d.decompose(second.matrix).rotation).toBeCloseTo(-45, 10);
  });

  it("mantém root real identity e não aplica compToScreen duas vezes em filho geo", () => {
    const document = createEmptyProjectDocument();
    const composition = document.compositions[0];
    if (composition === undefined) throw new Error("fixture sem composição");
    const sourceRoot = composition.nodes[composition.root];
    if (sourceRoot === undefined) throw new Error("fixture sem raiz");

    const root = node(sourceRoot.id, {
      type: sourceRoot.type,
      anchor: sourceRoot.anchor,
      size: sourceRoot.size,
    });
    const tank = node("nd_tank", {
      type: "unit.armor",
      parent: root.id,
      anchor: { space: "geo", lngLat: [36.19, 51.74] },
      size: { mode: "screen", size: [64, 64] },
    });
    const title = node("nd_title", {
      type: "text.title",
      parent: root.id,
      anchor: { space: "comp", position: [100, 100] },
      size: { mode: "screen", size: [300, 80] },
    });
    const compToScreen = mat2d.scaling(1.5, 0.75);
    const laidOut = layoutScene(
      scene([root, tank, title]),
      projector({ project: () => [700, 350], elevationAt: () => null }),
      { compToScreen },
    );
    const rootLayout = laidOut.layouts.get(root.id);
    const tankLayout = laidOut.layouts.get(tank.id);
    const titleLayout = laidOut.layouts.get(title.id);
    expect(rootLayout === undefined ? false : mat2d.isIdentity(rootLayout.matrix)).toBe(true);
    expect(tankLayout?.anchorPx).toEqual([700, 350]);
    expect(tankLayout?.sizePx).toEqual([64, 64]);
    expect(titleLayout?.anchorPx).toEqual([150, 75]);
    expect(titleLayout?.sizePx).toEqual([300, 80]);
  });

  it("usa latitude geo para tamanho ground e groundReference para comp", () => {
    const meterSpy = vi.fn(() => 5);
    const ground = node("nd_ground", {
      anchor: { space: "geo", lngLat: [12, 34] },
      size: { mode: "ground", meters: [100, 50] },
    });
    expect(
      layoutNode(scene([ground]), ground.id, projector({ metersPerPixel: meterSpy })).sizePx,
    ).toEqual([20, 10]);
    expect(meterSpy).toHaveBeenCalledWith(34);

    const comp = node("nd_comp", {
      size: { mode: "ground", meters: [100, 50] },
    });
    layoutNode(scene([comp]), comp.id, projector({ metersPerPixel: meterSpy }), {
      groundReference: [20, 60],
    });
    expect(meterSpy).toHaveBeenLastCalledWith(60);
  });

  it("produz ScreenScene estável e snapshot explícito", () => {
    const back = node("nd_back");
    const front = node("nd_front", {
      anchor: { space: "comp", position: [50, 0] },
    });
    const first = layoutScene(scene([front, back], ["nd_back", "nd_front"]), projector());
    const second = layoutScene(scene([back, front], ["nd_back", "nd_front"]), projector());
    expect(first.frame).toBe(42);
    expect(first.projector).toEqual({ id: "projector", viewport: [1920, 1080] });
    expect([...first.layouts]).toEqual([...second.layouts]);
    expect(first.drawOrder).toEqual(["nd_back", "nd_front"]);
  });

  it("rejeita drawOrder duplicado, ausente ou com id inexistente", () => {
    const item = node("nd_item");
    expect(() => layoutScene(scene([item], []), projector())).toThrow(/não contém/i);
    expect(() => layoutScene(scene([item], [item.id, item.id]), projector())).toThrow(/duplicado/i);
    expect(() => layoutScene(scene([item], ["nd_absent"]), projector())).toThrow(/inexistente/i);
  });
});
