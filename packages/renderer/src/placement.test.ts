import { describe, expect, it } from "vitest";
import { visualPlacement, type VisualPrimitive } from "./index.js";

describe("convenção geométrica local", () => {
  it.each([text(), image(), circle(), symbol()])("centraliza $kind em size/2", (visual) => {
    expect(visualPlacement(visual, [120, 80]).position).toEqual([60, 40]);
  });

  it("usa anchor central para texto e imagem", () => {
    expect(visualPlacement(text(), [120, 80]).anchor).toEqual([0.5, 0.5]);
    expect(visualPlacement(image(), [120, 80]).anchor).toEqual([0.5, 0.5]);
  });

  it("mantém linha e polígono no sistema local explícito", () => {
    const line: VisualPrimitive = {
      kind: "line",
      points: [
        [0, 0],
        [120, 80],
      ],
      color: "#ffffff",
      width: 2,
    };
    const polygon: VisualPrimitive = {
      kind: "polygon",
      points: [
        [0, 0],
        [120, 0],
        [120, 80],
      ],
      fill: "#ffffff",
      fillAlpha: 1,
      stroke: "#000000",
      strokeWidth: 1,
    };

    expect(visualPlacement(line, [120, 80])).toEqual({
      position: [0, 0],
      anchor: [0, 0],
    });
    expect(visualPlacement(polygon, [120, 80])).toEqual({
      position: [0, 0],
      anchor: [0, 0],
    });
  });
});

function text(): VisualPrimitive {
  return {
    kind: "text",
    text: "Kursk",
    color: "#ffffff",
    fontFamily: "Open Sans",
    fontSize: 24,
    fontWeight: "normal",
    align: "center",
  };
}

function image(): VisualPrimitive {
  return { kind: "image", source: "asset", tint: "#ffffff" };
}

function circle(): VisualPrimitive {
  return {
    kind: "circle",
    radius: 40,
    fill: "#ffffff",
    fillAlpha: 1,
    stroke: "#000000",
    strokeWidth: 1,
  };
}

function symbol(): VisualPrimitive {
  return {
    kind: "symbol",
    shape: "square",
    size: 40,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: 1,
    label: "A",
    labelColor: "#000000",
  };
}
