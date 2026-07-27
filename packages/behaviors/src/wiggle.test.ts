import type { Node } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import type { BehaviorContext } from "./contracts.js";
import { fractalNoise, valueNoise, wiggleBehavior, WIGGLE_DEFAULTS } from "./wiggle.js";

const context: BehaviorContext = {
  fps: 60,
  path: () => undefined,
  sampleNode: () => undefined,
};

function node(id = "nd_flag"): Node {
  return {
    id,
    type: "text.label",
    name: "Rótulo",
    parent: null,
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "none",
    timeRange: { in: 0, out: 600 },
    timeRemap: null,
    anchor: { space: "comp", position: [100, 100] },
    size: { mode: "screen", size: [240, 52] },
    transform: {
      position: { value: [0, 0], keyframes: [], expression: null },
      rotation: { value: 0, keyframes: [], expression: null },
      scale: { value: [1, 1], keyframes: [], expression: null },
      opacity: { value: 1, keyframes: [], expression: null },
      anchorPoint: { value: [0.5, 0.5], keyframes: [], expression: null },
      skew: { value: [0, 0], keyframes: [], expression: null },
      rotationReference: "screen",
    },
    blendMode: "normal",
    trackMatte: null,
    motionBlur: false,
    props: {},
    effects: [],
    behaviors: [],
    actions: [],
  };
}

describe("wiggle", () => {
  it("é determinístico por nó, semente e frame", () => {
    const first = wiggleBehavior.contribute(node(), WIGGLE_DEFAULTS, 42, context);
    const again = wiggleBehavior.contribute(node(), WIGGLE_DEFAULTS, 42, context);
    expect(again).toEqual(first);

    const otherFrame = wiggleBehavior.contribute(node(), WIGGLE_DEFAULTS, 43, context);
    expect(otherFrame).not.toEqual(first);

    const otherNode = wiggleBehavior.contribute(node("nd_outro"), WIGGLE_DEFAULTS, 42, context);
    expect(otherNode).not.toEqual(first);

    const otherSeed = wiggleBehavior.contribute(
      node(),
      { ...WIGGLE_DEFAULTS, seed: 7 },
      42,
      context,
    );
    expect(otherSeed).not.toEqual(first);
  });

  it("soma deslocamento em vez de substituir a posição", () => {
    const contribution = wiggleBehavior.contribute(node(), WIGGLE_DEFAULTS, 42, context);
    expect(contribution.position).toBeUndefined();
    expect(contribution.anchor).toBeUndefined();
    expect(contribution.positionOffset).toBeDefined();
  });

  it("respeita a amplitude em todos os frames de um segundo", () => {
    for (let frame = 0; frame <= 60; frame += 1) {
      const offset = wiggleBehavior.contribute(
        node(),
        { ...WIGGLE_DEFAULTS, amplitude: [10, 4] },
        frame,
        context,
      ).positionOffset;
      expect(Math.abs(offset?.[0] ?? 0)).toBeLessThanOrEqual(10);
      expect(Math.abs(offset?.[1] ?? 0)).toBeLessThanOrEqual(4);
    }
  });

  it("oscila de fato e é contínuo entre frames vizinhos", () => {
    const samples = Array.from(
      { length: 61 },
      (_unused, frame) =>
        wiggleBehavior.contribute(node(), { ...WIGGLE_DEFAULTS, octaves: 1 }, frame, context)
          .positionOffset?.[0] ?? 0,
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(1);
    const jumps = samples.slice(1).map((value, index) => Math.abs(value - (samples[index] ?? 0)));
    // A 2 Hz e 60 fps, um passo de frame não pode dar salto grande.
    expect(Math.max(...jumps)).toBeLessThan(2);
  });

  it("rotação só entra quando pedida", () => {
    expect(
      wiggleBehavior.contribute(node(), WIGGLE_DEFAULTS, 10, context).rotationOffset,
    ).toBeUndefined();
    const rotating = wiggleBehavior.contribute(
      node(),
      { ...WIGGLE_DEFAULTS, rotationAmplitude: 8 },
      10,
      context,
    );
    expect(Math.abs(rotating.rotationOffset ?? 0)).toBeLessThanOrEqual(8);
  });

  it("ruído fica na faixa [-1, 1] e é contínuo na fronteira das células", () => {
    for (let step = 0; step <= 200; step += 1) {
      const value = valueNoise(12345, 0, step / 7);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
    const before = valueNoise(12345, 0, 3 - 1e-9);
    const after = valueNoise(12345, 0, 3 + 1e-9);
    expect(Math.abs(after - before)).toBeLessThan(1e-6);
    expect(fractalNoise(1, 0, 0.5, 3)).toBe(fractalNoise(1, 0, 0.5, 3));
  });
});
