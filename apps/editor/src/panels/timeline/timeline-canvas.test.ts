import { describe, expect, it } from "vitest";
import {
  buildTimelineHitIndex,
  frameToX,
  renderTimeline,
  snapFrame,
  xToFrame,
  zoomAroundPoint,
  type TimelineCanvasContext,
  type TimelineViewport,
} from "./timeline-canvas.js";
import type { TimelineKeyframe, TimelineModel, TimelineTrack } from "./timeline-model.js";

describe("timeline canvas", () => {
  it("converte tempo, preserva o frame sob o cursor no zoom e limita a escala", () => {
    const viewport = { startFrame: 100, pixelsPerFrame: 2 };
    expect(frameToX(125, viewport)).toBe(50);
    expect(xToFrame(50, viewport)).toBe(125);

    const zoomed = zoomAroundPoint(viewport, 2, 80);
    expect(zoomed.pixelsPerFrame).toBe(4);
    expect(xToFrame(80, zoomed)).toBe(140);
    expect(zoomAroundPoint(viewport, 100, 0).pixelsPerFrame).toBe(80);
  });

  it("aplica snap determinístico em keyframes, marcadores, work area e frames inteiros", () => {
    const model = syntheticModel(2, 6);
    expect(snapFrame(19.7, model, 10)).toBe(20);
    expect(snapFrame(49.6, model, 10)).toBe(50);
    expect(snapFrame(73.49, model, 10)).toBe(73);
    expect(snapFrame(20.1, model, 10, 6, "kf_0_1")).toBe(20);
  });

  it("faz culling, desenha e indexa somente keyframes visíveis", () => {
    const model = syntheticModel(20, 20);
    const viewport: TimelineViewport = {
      width: 100,
      height: 68,
      startFrame: 10,
      pixelsPerFrame: 2,
      scrollY: 22 * 5,
    };
    const context = noOpContext();
    const stats = renderTimeline(context, model, viewport, 25);
    const hits = buildTimelineHitIndex(model, viewport);

    expect(stats.tracksDrawn).toBeLessThanOrEqual(4);
    expect(stats.tracksDrawn).toBeGreaterThan(0);
    expect(stats.keyframesDrawn).toBeLessThan(stats.keyframesVisited);
    expect(hits.hitTest(20, 35, 20)).not.toBeNull();
    expect(hits.hitTest(-500, -500)).toBeNull();
  });

  it("desenha e faz snap na guia, mas nunca a põe no hit-test de keyframe", () => {
    const base = syntheticModel(1, 1);
    const guide: TimelineTrack = {
      id: "guide:stage:tour",
      kind: "guide",
      nodeId: "stage",
      propertyPath: null,
      label: "Roteiro previsto",
      depth: 0,
      enabled: true,
      locked: true,
      selected: false,
      labelColor: "#c9963f",
      timeRange: [10, 90],
      keyframes: [],
      cues: [
        {
          id: "cue:a",
          nodeId: "a",
          label: "Cabine",
          ordinal: 1,
          arrivalFrame: 10,
          departureFrame: 40,
        },
        {
          id: "cue:b",
          nodeId: "b",
          label: "Míssil",
          ordinal: 2,
          arrivalFrame: 60,
          departureFrame: 90,
        },
      ],
    };
    const model: TimelineModel = { ...base, tracks: [...base.tracks, guide] };
    const viewport: TimelineViewport = {
      width: 200,
      height: 80,
      startFrame: 0,
      pixelsPerFrame: 2,
      scrollY: 0,
    };

    const stats = renderTimeline(noOpContext(), model, viewport, 0);
    const hits = buildTimelineHitIndex(model, viewport);

    expect(stats.cuesDrawn).toBe(2);
    expect(snapFrame(59.7, model, 10)).toBe(60);
    expect(hits.hitTest(120, 57, 8)).toBeNull();
  });

  it("redesenha logicamente 200 trilhas e 3000 keyframes abaixo de 4 ms no p95", () => {
    const model = syntheticModel(200, 15);
    const viewport: TimelineViewport = {
      width: 6_000,
      height: 24 + 200 * 22,
      startFrame: 0,
      pixelsPerFrame: 3,
      scrollY: 0,
    };
    const context = noOpContext();

    for (let warmup = 0; warmup < 10; warmup += 1) {
      renderTimeline(context, model, viewport, warmup);
    }

    const samples: number[] = [];
    for (let sample = 0; sample < 40; sample += 1) {
      const started = performance.now();
      const stats = renderTimeline(context, model, viewport, sample);
      samples.push(performance.now() - started);
      expect(stats.keyframesDrawn).toBe(3_000);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(4);
  });
});

function syntheticModel(trackCount: number, keyframesPerTrack: number): TimelineModel {
  const tracks: TimelineTrack[] = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    const keyframes: TimelineKeyframe[] = [];
    for (let keyframeIndex = 0; keyframeIndex < keyframesPerTrack; keyframeIndex += 1) {
      keyframes.push({
        id: `kf_${trackIndex}_${keyframeIndex}`,
        nodeId: `nd_${trackIndex}`,
        propertyPath: "transform.opacity",
        frame: keyframeIndex * 20,
        easing: keyframeIndex % 3 === 0 ? "bezier" : "linear",
      });
    }
    tracks.push({
      id: `property:nd_${trackIndex}:transform.opacity`,
      kind: "property",
      nodeId: `nd_${trackIndex}`,
      propertyPath: "transform.opacity",
      label: `Opacidade ${trackIndex}`,
      depth: 1,
      enabled: true,
      locked: false,
      selected: false,
      labelColor: "blue",
      timeRange: [0, 1_200],
      keyframes,
      cues: [],
    });
  }
  return {
    duration: 1_200,
    fps: 60,
    workArea: [0, 1_200],
    markers: [{ frame: 50, label: "Marco", color: "#c9963f" }],
    tracks,
  };
}

function noOpContext(): TimelineCanvasContext {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textBaseline: "top",
    beginPath: noOp,
    closePath: noOp,
    moveTo: noOp,
    lineTo: noOp,
    rect: noOp,
    clip: noOp,
    fill: noOp,
    stroke: noOp,
    fillRect: noOp,
    fillText: noOp,
    save: noOp,
    restore: noOp,
  };
}

function noOp(): void {
  // Contexto lógico: mede o pipeline, o culling e a iteração, não rasterização nativa.
}
