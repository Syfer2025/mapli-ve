import type { Vec2 } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import {
  addVertex,
  canCommit,
  dragHandle,
  EMPTY_PEN,
  endDrag,
  penDocumentVertices,
  penPolyline,
  removeLastVertex,
  setHover,
} from "./pen-tool.js";

describe("ferramenta de caneta", () => {
  it("clique adiciona vértice em canto e exige dois para gravar", () => {
    const one = endDrag(addVertex(EMPTY_PEN, [10, 10]));
    expect(one.vertices).toHaveLength(1);
    expect(one.vertices[0]?.outHandle).toBeNull();
    expect(canCommit(one)).toBe(false);

    const two = endDrag(addVertex(one, [50, 10]));
    expect(canCommit(two)).toBe(true);
  });

  it("arrastar depois do clique cria o handle de saída", () => {
    const dragged = endDrag(dragHandle(addVertex(EMPTY_PEN, [10, 10]), [40, 30]));
    expect(dragged.vertices[0]?.outHandle).toEqual([40, 30]);
    expect(dragged.dragging).toBeNull();
  });

  it("arrasto curto vira canto em vez de curva de raio zero", () => {
    const tiny = endDrag(dragHandle(addVertex(EMPTY_PEN, [10, 10]), [11, 10]));
    expect(tiny.vertices[0]?.outHandle).toBeNull();
  });

  it("handle de entrada é o espelho do de saída", () => {
    const state = endDrag(dragHandle(addVertex(EMPTY_PEN, [100, 100]), [130, 80]));
    const [vertex] = penDocumentVertices(state);
    expect(vertex?.outHandle).toEqual([130, 80]);
    expect(vertex?.inHandle).toEqual([70, 120]);
  });

  it("polilinha começa e termina nos vértices e curva no meio", () => {
    const straight = endDrag(addVertex(endDrag(addVertex(EMPTY_PEN, [0, 0])), [100, 0]));
    const line = penPolyline(straight, 4);
    expect(line[0]).toEqual([0, 0]);
    expect(line.at(-1)).toEqual([100, 0]);
    expect(line.every((point) => Math.abs(point[1]) < 1e-9)).toBe(true);

    const curved = endDrag(
      addVertex(endDrag(dragHandle(addVertex(EMPTY_PEN, [0, 0]), [0, -80])), [100, 0]),
    );
    const arc = penPolyline(curved, 8);
    expect(arc.some((point) => point[1] < -5)).toBe(true);
    expect(arc.at(-1)).toEqual([100, 0]);
  });

  it("desfaz o último vértice e registra o hover para o segmento-fantasma", () => {
    const two = endDrag(addVertex(endDrag(addVertex(EMPTY_PEN, [0, 0])), [10, 0]));
    expect(removeLastVertex(two).vertices).toHaveLength(1);
    expect(removeLastVertex(EMPTY_PEN)).toBe(EMPTY_PEN);
    expect(setHover(two, [5, 5] as Vec2).hover).toEqual([5, 5]);
    expect(setHover(two, null).hover).toBeNull();
  });

  it("mover o ponteiro sem arrasto ativo não altera vértices", () => {
    const state = endDrag(addVertex(EMPTY_PEN, [10, 10]));
    const moved = dragHandle(state, [90, 90]);
    expect(moved.vertices).toEqual(state.vertices);
    expect(moved.hover).toEqual([90, 90]);
  });

  it("estado vazio não produz polilinha", () => {
    expect(penPolyline(EMPTY_PEN)).toHaveLength(0);
    expect(penDocumentVertices(EMPTY_PEN)).toHaveLength(0);
  });
});
