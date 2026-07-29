import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enterTimelineComposition,
  getTimelineSessionState,
  resetTimelineSessionState,
  subscribeTimelineSessionState,
  updateTimelineSessionState,
} from "./timeline-session-state.js";

afterEach(() => {
  resetTimelineSessionState();
});

describe("estado de sessão da Timeline", () => {
  it("preserva zoom, rolagem e expansão de Mapa e Palco separadamente", () => {
    enterTimelineComposition("map", "cmp_a", ["nd_root"]);
    enterTimelineComposition("studio", "cmp_a", ["nd_stage"]);

    updateTimelineSessionState("map", (current) => ({
      ...current,
      view: { startFrame: 45, pixelsPerFrame: 5 },
      scrollY: 88,
      expandedNodeIds: new Set([...current.expandedNodeIds, "nd_map"]),
    }));
    updateTimelineSessionState("studio", (current) => ({
      ...current,
      view: { startFrame: 120, pixelsPerFrame: 9 },
      scrollY: 22,
      expandedNodeIds: new Set([...current.expandedNodeIds, "nd_poi"]),
    }));

    expect(getTimelineSessionState("map")).toMatchObject({
      compositionId: "cmp_a",
      view: { startFrame: 45, pixelsPerFrame: 5 },
      scrollY: 88,
    });
    expect([...getTimelineSessionState("map").expandedNodeIds]).toEqual(["nd_root", "nd_map"]);
    expect(getTimelineSessionState("studio")).toMatchObject({
      compositionId: "cmp_a",
      view: { startFrame: 120, pixelsPerFrame: 9 },
      scrollY: 22,
    });
    expect([...getTimelineSessionState("studio").expandedNodeIds]).toEqual(["nd_stage", "nd_poi"]);
  });

  it("reseta só o modo que entrou em outra composição", () => {
    enterTimelineComposition("map", "cmp_a", ["root_a"]);
    enterTimelineComposition("studio", "cmp_a", ["stage_a"]);
    updateTimelineSessionState("studio", (current) => ({
      ...current,
      view: { startFrame: 90, pixelsPerFrame: 4 },
    }));

    enterTimelineComposition("map", "cmp_b", ["root_b"]);

    expect(getTimelineSessionState("map")).toMatchObject({
      compositionId: "cmp_b",
      view: { startFrame: 0, pixelsPerFrame: 2 },
      scrollY: 0,
    });
    expect([...getTimelineSessionState("map").expandedNodeIds]).toEqual(["root_b"]);
    expect(getTimelineSessionState("studio").view).toEqual({
      startFrame: 90,
      pixelsPerFrame: 4,
    });
  });

  it("não emite quando a atualização é estruturalmente idêntica", () => {
    enterTimelineComposition("map", "cmp_a", ["root"]);
    const listener = vi.fn();
    const unsubscribe = subscribeTimelineSessionState(listener);

    updateTimelineSessionState("map", (current) => ({
      ...current,
      expandedNodeIds: new Set(current.expandedNodeIds),
    }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
