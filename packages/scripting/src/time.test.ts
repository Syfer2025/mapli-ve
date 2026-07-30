import type { SceneTimelineEntry } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import {
  parseAbsoluteSceneTime,
  parseSceneTime,
  resolveTimelineTimes,
  type SceneDiagnostic,
} from "./index.js";

const context = { fps: 60, durationFrames: 5_400 };

describe("tempo Scene Script", () => {
  it.each([
    [4, 240],
    ["500ms", 30],
    ["90f", 90],
    ["1m30s", 5_400],
    ["1:30", 5_400],
    ["00:01:30:15", 5_415],
    ["end-4s", 5_160],
  ] as const)("converte %s em frames", (value, expected) => {
    expect(parseSceneTime(value, context)?.frames).toBe(expected);
  });

  it("resolve after/with fora de ordem", () => {
    const entries: SceneTimelineEntry[] = [
      { at: "after:intro+2s", do: "marker", label: "depois" },
      { at: "with:intro", do: "marker", label: "junto" },
      { at: "3s", id: "intro", do: "wait", duration: "4s" },
    ];
    const diagnostics: SceneDiagnostic[] = [];
    const resolved = resolveTimelineTimes(entries, context, diagnostics);

    expect(diagnostics).toEqual([]);
    expect(resolved.map(({ index, startFrame }) => [index, startFrame])).toEqual([
      [1, 180],
      [2, 180],
      [0, 540],
    ]);
  });

  it("não aceita tempo relativo onde uma duração absoluta é exigida", () => {
    expect(parseAbsoluteSceneTime("after:intro", context)).toBeNull();
    expect(parseAbsoluteSceneTime("end-4s", context)).toBeNull();
  });

  it("detecta ciclos relativos", () => {
    const entries: SceneTimelineEntry[] = [
      { at: "after:b", id: "a", do: "marker", label: "A" },
      { at: "after:a", id: "b", do: "marker", label: "B" },
    ];
    const diagnostics: SceneDiagnostic[] = [];
    resolveTimelineTimes(entries, context, diagnostics);

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "time-cycle" }));
  });
});
