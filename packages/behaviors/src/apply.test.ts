import { evaluate } from "@theatrum/animation";
import {
  createEmptyProjectDocument,
  type Node,
  type PathData,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { applySceneBehaviors, createDocumentBehaviorContext } from "./apply.js";
import { createBuiltinBehaviorRegistry } from "./builtin.js";

const WARSAW: [number, number] = [21.0122, 52.2297];
const LENINGRAD: [number, number] = [30.3158, 59.9391];

const ROUTE: PathData = Object.freeze({
  id: "pt_route",
  name: "Varsóvia → Leningrado",
  space: "geo",
  vertices: [
    { point: WARSAW, inHandle: null, outHandle: [5, 2] as [number, number] },
    { point: LENINGRAD, inHandle: [-4, -3] as [number, number], outHandle: null },
  ],
  closed: false,
  interpolation: "bezier",
  geodesic: false,
});

function unit(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    type: "unit.armor",
    name: id,
    parent: "nd_root",
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "cyan",
    timeRange: { in: 0, out: 600 },
    timeRemap: null,
    anchor: { space: "geo", lngLat: [0, 0] },
    size: { mode: "screen", size: [64, 64] },
    transform: {
      position: { value: [0, 0], keyframes: [], expression: null },
      rotation: { value: 0, keyframes: [], expression: null },
      scale: { value: [1, 1], keyframes: [], expression: null },
      opacity: { value: 1, keyframes: [], expression: null },
      anchorPoint: { value: [0.5, 0.5], keyframes: [], expression: null },
      skew: { value: [0, 0], keyframes: [], expression: null },
      rotationReference: "screen",
    },
    blendMode: "normal",
    trackMatte: null,
    motionBlur: false,
    props: {},
    effects: [],
    behaviors: [],
    actions: [],
    ...overrides,
  };
}

/** Documento com um tanque no caminho e, opcionalmente, um caça o seguindo. */
function scenario(options: { readonly follower?: boolean; readonly damping?: number } = {}): {
  document: ProjectDocument;
  compositionId: string;
} {
  const base = createEmptyProjectDocument();
  const composition = base.compositions[0]!;
  const root = composition.nodes[composition.root]!;

  const tank = unit("nd_tank", {
    behaviors: [
      {
        id: "bh_path",
        type: "motion-path",
        enabled: true,
        params: {
          pathId: "pt_route",
          progress: {
            value: 0,
            keyframes: [
              { id: "kf_a", frame: 0, value: 0, in: { kind: "linear" }, out: { kind: "linear" } },
              { id: "kf_b", frame: 300, value: 1, in: { kind: "linear" }, out: { kind: "linear" } },
            ],
            expression: null,
          },
          autoOrient: true,
          orientOffset: 0,
          banking: 0,
          offset: [0, 0],
          loop: false,
        },
      },
    ],
  });

  const nodes: Record<string, Node> = {
    [root.id]: {
      ...root,
      children: options.follower === true ? ["nd_tank", "nd_jet"] : ["nd_tank"],
    },
    nd_tank: tank,
  };

  if (options.follower === true) {
    nodes["nd_jet"] = unit("nd_jet", {
      type: "unit.infantry",
      behaviors: [
        {
          id: "bh_follow",
          type: "follow",
          enabled: true,
          params: {
            targetId: "nd_tank",
            offset: [0, 0],
            damping: options.damping ?? 0.6,
            matchRotation: false,
            windowFrames: 10,
          },
        },
      ],
    });
  }

  return {
    document: {
      ...base,
      paths: { [ROUTE.id]: ROUTE },
      compositions: [{ ...composition, nodes }],
    },
    compositionId: composition.id,
  };
}

function anchorOf(document: ProjectDocument, compositionId: string, nodeId: string, frame: number) {
  const scene = evaluate(document, compositionId, frame);
  const result = applySceneBehaviors(scene, document, compositionId);
  const node = result.scene.nodes.get(nodeId);
  if (node === undefined || node.anchor.space !== "geo") throw new Error("nó geo esperado");
  return { lngLat: node.anchor.lngLat, rotation: node.transform.rotation, result };
}

