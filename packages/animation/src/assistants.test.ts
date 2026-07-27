import type { AnimatableProperty, Keyframe } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { applyEasyEase, redistributeRovingKeyframes, setKeyframeRoving } from "./assistants.js";
import { speedUniformity } from "./velocity.js";

type Vec = readonly [number, number];

function keyframe(id: string, frame: number, value: Vec, roving = false): Keyframe<Vec> {
  return {
    id,
    frame,
    value,
    in: { kind: "linear" },
    out: { kind: "linear" },
    ...(roving ? { roving: true } : {}),
  };
}

function property(keyframes: readonly Keyframe<Vec>[]): AnimatableProperty<Vec> {
  return { value: [0, 0], keyframes: [...keyframes], expression: null };
}

describe("keyframe assistants", () => {
  it("easy ease escreve os handles de 33% no lado pedido", () => {
    const base = property([keyframe("a", 0, [0, 0]), keyframe("b", 30, [10, 0])]);

    const both = applyEasyEase(base, "a");
    expect(both.keyframes[0]?.out).toEqual({ kind: "bezier", handle: [1 / 3, 0] });
    expect(both.keyframes[0]?.in).toEqual({ kind: "bezier", handle: [2 / 3, 1] });

    const outOnly = applyEasyEase(base, "a", "out");
    expect(outOnly.keyframes[0]?.out).toEqual({ kind: "bezier", handle: [1 / 3, 0] });
    expect(outOnly.keyframes[0]?.in).toEqual({ kind: "linear" });

    const inOnly = applyEasyEase(base, "b", "in");
    expect(inOnly.keyframes[1]?.in).toEqual({ kind: "bezier", handle: [2 / 3, 1] });
    expect(inOnly.keyframes[1]?.out).toEqual({ kind: "linear" });
  });

  it("easy ease não altera keyframe de outro id nem a entrada", () => {
    const base = property([keyframe("a", 0, [0, 0]), keyframe("b", 30, [10, 0])]);
    const result = applyEasyEase(base, "inexistente");
    expect(result.keyframes).toEqual(base.keyframes);
    expect(base.keyframes[0]?.out).toEqual({ kind: "linear" });
  });

  it("só keyframes interiores podem rovar", () => {
    const base = property([
      keyframe("a", 0, [0, 0]),
      keyframe("b", 10, [10, 0]),
      keyframe("c", 30, [30, 0]),
    ]);
    expect(setKeyframeRoving(base, "b", true).keyframes[1]?.roving).toBe(true);
    expect(setKeyframeRoving(base, "a", true).keyframes[0]?.roving).toBeUndefined();
    expect(setKeyframeRoving(base, "c", true).keyframes[2]?.roving).toBeUndefined();
  });

  it("redistribui o keyframe roving por distância e uniformiza a velocidade", () => {
    // Espaçamento errado de propósito: 90% da distância nos primeiros 25% do
    // tempo. Sem roving o objeto corre e depois se arrasta.
    const uneven = property([
      keyframe("a", 0, [0, 0]),
      keyframe("b", 15, [90, 0], true),
      keyframe("c", 60, [100, 0]),
    ]);
    const before = speedUniformity(uneven, 1, 59, 60);
    const roved = redistributeRovingKeyframes(uneven);
    const after = speedUniformity(roved, 1, 59, 60);

    expect(roved.keyframes[1]?.frame).toBe(54);
    expect(after.variation).toBeLessThan(before.variation);
    expect(after.variation).toBeLessThan(0.05);
    // Valores e ordem preservados; só o tempo mudou.
    expect(roved.keyframes.map((entry) => entry.value)).toEqual([
      [0, 0],
      [90, 0],
      [100, 0],
    ]);
    expect(uneven.keyframes[1]?.frame).toBe(15);
  });

  it("mantém frames estritamente crescentes quando muitos keyframes rovam junto", () => {
    const cluster = property([
      keyframe("a", 0, [0, 0]),
      keyframe("b", 1, [1, 0], true),
      keyframe("c", 2, [2, 0], true),
      keyframe("d", 3, [3, 0], true),
      keyframe("e", 4, [100, 0]),
    ]);
    const frames = redistributeRovingKeyframes(cluster).keyframes.map((entry) => entry.frame);
    expect(frames).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it("ignora trilhas sem roving, curtas ou não vetoriais", () => {
    const plain = property([keyframe("a", 0, [0, 0]), keyframe("b", 30, [10, 0])]);
    expect(redistributeRovingKeyframes(plain)).toBe(plain);

    const scalar: AnimatableProperty<number> = {
      value: 0,
      keyframes: [
        { id: "a", frame: 0, value: 0, in: { kind: "linear" }, out: { kind: "linear" } },
        {
          id: "b",
          frame: 10,
          value: 5,
          in: { kind: "linear" },
          out: { kind: "linear" },
          roving: true,
        },
        { id: "c", frame: 20, value: 9, in: { kind: "linear" }, out: { kind: "linear" } },
      ],
      expression: null,
    };
    expect(redistributeRovingKeyframes(scalar)).toBe(scalar);

    const degenerate = property([
      keyframe("a", 0, [5, 5]),
      keyframe("b", 5, [5, 5], true),
      keyframe("c", 10, [5, 5]),
    ]);
    expect(redistributeRovingKeyframes(degenerate)).toBe(degenerate);
  });
});
