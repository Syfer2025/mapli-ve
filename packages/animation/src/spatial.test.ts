import type { AnimatableProperty, Keyframe } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { evaluateProperty } from "./property.js";
import { hasSpatialCurvature, spatialSegment, spatialSegments } from "./spatial.js";

function keyframe(
  id: string,
  frame: number,
  value: readonly [number, number],
  spatial?: { in: readonly [number, number] | null; out: readonly [number, number] | null },
): Keyframe<readonly [number, number]> {
  return {
    id,
    frame,
    value,
    in: { kind: "linear" },
    out: { kind: "linear" },
    ...(spatial === undefined
      ? {}
      : {
          spatial: {
            in: spatial.in === null ? null : [spatial.in[0], spatial.in[1]],
            out: spatial.out === null ? null : [spatial.out[0], spatial.out[1]],
          },
        }),
  };
}

function property(
  keyframes: readonly Keyframe<readonly [number, number]>[],
): AnimatableProperty<readonly [number, number]> {
  return { value: [0, 0], keyframes: [...keyframes], expression: null };
}

describe("handles espaciais", () => {
  it("sem handles o caminho é a reta e o resultado bate com lerp", () => {
    const track = property([keyframe("a", 0, [0, 0]), keyframe("b", 60, [100, 40])]);
    expect(evaluateProperty(track, 30)).toEqual([50, 20]);
    expect(hasSpatialCurvature(track.keyframes[0]!, track.keyframes[1]!)).toBe(false);
  });

  it("handles são deslocamentos relativos e tiram o caminho da reta", () => {
    const curved = property([
      keyframe("a", 0, [0, 0], { in: null, out: [0, -60] }),
      keyframe("b", 60, [100, 0], { in: [0, -60], out: null }),
    ]);
    const middle = evaluateProperty(curved, 30) as readonly [number, number];

    // Simétrico em x, deslocado em y: é um arco, não a reta y = 0.
    expect(middle[0]).toBeCloseTo(50, 10);
    expect(middle[1]).toBeCloseTo(-45, 10);
    expect(hasSpatialCurvature(curved.keyframes[0]!, curved.keyframes[1]!)).toBe(true);
  });

  it("handle nulo de um lado ainda curva o trecho", () => {
    const single = property([
      keyframe("a", 0, [0, 0], { in: null, out: [40, -40] }),
      keyframe("b", 40, [80, 0]),
    ]);
    const middle = evaluateProperty(single, 20) as readonly [number, number];
    expect(middle[1]).toBeLessThan(0);
  });

  it("o easing temporal muda quando, não por onde", () => {
    const path = [
      keyframe("a", 0, [0, 0], { in: null, out: [0, -60] }),
      keyframe("b", 60, [100, 0], { in: [0, -60], out: null }),
    ];
    const linear = property(path);
    const eased = property([
      { ...path[0]!, out: { kind: "bezier", handle: [0.42, 0] } },
      { ...path[1]!, in: { kind: "bezier", handle: [0.58, 1] } },
    ]);

    // Frame 15, não 30: um ease simétrico mapeia o meio em si mesmo, e o teste
    // não distinguiria nada exatamente no centro.
    const linearAt15 = evaluateProperty(linear, 15) as readonly [number, number];
    const easedAt15 = evaluateProperty(eased, 15) as readonly [number, number];
    // Mesmo instante, posições diferentes — mas ambas no mesmo arco.
    expect(easedAt15[0]).toBeLessThan(linearAt15[0]);
    expect(evaluateProperty(eased, 30)).toEqual(evaluateProperty(linear, 30));
    expect(evaluateProperty(eased, 0)).toEqual([0, 0]);
    expect(evaluateProperty(eased, 60)).toEqual([100, 0]);
  });

  it("segmentos ignoram keyframes que não são posição", () => {
    const mixed = [
      keyframe("a", 0, [0, 0]),
      { ...keyframe("b", 30, [1, 1]), value: 5 as unknown as readonly [number, number] },
      keyframe("c", 60, [10, 10]),
    ];
    expect(spatialSegments(mixed)).toHaveLength(0);
    expect(spatialSegments([keyframe("a", 0, [0, 0]), keyframe("b", 10, [1, 1])])).toHaveLength(1);
  });

  it("segmento com handles zerados degenera na reta", () => {
    const straight = spatialSegment([0, 0], [10, 0], [0, 0], [0, 0]);
    expect(straight.c0[0]).toBeCloseTo(10 / 3, 12);
    expect(straight.c1[0]).toBeCloseTo(20 / 3, 12);
    expect(straight.p0).toEqual([0, 0]);
    expect(straight.p1).toEqual([10, 0]);
  });
});
