import type { Node } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import type { BehaviorContext, NodeSample } from "./contracts.js";
import { followBehavior, type FollowParams } from "./follow.js";

/** Alvo que anda em linha reta em espaço comp: posição = frame. */
function movingTarget(fps = 60): { context: BehaviorContext; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    context: {
      fps,
      path: () => undefined,
      sampleNode: (nodeId, frame): NodeSample | undefined => {
        calls.push(frame);
        if (nodeId !== "nd_target") return undefined;
        return { space: "comp", point: [frame, 0], rotation: frame };
      },
    },
  };
}

function node(id = "nd_jet"): Node {
  return {
    id,
    type: "unit.armor",
    name: "Caça",
    parent: null,
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "cyan",
    timeRange: { in: 0, out: 600 },
    timeRemap: null,
    anchor: { space: "comp", position: [0, 0] },
    size: { mode: "screen", size: [32, 32] },
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

function params(overrides: Partial<FollowParams> = {}): FollowParams {
  return {
    targetId: "nd_target",
    offset: [0, 0],
    damping: 0.5,
    matchRotation: false,
    windowFrames: 12,
    ...overrides,
  };
}

function positionAt(frame: number, overrides: Partial<FollowParams> = {}): [number, number] {
  const { context } = movingTarget();
  const contribution = followBehavior.contribute(node(), params(overrides), frame, context);
  const anchor = contribution.anchor;
  if (anchor === undefined || anchor.space !== "comp") throw new Error("âncora comp esperada");
  return [anchor.position[0], anchor.position[1]];
}

describe("follow", () => {
  it("damping 0 cola no alvo e lê um único frame", () => {
    const { context, calls } = movingTarget();
    const contribution = followBehavior.contribute(node(), params({ damping: 0 }), 100, context);
    expect(contribution.anchor).toEqual({ space: "comp", position: [100, 0] });
    // Uma amostra da janela mais a leitura do espaço do alvo.
    expect(new Set(calls)).toEqual(new Set([100]));
  });

  it("damping arrasta a posição para trás do alvo, sem passar da janela", () => {
    const followed = positionAt(100, { damping: 0.5, windowFrames: 12 });
    expect(followed[0]).toBeLessThan(100);
    expect(followed[0]).toBeGreaterThan(100 - 12);
    // Mais damping, mais atraso.
    expect(positionAt(100, { damping: 0.9 })[0]).toBeLessThan(followed[0]);
  });

  it("é idêntico avaliando frames fora de ordem", () => {
    const frames = [10, 200, 55, 1, 199, 56];
    const forward = frames.map((frame) => positionAt(frame));
    const shuffled = [...frames].reverse().map((frame) => positionAt(frame));
    expect(shuffled.reverse()).toEqual(forward);

    // E repetir o mesmo frame duas vezes dá o mesmo valor.
    expect(positionAt(123)).toEqual(positionAt(123));
  });

  it("aplica offset depois da suavização", () => {
    const base = positionAt(100, { damping: 0.5 });
    const shifted = positionAt(100, { damping: 0.5, offset: [10, -5] });
    expect(shifted[0]).toBeCloseTo(base[0] + 10, 9);
    expect(shifted[1]).toBeCloseTo(base[1] - 5, 9);
  });

  it("matchRotation faz média angular pela janela", () => {
    const { context } = movingTarget();
    const contribution = followBehavior.contribute(
      node(),
      params({ matchRotation: true, damping: 0.5 }),
      100,
      context,
    );
    expect(contribution.rotation).toBeLessThan(100);
    expect(contribution.rotationReference).toBe("screen");
  });

  it("recusa seguir a si mesmo e reporta alvo ausente", () => {
    const { context } = movingTarget();
    const selfFollow = followBehavior.contribute(node("nd_target"), params(), 10, context);
    expect(selfFollow.diagnostic).toContain("si mesmo");

    const missing = followBehavior.contribute(
      node(),
      params({ targetId: "nd_ausente" }),
      10,
      context,
    );
    expect(missing.anchor).toBeUndefined();
    expect(missing.diagnostic).toContain("nd_ausente");
  });
});
