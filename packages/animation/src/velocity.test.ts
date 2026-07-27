import type { AnimatableProperty, Keyframe } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { propertySpeed, sampleSpeedCurve, speedUniformity } from "./velocity.js";

function linearKeyframe<T>(id: string, frame: number, value: T): Keyframe<T> {
  return { id, frame, value, in: { kind: "linear" }, out: { kind: "linear" } };
}

function track<T>(value: T, keyframes: readonly Keyframe<T>[]): AnimatableProperty<T> {
  return { value, keyframes: [...keyframes], expression: null };
}

describe("curvas de velocidade", () => {
  it("keyframes lineares dão velocidade constante", () => {
    const opacity = track(1, [linearKeyframe("a", 0, 0), linearKeyframe("b", 60, 1)]);
    // 1 unidade em 60 frames a 60 fps = 1 unidade por segundo.
    expect(propertySpeed(opacity, 30, 60)).toBeCloseTo(1, 10);
    const uniformity = speedUniformity(opacity, 1, 59, 60);
    expect(uniformity.variation).toBeCloseTo(0, 10);
    expect(uniformity.mean).toBeCloseTo(1, 10);
  });

  it("easing bezier produz velocidade variável com pico no meio", () => {
    const eased = track(0, [
      { ...linearKeyframe("a", 0, 0), out: { kind: "bezier", handle: [0.42, 0] } },
      { ...linearKeyframe("b", 60, 1), in: { kind: "bezier", handle: [0.58, 1] } },
    ]);
    const middle = propertySpeed(eased, 30, 60);
    const start = propertySpeed(eased, 2, 60);
    const end = propertySpeed(eased, 58, 60);
    expect(middle).toBeGreaterThan(start);
    expect(middle).toBeGreaterThan(end);
    expect(speedUniformity(eased, 1, 59, 60).variation).toBeGreaterThan(0.2);
  });

  it("hold trava o valor e zera a velocidade no interior do trecho", () => {
    const held = track(0, [
      { ...linearKeyframe("a", 0, 0), out: { kind: "hold" } },
      linearKeyframe("b", 30, 10),
    ]);
    expect(propertySpeed(held, 15, 60)).toBe(0);
  });

  it("em posição usa a magnitude do vetor", () => {
    const position = track<readonly [number, number]>(
      [0, 0],
      [linearKeyframe("a", 0, [0, 0] as const), linearKeyframe("b", 30, [30, 40] as const)],
    );
    // 50 px em 30 frames a 30 fps = 50 px/s.
    expect(propertySpeed(position, 15, 30)).toBeCloseTo(50, 8);
  });

  it("a amostragem cobre o intervalo fechado e é independente da ordem", () => {
    const opacity = track(0, [linearKeyframe("a", 0, 0), linearKeyframe("b", 10, 1)]);
    const forward = sampleSpeedCurve(opacity, 0, 10, 60);
    expect(forward).toHaveLength(11);
    expect(forward.at(-1)?.frame).toBe(10);

    const reversed = [...Array.from({ length: 11 }, (_unused, index) => 10 - index)].map((frame) =>
      propertySpeed(opacity, frame, 60),
    );
    expect(reversed.reverse()).toEqual(forward.map((sample) => sample.speed));
  });

  it("entradas degeneradas devolvem zero em vez de NaN", () => {
    const empty = track(0, []);
    expect(propertySpeed(empty, 5, 60)).toBe(0);
    expect(propertySpeed(track(0, [linearKeyframe("a", 0, 0)]), 5, 0)).toBe(0);
    expect(sampleSpeedCurve(empty, 10, 0, 60)).toHaveLength(0);
    expect(speedUniformity(empty, 10, 0, 60).variation).toBe(0);
    const text = track("a", [linearKeyframe("a", 0, "a"), linearKeyframe("b", 10, "b")]);
    expect(propertySpeed(text, 5, 60)).toBe(0);
  });
});
