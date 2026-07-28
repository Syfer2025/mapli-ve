/**
 * Provas do passe de rotas. O que importa: a ponta nasce no fim do trecho
 * **revelado** e não no fim do caminho, e a geometria sai relativa à âncora do
 * nó — os dois erros que fazem a seta apontar para o lugar errado sem quebrar
 * nada.
 */

import { MAT2D_IDENTITY, type Mat2D, type Vec2 } from "@theatrum/core-math";
import type { PathData } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { expandRouteNodes } from "./route-nodes.js";
import type { ScreenNode, ScreenScene } from "@theatrum/renderer";

const IDENTITY: Mat2D = MAT2D_IDENTITY;

function node(id: string, props: Record<string, unknown> = {}, type = "route"): ScreenNode {
  return {
    id,
    type,
    slot: "scene",
    props,
    layout: {
      matrix: IDENTITY,
      size: [64, 64],
      opacity: 1,
      visible: true,
      blendMode: "normal",
    },
  };
}

function scene(nodes: readonly ScreenNode[]): ScreenScene {
  return {
    frame: 0,
    size: [1920, 1080],
    pixelRatio: 1,
    nodes: new Map(nodes.map((entry) => [entry.id, entry])),
    drawOrder: nodes.map((entry) => entry.id),
  };
}

function layoutOf(entries: readonly (readonly [string, Vec2])[]) {
  return {
    frame: 0,
    projector: undefined,
    drawOrder: entries.map(([id]) => id),
    layouts: new Map(
      entries.map(([id, anchorPx]) => [
        id,
        {
          matrix: IDENTITY,
          localMatrix: IDENTITY,
          anchorPx,
          sizePx: [64, 64] as Vec2,
          bounds: { x: anchorPx[0], y: anchorPx[1], width: 64, height: 64 },
          culled: false,
        },
      ]),
    ),
  };
}

function evaluatedOf(entries: readonly (readonly [string, Record<string, unknown>, string?])[]) {
  return {
    compositionId: "cmp",
    frame: 0,
    camera: {} as never,
    drawOrder: entries.map(([id]) => id),
    nodes: new Map(
      entries.map(([id, props, type = "route"]) => [
        id,
        { id, type, visible: true, props, opacity: 1 } as never,
      ]),
    ),
  } as never;
}

/** Caminho reto em espaço comp, de (0,0) a (400,0). */
const RETA: PathData = {
  id: "p1",
  name: "reta",
  space: "comp",
  closed: false,
  geodesic: false,
  interpolation: "linear",
  vertices: [
    { point: [0, 0], inHandle: null, outHandle: null },
    { point: [400, 0], inHandle: null, outHandle: null },
  ],
} as PathData;

const PATHS: Readonly<Record<string, PathData>> = { p1: RETA };
const project = (lngLat: Vec2): Vec2 => lngLat;

function geometryOf(result: ReturnType<typeof expandRouteNodes>, id: string) {
  const props = result.scene.nodes.get(id)?.props as
    { strokes?: readonly (readonly Vec2[])[]; fills?: readonly (readonly Vec2[])[] } | undefined;
  return { strokes: props?.strokes ?? [], fills: props?.fills ?? [] };
}

