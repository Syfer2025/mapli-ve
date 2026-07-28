import { mat2d, rect, type Vec2 } from "@theatrum/core-math";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { EvaluatedScene } from "@theatrum/animation";
import type { ScreenScene } from "@theatrum/renderer";
import { describe, expect, it, vi } from "vitest";

/**
 * Malha mínima: um anel quadrado de 4 vértices em graus, nível único. O passe
 * consome a malha por `geoMeshFor`, então o módulo inteiro é trocado — nada de
 * rede nem de disco num teste de projeção.
 */
const RING: readonly Vec2[] = [
  [0, 0],
  [5, 0],
  [5, 5],
  [0, 5],
];

const fakeMesh = {
  layer: "countries",
  featureCount: 1,
  levelCount: 1,
  has: (id: string) => id === "country:TEST",
  feature: (id: string) =>
    id === "country:TEST"
      ? {
          id,
          name: "Teste",
          kind: "country" as const,
          props: Object.freeze({}),
          bounds: Object.freeze({ west: 0, south: 0, east: 5, north: 5 }),
          center: Object.freeze([2.5, 2.5]) as unknown as Vec2,
          ringCount: 1,
          vertexCount: 4,
        }
      : undefined,
  list: () => Object.freeze([]),
  levelForZoom: () => 0,
  vertexCountAt: () => 4,
  forEachVertex: (
    _id: string,
    _level: number,
    onRing: (ringIndex: number, vertexCount: number) => void,
    onVertex: (lng: number, lat: number) => void,
  ): void => {
    onRing(0, RING.length);
    for (const [lng, lat] of RING) onVertex(lng, lat);
  },
};

vi.mock("../../geo/geo-data.js", () => ({
  geoMeshFor: (geoId: string) => (geoId === "country:TEST" ? fakeMesh : undefined),
}));

const { expandGeoNodes } = await import("./geo-nodes.js");

/** Projeção de brinquedo: a âncora [0,0] cai em [100,100] e cada grau vale 10 px. */
const project = (lngLat: Vec2): Vec2 => [100 + lngLat[0] * 10, 100 + lngLat[1] * 10];

/** A matriz que o estágio de layout produz: pivot de 0,5 no tamanho 64×64. */
const STALE_MATRIX = mat2d.compose({
  position: [100, 100],
  rotation: 0,
  scale: [1, 1],
  skew: [0, 0],
  anchor: [32, 32],
});

function fixtures() {
  const evaluated = {
    nodes: new Map([
      [
        "n1",
        {
          id: "n1",
          type: "geo.region",
          visible: true,
          props: { geoId: "country:TEST" },
          transform: { anchorPoint: [0.5, 0.5] as Vec2 },
        },
      ],
    ]),
  } as unknown as EvaluatedScene;

  const screenNode = {
    id: "n1",
    type: "geo.region",
    slot: "scene" as const,
    props: Object.freeze({}),
    layout: Object.freeze({
      matrix: STALE_MATRIX,
      size: [64, 64] as Vec2,
      opacity: 1,
      visible: true,
      blendMode: "normal",
    }),
  };
  const screen = {
    frame: 0,
    size: [1887, 965] as Vec2,
    pixelRatio: 1,
    nodes: new Map([["n1", screenNode]]),
    drawOrder: ["n1"],
  } as unknown as ScreenScene;

  const layout = {
    frame: 0,
    projector: Object.freeze({}),
    layouts: new Map([
      [
        "n1",
        Object.freeze({
          matrix: STALE_MATRIX,
          localMatrix: STALE_MATRIX,
          anchorPx: [100, 100] as Vec2,
          sizePx: [64, 64] as Vec2,
          bounds: rect.fromPoints([
            [68, 68],
            [132, 132],
          ]),
          culled: false,
        }),
      ],
    ]),
  } as unknown as LayoutScreenScene;

  return { evaluated, screen, layout };
}

describe("expandGeoNodes · matriz da âncora", () => {
  it("pinta cada vértice exatamente onde a projeção manda, sem o deslocamento do pivot", () => {
    const { evaluated, screen, layout } = fixtures();
    const expansion = expandGeoNodes(
      screen,
      evaluated,
      layout,
      { zoom: 5, bounds: undefined },
      project,
    );

    expect(expansion.drawn).toBe(1);
    const node = expansion.scene.nodes.get("n1");
    expect(node).toBeDefined();
    const rings = node?.props["rings"] as readonly (readonly Vec2[])[];
    expect(rings).toHaveLength(1);
    // Os anéis continuam relativos à âncora...
    expect(rings[0]).toEqual([
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ]);
    // ...mas a matriz agora devolve a origem local para a âncora: composta com
    // translate(32), o (0,0) local cai em anchorPx e não em anchorPx − 32.
    for (const [index, vertex] of RING.entries()) {
      const painted = mat2d.applyPoint(node!.layout.matrix, rings[0]![index]!);
      const wanted = project(vertex);
      expect(painted[0]).toBeCloseTo(wanted[0], 6);
      expect(painted[1]).toBeCloseTo(wanted[1], 6);
    }
    // Sem o remendo, a matriz velha pintaria 32 px para cima e para a esquerda.
    const stale = mat2d.applyPoint(STALE_MATRIX, [0, 0]);
    expect(stale).toEqual([68, 68]);
  });

  it("mantém a extensão real da geometria no tamanho e na caixa", () => {
    const { evaluated, screen, layout } = fixtures();
    const expansion = expandGeoNodes(
      screen,
      evaluated,
      layout,
      { zoom: 5, bounds: undefined },
      project,
    );
    const node = expansion.scene.nodes.get("n1");
    expect(node?.layout.size).toEqual([50, 50]);
    expect(node?.layout.visible).toBe(true);
    const box = expansion.bounds.get("n1");
    expect(box).toBeDefined();
    expect(box?.x).toBeCloseTo(100, 6);
    expect(box?.y).toBeCloseTo(100, 6);
    expect(box?.width).toBeCloseTo(50, 6);
    expect(box?.height).toBeCloseTo(50, 6);
  });
});
