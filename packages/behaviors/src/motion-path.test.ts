import { geodesicDistance } from "@theatrum/gis";
import type { Node, PathData } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { motionPathBehavior, type MotionPathParams } from "./motion-path.js";
import { pathGeometry } from "./path-geometry.js";
import type { BehaviorContext } from "./contracts.js";

const WARSAW: [number, number] = [21.0122, 52.2297];
const LENINGRAD: [number, number] = [30.3158, 59.9391];

function path(overrides: Partial<PathData> = {}): PathData {
  return {
    id: "pt_route",
    name: "Varsóvia → Leningrado",
    space: "geo",
    vertices: [
      { point: WARSAW, inHandle: null, outHandle: [4, 1] },
      { point: [26, 57], inHandle: [-3, -1], outHandle: [3, 1] },
      { point: LENINGRAD, inHandle: [-2, -2], outHandle: null },
    ],
    closed: false,
    interpolation: "bezier",
    geodesic: false,
    ...overrides,
  };
}

function node(id = "nd_tank"): Node {
  return {
    id,
    type: "unit.armor",
    name: "Blindado",
    parent: null,
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
  };
}

function context(paths: readonly PathData[], fps = 60): BehaviorContext {
  const byId = new Map(paths.map((entry) => [entry.id, entry]));
  return {
    fps,
    path: (pathId) => byId.get(pathId),
    sampleNode: () => undefined,
  };
}

function params(overrides: Partial<MotionPathParams> = {}): MotionPathParams {
  return {
    pathId: "pt_route",
    progress: { value: 0, keyframes: [], expression: null },
    autoOrient: true,
    orientOffset: 0,
    banking: 0,
    offset: [0, 0],
    loop: false,
    ...overrides,
  };
}

function lngLatAt(progress: number, overrides: Partial<MotionPathParams> = {}): [number, number] {
  const route = path();
  const contribution = motionPathBehavior.contribute(
    node(),
    params({ progress: { value: progress, keyframes: [], expression: null }, ...overrides }),
    0,
    context([route]),
  );
  const anchor = contribution.anchor;
  if (anchor === undefined || anchor.space !== "geo") throw new Error("âncora geo esperada");
  return [anchor.lngLat[0], anchor.lngLat[1]];
}

