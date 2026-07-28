/**
 * Provas do rótulo com guia. O que importa: a caixa cai no alvo mais o
 * afastamento **do mesmo frame**, e o vetor da guia volta exatamente o
 * afastamento — se os dois discordarem, a linha aponta para o vazio.
 */

import { MAT2D_IDENTITY, type Mat2D, type Vec2 } from "@theatrum/core-math";
import type { PathData } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { expandCalloutNodes } from "./callout-nodes.js";
import type { ScreenNode, ScreenScene } from "@theatrum/renderer";

const IDENTITY: Mat2D = MAT2D_IDENTITY;

function node(id: string, type: string, props: Record<string, unknown> = {}): ScreenNode {
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

function evaluatedOf(entries: readonly (readonly [string, Record<string, unknown>])[]) {
  return {
    compositionId: "cmp",
    frame: 0,
    camera: {} as never,
    drawOrder: entries.map(([id]) => id),
    nodes: new Map(
      entries.map(([id, props]) => [id, { id, visible: true, props, opacity: 1 } as never]),
    ),
  } as never;
}

const NO_PATHS: Readonly<Record<string, PathData>> = {};
const project = (lngLat: Vec2): Vec2 => [lngLat[0] * 10, lngLat[1] * 10];

describe("rótulo com guia", () => {
  it("a caixa vai para o alvo mais o afastamento, e a guia volta o afastamento", () => {
    const result = expandCalloutNodes(
      scene([node("aviao", "model3d"), node("rot", "label.callout")]),
      evaluatedOf([
        ["aviao", {}],
        ["rot", { targetId: "aviao", offsetX: 70, offsetY: -50 }],
      ]),
      layoutOf([
        ["aviao", [400, 300]],
        ["rot", [0, 0]],
      ]),
      NO_PATHS,
      IDENTITY,
      project,
    );

    const rotulo = result.scene.nodes.get("rot");
    // Matriz posicionada no alvo deslocado…
    expect(rotulo?.layout.matrix.slice(4)).toEqual([470, 250]);
    // …e a guia volta exatamente até o alvo.
    expect(rotulo?.props["leader"]).toEqual([-70, 50]);
    expect(result.anchored).toBe(1);
    expect(result.loose).toBe(0);
  });

  it("o rótulo acompanha o alvo quando ele se move, sem atraso", () => {
    const run = (anchor: Vec2) =>
      expandCalloutNodes(
        scene([node("aviao", "model3d"), node("rot", "label.callout")]),
        evaluatedOf([
          ["aviao", {}],
          ["rot", { targetId: "aviao", offsetX: 0, offsetY: 0 }],
        ]),
        layoutOf([
          ["aviao", anchor],
          ["rot", [0, 0]],
        ]),
        NO_PATHS,
        IDENTITY,
        project,
      )
        .scene.nodes.get("rot")
        ?.layout.matrix.slice(4);

    // Cada frame lê o layout daquele frame: a caixa segue na hora.
    expect(run([100, 100])).toEqual([100, 100]);
    expect(run([250, 180])).toEqual([250, 180]);
  });

  it("alvo ausente do frame vira diagnóstico e rótulo sem guia, não sumiço", () => {
    const result = expandCalloutNodes(
      scene([node("rot", "label.callout")]),
      evaluatedOf([["rot", { targetId: "fantasma", offsetX: 10, offsetY: 10 }]]),
      layoutOf([["rot", [55, 66]]]),
      NO_PATHS,
      IDENTITY,
      project,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("fantasma");
    expect(result.loose).toBe(1);
    // A caixa fica na própria âncora e a guia some — legenda solta é uso válido.
    expect(result.scene.nodes.get("rot")?.layout.matrix.slice(4)).toEqual([55, 66]);
    expect(result.scene.nodes.get("rot")?.props["leader"]).toBeNull();
  });

  it("rótulo que aponta para si mesmo é tratado como solto", () => {
    const result = expandCalloutNodes(
      scene([node("rot", "label.callout")]),
      evaluatedOf([["rot", { targetId: "rot" }]]),
      layoutOf([["rot", [10, 20]]]),
      NO_PATHS,
      IDENTITY,
      project,
    );
    // Sem diagnóstico: apontar para si não é engano de referência, é ausência
    // de alvo. E a guia de um ponto até ele mesmo não teria o que desenhar.
    expect(result.diagnostics).toEqual([]);
    expect(result.loose).toBe(1);
  });

  it("rótulo de rota cai no ponto do caminho, e progress move o texto", () => {
    const path: PathData = {
      id: "p1",
      name: "rota",
      space: "comp",
      closed: false,
      interpolation: "linear",
      geodesic: false,
      vertices: [
        { point: [0, 0], inHandle: null, outHandle: null },
        { point: [100, 0], inHandle: null, outHandle: null },
      ],
    };
    const at = (progress: number) =>
      expandCalloutNodes(
        scene([node("rot", "label.callout")]),
        evaluatedOf([["rot", { pathId: "p1", progress, offsetX: 0, offsetY: 0 }]]),
        layoutOf([["rot", [0, 0]]]),
        { p1: path },
        IDENTITY,
        project,
      ).scene.nodes.get("rot")?.layout.matrix[4];

    expect(at(0)).toBeCloseTo(0, 3);
    expect(at(0.5)).toBeCloseTo(50, 3);
    expect(at(1)).toBeCloseTo(100, 3);
  });

  it("progress fora de [0,1] é preso à faixa em vez de extrapolar", () => {
    const path: PathData = {
      id: "p1",
      name: "rota",
      space: "comp",
      closed: false,
      interpolation: "linear",
      geodesic: false,
      vertices: [
        { point: [0, 0], inHandle: null, outHandle: null },
        { point: [100, 0], inHandle: null, outHandle: null },
      ],
    };
    const at = (progress: number) =>
      expandCalloutNodes(
        scene([node("rot", "label.callout")]),
        evaluatedOf([["rot", { pathId: "p1", progress }]]),
        layoutOf([["rot", [0, 0]]]),
        { p1: path },
        IDENTITY,
        project,
      ).scene.nodes.get("rot")?.layout.matrix[4];
    expect(at(-3)).toBeCloseTo(0, 3);
    expect(at(9)).toBeCloseTo(100, 3);
  });

  it("caminho inexistente avisa em vez de desenhar no canto", () => {
    const result = expandCalloutNodes(
      scene([node("rot", "label.callout")]),
      evaluatedOf([["rot", { pathId: "sumiu" }]]),
      layoutOf([["rot", [7, 8]]]),
      NO_PATHS,
      IDENTITY,
      project,
    );
    expect(result.diagnostics[0]?.message).toContain("sumiu");
    expect(result.loose).toBe(1);
  });

  it("cena sem rótulo devolve a mesma cena, sem cópia", () => {
    const original = scene([node("aviao", "model3d")]);
    const result = expandCalloutNodes(
      original,
      evaluatedOf([["aviao", {}]]),
      layoutOf([["aviao", [0, 0]]]),
      NO_PATHS,
      IDENTITY,
      project,
    );
    expect(result.scene).toBe(original);
    expect(result.anchored).toBe(0);
  });
});
