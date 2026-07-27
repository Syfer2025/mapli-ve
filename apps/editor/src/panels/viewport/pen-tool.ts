/**
 * Estado da ferramenta de caneta, puro e em espaço de tela.
 *
 * A conversão para lng/lat acontece no componente, no momento de gravar o
 * caminho: handle é **deslocamento relativo**, e converter um deslocamento de
 * pixels para graus não é linear. O jeito correto é converter o ponto absoluto
 * do handle e subtrair o vértice já convertido — por isso este módulo guarda os
 * handles como pontos absolutos de tela e só o commit resolve a diferença.
 */

import type { Vec2 } from "@theatrum/core-math";

export interface PenVertex {
  readonly point: Vec2;
  /** Ponto absoluto do handle de saída; `null` = vértice em canto. */
  readonly outHandle: Vec2 | null;
}

export interface PenState {
  readonly vertices: readonly PenVertex[];
  /** Índice do vértice cujo handle está sendo arrastado. */
  readonly dragging: number | null;
  /** Última posição do ponteiro, para o segmento-fantasma. */
  readonly hover: Vec2 | null;
}

export const EMPTY_PEN: PenState = Object.freeze({
  vertices: Object.freeze([]),
  dragging: null,
  hover: null,
});

export function addVertex(state: PenState, point: Vec2): PenState {
  const vertices = [...state.vertices, { point: [point[0], point[1]] as Vec2, outHandle: null }];
  return { vertices: Object.freeze(vertices), dragging: vertices.length - 1, hover: point };
}

/** Arrasta o handle do vértice em foco; sem arrasto ativo, nada muda. */
export function dragHandle(state: PenState, point: Vec2): PenState {
  if (state.dragging === null) return { ...state, hover: point };
  const vertices = state.vertices.map((vertex, index) =>
    index === state.dragging ? { ...vertex, outHandle: [point[0], point[1]] as Vec2 } : vertex,
  );
  return { ...state, vertices: Object.freeze(vertices), hover: point };
}

export function endDrag(state: PenState): PenState {
  if (state.dragging === null) return state;
  // Handle colado no vértice é canto, não curva de raio zero.
  const vertices = state.vertices.map((vertex, index) => {
    if (index !== state.dragging || vertex.outHandle === null) return vertex;
    const dx = vertex.outHandle[0] - vertex.point[0];
    const dy = vertex.outHandle[1] - vertex.point[1];
    return Math.hypot(dx, dy) < 2 ? { ...vertex, outHandle: null } : vertex;
  });
  return { ...state, vertices: Object.freeze(vertices), dragging: null };
}

export function removeLastVertex(state: PenState): PenState {
  if (state.vertices.length === 0) return state;
  return {
    ...state,
    vertices: Object.freeze(state.vertices.slice(0, -1)),
    dragging: null,
  };
}

export function setHover(state: PenState, point: Vec2 | null): PenState {
  return { ...state, hover: point };
}

/** Um caminho só existe com dois vértices; abaixo disso não há o que gravar. */
export function canCommit(state: PenState): boolean {
  return state.vertices.length >= 2;
}

/**
 * Polilinha para desenhar o caminho em construção: cada trecho é amostrado da
 * cúbica formada pelos handles, espelhando o handle de saída como handle de
 * entrada do vértice seguinte (caneta simétrica, como no Illustrator).
 */
export function penPolyline(state: PenState, samplesPerSegment = 16): readonly Vec2[] {
  const points: Vec2[] = [];
  const vertices = state.vertices;
  const first = vertices[0];
  if (first === undefined) return points;
  points.push([first.point[0], first.point[1]]);

  for (let index = 0; index + 1 < vertices.length; index += 1) {
    const from = vertices[index];
    const to = vertices[index + 1];
    if (from === undefined || to === undefined) continue;
    const c0 = from.outHandle ?? from.point;
    const c1 = mirror(to.point, to.outHandle);
    for (let step = 1; step <= samplesPerSegment; step += 1) {
      points.push(cubicAt(from.point, c0, c1, to.point, step / samplesPerSegment));
    }
  }
  return points;
}

/**
 * Vértices no formato do documento, ainda em espaço de tela: `inHandle` é o
 * espelho de `outHandle`, que é o que dá tangente contínua no vértice.
 */
export function penDocumentVertices(state: PenState): readonly {
  readonly point: Vec2;
  readonly inHandle: Vec2 | null;
  readonly outHandle: Vec2 | null;
}[] {
  return state.vertices.map((vertex) => ({
    point: [vertex.point[0], vertex.point[1]] as Vec2,
    inHandle: vertex.outHandle === null ? null : mirror(vertex.point, vertex.outHandle),
    outHandle: vertex.outHandle === null ? null : [vertex.outHandle[0], vertex.outHandle[1]],
  }));
}

function mirror(point: Vec2, handle: Vec2 | null): Vec2 {
  if (handle === null) return [point[0], point[1]];
  return [2 * point[0] - handle[0], 2 * point[1] - handle[1]];
}

function cubicAt(p0: Vec2, c0: Vec2, c1: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * p0[0] + w1 * c0[0] + w2 * c1[0] + w3 * p1[0],
    w0 * p0[1] + w1 * c0[1] + w2 * c1[1] + w3 * p1[1],
  ];
}
