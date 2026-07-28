import type { EvaluatedScene } from "@theatrum/animation";
import type { ActionExpansion } from "@theatrum/behaviors";
import { describe, expect, it } from "vitest";
import { activeActionCameraCenter } from "./action-camera.js";

function evaluated(frame: number): EvaluatedScene {
  return {
    compositionId: "cmp",
    frame,
    camera: {
      center: [56.2, 26.5],
      zoom: 7,
      bearing: 0,
      pitch: 45,
      roll: 0,
      fov: 45,
    },
    nodes: new Map(),
    drawOrder: [],
  };
}

function expansion(frames: readonly number[]): ActionExpansion {
  return {
    actionId: "act",
    type: "bombard",
    durationFrames: 180,
    behaviors: [],
    nodes: [],
    diagnostics: [],
    keyframes: frames.map((frame, index) => ({
      target: { kind: "camera" },
      path: ["center"],
      keyframe: {
        id: `shake:${index}`,
        frame,
        value: [56.2, 26.5],
        in: { kind: "linear" },
        out: { kind: "linear" },
        hold: false,
        roving: false,
      },
    })),
  };
}

describe("câmera de Action no mapa", () => {
  it("só dirige o mapa durante a faixa do tremor", () => {
    const actions = [expansion([40, 41, 43])];
    expect(activeActionCameraCenter(evaluated(39), actions)).toBeNull();
    expect(activeActionCameraCenter(evaluated(40), actions)).toEqual([56.2, 26.5]);
    expect(activeActionCameraCenter(evaluated(43), actions)).toEqual([56.2, 26.5]);
    expect(activeActionCameraCenter(evaluated(44), actions)).toBeNull();
  });

  it("não interfere quando a Action não escreve câmera", () => {
    expect(activeActionCameraCenter(evaluated(40), [expansion([])])).toBeNull();
  });
});