describe("motion-path", () => {
  it("ancora nas pontas do caminho em progress 0 e 1", () => {
    expect(lngLatAt(0)[0]).toBeCloseTo(WARSAW[0], 9);
    expect(lngLatAt(0)[1]).toBeCloseTo(WARSAW[1], 9);
    expect(lngLatAt(1)[0]).toBeCloseTo(LENINGRAD[0], 9);
    expect(lngLatAt(1)[1]).toBeCloseTo(LENINGRAD[1], 9);
  });

  it("progress uniforme percorre distância uniforme no terreno", () => {
    const steps = 40;
    const points = Array.from({ length: steps + 1 }, (_unused, index) => lngLatAt(index / steps));
    const distances: number[] = [];
    for (let index = 0; index + 1 < points.length; index += 1) {
      distances.push(geodesicDistance(points[index]!, points[index + 1]!));
    }
    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const worst = Math.max(...distances.map((value) => Math.abs(value - mean) / mean));

    // Sem a tabela de arco esse desvio passaria de 40% nas curvas.
    expect(worst).toBeLessThan(0.02);
  });

  it("progress fora de faixa satura, e com loop dá a volta", () => {
    expect(lngLatAt(1.4)).toEqual(lngLatAt(1));
    expect(lngLatAt(-0.3)).toEqual(lngLatAt(0));
    const looped = lngLatAt(1.25, { loop: true });
    const quarter = lngLatAt(0.25);
    expect(looped[0]).toBeCloseTo(quarter[0], 9);
    expect(looped[1]).toBeCloseTo(quarter[1], 9);
  });

  it("auto-orienta em bearing geográfico e aceita offset", () => {
    const route = path();
    const straight = motionPathBehavior.contribute(
      node(),
      params({ progress: { value: 0.5, keyframes: [], expression: null } }),
      0,
      context([route]),
    );
    expect(straight.rotationReference).toBe("geo-bearing");
    // O trajeto sobe para nordeste: bearing entre 0° e 90°.
    expect(straight.rotation).toBeGreaterThan(0);
    expect(straight.rotation).toBeLessThan(90);

    const offset = motionPathBehavior.contribute(
      node(),
      params({ progress: { value: 0.5, keyframes: [], expression: null }, orientOffset: 90 }),
      0,
      context([route]),
    );
    expect(offset.rotation).toBeCloseTo((straight.rotation ?? 0) + 90, 9);
  });

  it("sem auto-orientação não mexe na rotação dos keyframes", () => {
    const contribution = motionPathBehavior.contribute(
      node(),
      params({ autoOrient: false }),
      0,
      context([path()]),
    );
    expect(contribution.rotation).toBeUndefined();
    // Sem banking também não há acréscimo: a rotação do nó fica intocada.
    expect(contribution.rotationOffset).toBeUndefined();
  });

  it("banking inclina para dentro da curva, com sinal oposto em curvas espelhadas", () => {
    // Quarto de volta partindo para o norte: uma vira à direita, a outra à
    // esquerda. O mesmo caminho não serve para as duas — um arco só curva para
    // um lado.
    const bankAt = (vertices: PathData["vertices"], progress: number): number => {
      const curve = path({ id: "pt_turn", vertices });
      const banked = motionPathBehavior.contribute(
        node(),
        params({
          pathId: "pt_turn",
          progress: { value: progress, keyframes: [], expression: null },
          banking: 1,
        }),
        0,
        context([curve]),
      );
      const plain = motionPathBehavior.contribute(
        node(),
        params({
          pathId: "pt_turn",
          progress: { value: progress, keyframes: [], expression: null },
        }),
        0,
        context([curve]),
      );
      return (banked.rotation ?? 0) - (plain.rotation ?? 0);
    };

    const right: PathData["vertices"] = [
      { point: [0, 0], inHandle: null, outHandle: [0, 10] },
      { point: [10, 10], inHandle: [-10, 0], outHandle: null },
    ];
    const left: PathData["vertices"] = [
      { point: [0, 0], inHandle: null, outHandle: [0, 10] },
      { point: [-10, 10], inHandle: [10, 0], outHandle: null },
    ];

    expect(bankAt(right, 0.5)).toBeLessThan(0);
    expect(bankAt(left, 0.5)).toBeGreaterThan(0);
    expect(bankAt(right, 0.5)).toBeCloseTo(-bankAt(left, 0.5), 6);

    const straight: PathData["vertices"] = [
      { point: [0, 0], inHandle: null, outHandle: null },
      { point: [0, 20], inHandle: null, outHandle: null },
    ];
    expect(Math.abs(bankAt(straight, 0.5))).toBeLessThan(1e-9);
  });

  it("caminho geodésico segue a rota mais curta, não a reta em lng/lat", () => {
    const geodesic = pathGeometry(
      path({
        id: "pt_flight",
        vertices: [
          { point: [-9, 38.7], inHandle: null, outHandle: null },
          { point: [37.6, 55.7], inHandle: null, outHandle: null },
        ],
        geodesic: true,
      }),
    );
    const flat = pathGeometry(
      path({
        id: "pt_flat",
        interpolation: "linear",
        vertices: [
          { point: [-9, 38.7], inHandle: null, outHandle: null },
          { point: [37.6, 55.7], inHandle: null, outHandle: null },
        ],
      }),
    );

    expect(geodesic.geodesic).toBe(true);
    // A rota geodésica é mais curta em metros que a reta de Mercator.
    expect(geodesic.totalLength).toBeLessThan(flat.totalLength);
    // Comprimento em metros, não em graus.
    expect(geodesic.totalLength).toBeGreaterThan(3_000_000);
  });

  it("reporta diagnóstico em vez de lançar quando o caminho falta", () => {
    const missing = motionPathBehavior.contribute(
      node(),
      params({ pathId: "pt_ausente" }),
      0,
      context([]),
    );
    expect(missing.anchor).toBeUndefined();
    expect(missing.diagnostic).toContain("pt_ausente");

    const empty = motionPathBehavior.contribute(
      node(),
      params({ pathId: "pt_vazio" }),
      0,
      context([
        path({
          id: "pt_vazio",
          vertices: [{ point: [0, 0], inHandle: null, outHandle: null }],
        }),
      ]),
    );
    expect(empty.diagnostic).toContain("comprimento");
  });
});