describe("passe de comportamentos", () => {
  it("motion-path move a âncora do nó ao longo do tempo", () => {
    const { document, compositionId } = scenario();
    const start = anchorOf(document, compositionId, "nd_tank", 0);
    const middle = anchorOf(document, compositionId, "nd_tank", 150);
    const end = anchorOf(document, compositionId, "nd_tank", 300);

    expect(start.lngLat[0]).toBeCloseTo(WARSAW[0], 6);
    expect(end.lngLat[0]).toBeCloseTo(LENINGRAD[0], 6);
    expect(middle.lngLat[0]).toBeGreaterThan(WARSAW[0]);
    expect(middle.lngLat[0]).toBeLessThan(LENINGRAD[0]);
    // Auto-orientação virou o nó para bearing geográfico.
    expect(start.result.scene.nodes.get("nd_tank")?.transform.rotationReference).toBe(
      "geo-bearing",
    );
    expect(start.result.affected).toEqual(["nd_tank"]);
    expect(start.result.diagnostics).toEqual([]);
  });

  it("cena sem comportamentos volta idêntica, sem custo", () => {
    const base = createEmptyProjectDocument();
    const compositionId = base.compositions[0]!.id;
    const scene = evaluate(base, compositionId, 10);
    const result = applySceneBehaviors(scene, base, compositionId);
    expect(result.scene).toBe(scene);
    expect(result.affected).toEqual([]);
  });

  it("o seguidor lê o alvo já movido pelo comportamento dele", () => {
    const { document, compositionId } = scenario({ follower: true });
    const jet = anchorOf(document, compositionId, "nd_jet", 150);
    const tank = anchorOf(document, compositionId, "nd_tank", 150);

    // Sem ler o alvo já com motion-path, o caça ficaria em [0, 0].
    expect(jet.lngLat[0]).toBeGreaterThan(WARSAW[0] - 1);
    expect(jet.lngLat[1]).toBeGreaterThan(WARSAW[1] - 1);
    // E fica atrás do tanque, por causa do damping.
    expect(jet.lngLat[0]).toBeLessThan(tank.lngLat[0]);
  });

  it("resultado do seguidor é idêntico avaliando frames fora de ordem", () => {
    const { document, compositionId } = scenario({ follower: true });
    const frames = [200, 40, 150, 12, 199];
    const ordered = frames.map(
      (frame) => anchorOf(document, compositionId, "nd_jet", frame).lngLat,
    );
    const reversed = [...frames]
      .reverse()
      .map((frame) => anchorOf(document, compositionId, "nd_jet", frame).lngLat);
    expect(reversed.reverse()).toEqual(ordered);
  });

  it("comportamento desconhecido e params inválidos viram diagnóstico", () => {
    const { document, compositionId } = scenario();
    const composition = document.compositions[0]!;
    const tank = composition.nodes["nd_tank"]!;
    const broken: ProjectDocument = {
      ...document,
      compositions: [
        {
          ...composition,
          nodes: {
            ...composition.nodes,
            nd_tank: {
              ...tank,
              behaviors: [
                { id: "bh_x", type: "teleport", enabled: true, params: {} },
                { id: "bh_y", type: "wiggle", enabled: true, params: { amplitude: "muito" } },
                { id: "bh_z", type: "wiggle", enabled: false, params: {} },
              ],
            },
          },
        },
      ],
    };

    const scene = evaluate(broken, compositionId, 10);
    const result = applySceneBehaviors(scene, broken, compositionId, {
      registry: createBuiltinBehaviorRegistry(),
    });
    expect(result.diagnostics.map((entry) => entry.type)).toEqual(["teleport", "wiggle"]);
    expect(result.affected).toEqual([]);
  });

  it("o contexto amostra frames fora da composição sem estourar", () => {
    const { document, compositionId } = scenario();
    const context = createDocumentBehaviorContext(document, compositionId, {
      registry: createBuiltinBehaviorRegistry(),
    });
    expect(context.fps).toBeGreaterThan(0);
    expect(context.path("pt_route")?.id).toBe("pt_route");
    expect(context.path("pt_nada")).toBeUndefined();
    expect(context.sampleNode("nd_tank", -30)?.point[0]).toBeCloseTo(WARSAW[0], 6);
    expect(context.sampleNode("nd_ausente", 0)).toBeUndefined();
  });
});
