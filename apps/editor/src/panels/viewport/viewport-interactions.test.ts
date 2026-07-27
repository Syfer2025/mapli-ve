import type { Rect } from "@theatrum/core-math";
import { describe, expect, it } from "vitest";
import {
  hitTestLayouts,
  marqueeLayouts,
  rectFromDrag,
  transformFromDrag,
  type SelectableLayout,
} from "./viewport-interactions.js";

describe("viewport interactions", () => {
  const layouts = new Map<string, SelectableLayout>([
    ["back", layout({ x: 0, y: 0, width: 100, height: 100 })],
    ["front", layout({ x: 25, y: 25, width: 50, height: 50 })],
    ["culled", layout({ x: 0, y: 0, width: 200, height: 200 }, true)],
  ]);

  it("seleciona o nó visível superior", () => {
    expect(hitTestLayouts(layouts, ["back", "front", "culled"], [50, 50])).toBe("front");
    expect(hitTestLayouts(layouts, ["back", "front"], [50, 50], (id) => id !== "front")).toBe(
      "back",
    );
    expect(hitTestLayouts(layouts, ["back"], [150, 150])).toBeNull();
  });

  it("faz marquee por interseção ou contenção", () => {
    expect(
      marqueeLayouts(layouts, ["back", "front"], { x: 40, y: 40, width: 20, height: 20 }),
    ).toEqual(["back", "front"]);
    expect(
      marqueeLayouts(
        layouts,
        ["back", "front"],
        { x: 20, y: 20, width: 60, height: 60 },
        { contained: true },
      ),
    ).toEqual(["front"]);
  });

  it("normaliza o retângulo de um arrasto invertido", () => {
    expect(rectFromDrag([20, 30], [5, 10])).toEqual({
      x: 5,
      y: 10,
      width: 15,
      height: 20,
    });
  });

  it("calcula posição, rotação e escala sem estado acumulado", () => {
    const initial = { position: [10, 20] as const, rotation: 350, scale: [2, 3] as const };
    expect(
      transformFromDrag({
        mode: "position",
        start: [5, 5],
        current: [15, 25],
        center: [0, 0],
        initial,
      }).position,
    ).toEqual([20, 40]);
    expect(
      transformFromDrag({
        mode: "rotation",
        start: [10, 0],
        current: [0, 10],
        center: [0, 0],
        initial,
      }).rotation,
    ).toBeCloseTo(80);
    expect(
      transformFromDrag({
        mode: "scale",
        start: [10, 0],
        current: [20, 0],
        center: [0, 0],
        initial,
      }).scale,
    ).toEqual([4, 6]);
  });
});

function layout(bounds: Rect, culled = false): SelectableLayout {
  return { bounds, culled };
}