describe("passe de rotas", () => {
  it("desenha a linha inteira e a ponta no destino", () => {
    const props = { pathId: "p1", arrowSize: 20 };
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", props]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    const { strokes, fills } = geometryOf(result, "r");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.[0]).toEqual([0, 0]);
    expect((strokes[0]?.[strokes[0].length - 1] as Vec2)[0]).toBeCloseTo(400, 6);
    // A ponta é um triângulo preenchido com o vértice no fim.
    expect(fills).toHaveLength(1);
    expect((fills[0]?.[0] as Vec2)[0]).toBeCloseTo(400, 6);
    expect(result.drawn).toBe(1);
  });

  it("a ponta acompanha a revelação — não fica esperando no destino", () => {
    // É o defeito que a revelação existe para evitar: a seta parada no fim
    // enquanto a linha cresce por baixo.
    const half = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1", arrowSize: 20, trimEnd: 0.5 }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    const tip = geometryOf(half, "r").fills[0]?.[0] as Vec2;
    expect(tip[0]).toBeCloseTo(200, 3);
  });

  it("a geometria é relativa à âncora do nó, não absoluta", () => {
    // O layout já pôs o contêiner na âncora; devolver absoluto somaria a posição
    // duas vezes e deslocaria a rota inteira.
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1" }]]),
      layoutOf([["r", [1000, 500]]]),
      PATHS,
      project,
    );
    expect(geometryOf(result, "r").strokes[0]?.[0]).toEqual([-1000, -500]);
  });

  it("tracejado vira vários traços; sem intervalo, um traço só", () => {
    const tracejada = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1", dashPx: 20, gapPx: 20 }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    expect(geometryOf(tracejada, "r").strokes.length).toBeGreaterThan(5);

    const solida = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1", dashPx: 20, gapPx: 0 }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    expect(geometryOf(solida, "r").strokes).toHaveLength(1);
  });

  it("a seta de avanço substitui a linha em vez de acompanhá-la", () => {
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1", filled: true, arrowSize: 20 }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    const { strokes, fills } = geometryOf(result, "r");
    // Um polígono só: o contorno da seta gorda já tem a ponta embutida, e somar
    // o triângulo separado desenharia duas pontas empilhadas.
    expect(strokes).toHaveLength(0);
    expect(fills).toHaveLength(1);
    expect((fills[0] as readonly Vec2[]).length).toBeGreaterThan(4);
  });

  it("revelação zerada apaga a rota sem virar erro", () => {
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1", trimEnd: 0 }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    const { strokes, fills } = geometryOf(result, "r");
    expect(strokes).toEqual([]);
    expect(fills).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.drawn).toBe(0);
  });

  it("caminho ausente vira diagnóstico, não exceção", () => {
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "fantasma" }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("fantasma");
    expect(result.drawn).toBe(0);
  });

  it("aplica o projetor em caminho geográfico", () => {
    const geo: PathData = { ...RETA, id: "g", space: "geo", geodesic: false } as PathData;
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "g" }]]),
      layoutOf([["r", [0, 0]]]),
      { g: geo },
      (lngLat) => [lngLat[0] * 3, lngLat[1] * 3],
    );
    const strokes = geometryOf(result, "r").strokes;
    expect((strokes[0]?.[strokes[0].length - 1] as Vec2)[0]).toBeCloseTo(1200, 3);
  });

  it("informa os caminhos consumidos para o overlay não redesenhá-los", () => {
    const result = expandRouteNodes(
      scene([node("r")]),
      evaluatedOf([["r", { pathId: "p1" }]]),
      layoutOf([["r", [0, 0]]]),
      PATHS,
      project,
    );
    expect([...result.pathIds]).toEqual(["p1"]);
  });

  it("desenha geo.frontline a partir do LineString embutido", () => {
    const props = {
      geometry: {
        type: "LineString",
        coordinates: [
          [10, 20],
          [11, 21],
          [12, 20],
        ],
      },
      trimEnd: 1,
    };
    const result = expandRouteNodes(
      scene([node("frente", props, "geo.frontline")]),
      evaluatedOf([["frente", props, "geo.frontline"]]),
      layoutOf([["frente", [0, 0]]]),
      {},
      ([lng, lat]) => [lng * 10, lat * 10],
    );
    const { strokes } = geometryOf(result, "frente");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.[0]).toEqual([100, 200]);
    expect(strokes[0]?.at(-1)).toEqual([120, 200]);
    expect(result.diagnostics).toEqual([]);
    expect(result.drawn).toBe(1);
    expect([...result.pathIds]).toEqual([]);
  });

  it("devolve a cena original quando não há rota nenhuma", () => {
    const original = scene([node("x")]);
    const result = expandRouteNodes(original, evaluatedOf([]), layoutOf([]), PATHS, project);
    expect(result.scene).toBe(original);
  });
});
