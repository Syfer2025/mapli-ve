import type { AnimatableProperty, Keyframe } from "@theatrum/schema";
import { describe, expect, it } from "vitest";

import {
  applyEasingPreset,
  evaluateProperty,
  evaluatePropertyResult,
  keyframeSegment,
  moveKeyframe,
  removeKeyframe,
  setKeyframeEasing,
  upsertKeyframe,
} from "./property.js";

const linear = { kind: "linear" } as const;

function keyframe<T>(id: string, frame: number, value: T): Keyframe<T> {
  return { id, frame, value, in: linear, out: linear };
}

function property<T>(value: T, keyframes: Keyframe<T>[] = []): AnimatableProperty<T> {
  return { value, keyframes, expression: null };
}

describe("avaliação de propriedades", () => {
  it("usa valor estático e interpola número/vetor linearmente", () => {
    expect(evaluateProperty(property(7), 20)).toBe(7);
    expect(
      evaluateProperty(property(0, [keyframe("kf_a", 10, 10), keyframe("kf_b", 20, 30)]), 15),
    ).toBe(20);
    expect(
      evaluateProperty(
        property<[number, number]>(
          [0, 0],
          [keyframe("kf_a", 0, [0, 10]), keyframe("kf_b", 10, [20, 30])],
        ),
        5,
      ),
    ).toEqual([10, 20]);
  });

  it("segura hold, limita extremos e trata valores discretos", () => {
    const held = property(0, [
      { ...keyframe("kf_a", 0, 2), out: { kind: "hold" } },
      keyframe("kf_b", 10, 8),
    ]);
    expect(evaluateProperty(held, -1)).toBe(2);
    expect(evaluateProperty(held, 9)).toBe(2);
    expect(evaluateProperty(held, 10)).toBe(8);

    const discrete = property("a", [keyframe("kf_a", 0, "a"), keyframe("kf_b", 10, "b")]);
    expect(evaluateProperty(discrete, 5)).toBe("a");
  });

  it("interpola cores hex em OkLab, com extremos exatos e scrub reversível", () => {
    const fill = property("#ff0000", [
      keyframe("kf_a", 0, "#ff0000"),
      keyframe("kf_b", 10, "#0000ff"),
    ]);
    expect(evaluateProperty(fill, 0)).toBe("#ff0000");
    expect(evaluateProperty(fill, 10)).toBe("#0000ff");

    const middle = evaluateProperty(fill, 5);
    expect(middle).not.toBe("#ff0000");
    expect(middle).not.toBe("#0000ff");

    // Reavaliar — inclusive depois de percorrer o trilho inteiro — dá o
    // mesmo valor: é a garantia de scrub frente/trás sem deriva.
    for (let frame = 0; frame <= 10; frame++) evaluateProperty(fill, frame);
    expect(evaluateProperty(fill, 5)).toBe(middle);

    // Strings que não são cor continuam discretas.
    const discrete = property("a", [keyframe("kf_a", 0, "a"), keyframe("kf_b", 10, "b")]);
    expect(evaluateProperty(discrete, 5)).toBe("a");
  });

  it("avalia bezier deterministicamente e independente da ordem", () => {
    const eased = applyEasingPreset(
      property(0, [keyframe("kf_a", 0, 0), keyframe("kf_b", 100, 1)]),
      "kf_a",
      "easeInOut",
    );
    const direct = evaluateProperty(eased, 50);
    for (let frame = 0; frame <= 50; frame++) evaluateProperty(eased, frame);
    expect(evaluateProperty(eased, 50)).toBe(direct);
    expect(direct).toBeGreaterThan(0);
    expect(direct).toBeLessThan(1);
  });

  it("localiza segmento por busca binária", () => {
    const value = property(0, [
      keyframe("kf_0", 0, 0),
      keyframe("kf_1", 10, 1),
      keyframe("kf_2", 20, 2),
    ]);
    expect(keyframeSegment(value, 15)).toMatchObject({
      left: { id: "kf_1" },
      right: { id: "kf_2" },
      progress: 0.5,
    });
    expect(keyframeSegment(value, 20)).toBeNull();
  });

  it("aplica a expressão depois da interpolação de keyframes", () => {
    const animated = property(0, [keyframe("kf_a", 0, 10), keyframe("kf_b", 10, 30)]);
    animated.expression = "value * 2 + frame";
    expect(evaluateProperty(animated, 5)).toBe(45);

    const vector = property<[number, number]>([2, 4]);
    vector.expression = "value + [frame, -frame]";
    expect(evaluateProperty(vector, 3)).toEqual([5, 1]);
  });

  it("preserva expression null e devolve diagnósticos vazios", () => {
    const plain = property(7);
    const result = evaluatePropertyResult(plain, 20, "nodes.a.opacity");
    expect(result.value).toBe(7);
    expect(result.diagnostics).toEqual([]);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
  });

  it("recupera expressão inválida com o valor base e caminho estável", () => {
    const invalid = property(9);
    invalid.expression = "sqrt(-1)";
    expect(evaluatePropertyResult(invalid, 12, "nodes.a.rotation")).toEqual({
      value: 9,
      diagnostics: [
        expect.objectContaining({
          code: "expression.non-finite",
          propertyPath: "nodes.a.rotation",
        }),
      ],
    });

    const wrongShape = property<[number, number]>([1, 2]);
    wrongShape.expression = "42";
    expect(evaluatePropertyResult(wrongShape, 0).value).toEqual([1, 2]);
    expect(evaluatePropertyResult(wrongShape, 0).diagnostics[0]?.code).toBe("expression.type");
  });
});

describe("edição imutável de keyframes", () => {
  it("insere, substitui, move, remove e altera easing sem mutar a entrada", () => {
    const initial = property(0, [keyframe("kf_a", 0, 1), keyframe("kf_b", 10, 2)]);
    const snapshot = structuredClone(initial);
    const inserted = upsertKeyframe(initial, keyframe("kf_c", 5, 3));
    const moved = moveKeyframe(inserted, "kf_c", 7);
    const eased = setKeyframeEasing(moved, "kf_c", { out: { kind: "hold" } });
    const removed = removeKeyframe(eased, "kf_a");

    expect(initial).toEqual(snapshot);
    expect(inserted.keyframes.map(({ id }) => id)).toEqual(["kf_a", "kf_c", "kf_b"]);
    expect(moved.keyframes.map(({ frame }) => frame)).toEqual([0, 7, 10]);
    expect(eased.keyframes[1]?.out).toEqual({ kind: "hold" });
    expect(removed.keyframes.map(({ id }) => id)).toEqual(["kf_c", "kf_b"]);
  });

  it("substitui colisão de frame para manter unicidade", () => {
    const initial = property(0, [keyframe("kf_a", 0, 1), keyframe("kf_b", 10, 2)]);
    const replaced = upsertKeyframe(initial, keyframe("kf_c", 10, 9));
    expect(replaced.keyframes).toEqual([keyframe("kf_a", 0, 1), keyframe("kf_c", 10, 9)]);
  });
});
