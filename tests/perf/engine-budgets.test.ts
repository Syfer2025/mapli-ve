import { evaluate } from "@theatrum/animation";
import { createDocumentStore } from "@theatrum/document";
import { layoutScene, type ProjectorPortLike } from "@theatrum/scene-graph";
import { createEmptyProjectDocument, type Node, type ProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";

const NODE_COUNT = 500;
const KEYFRAMES_PER_NODE = 10;

describe("orçamentos do motor", () => {
  const document = syntheticDocument();
  const compositionId = document.compositions[0]?.id ?? "";
  const projector = identityProjector();

  it("avalia 500 nós e 5.000 keyframes em menos de 2 ms na mediana", () => {
    for (let warmup = 0; warmup < 20; warmup += 1) evaluate(document, compositionId, 275);
    const medianMs = median(
      Array.from({ length: 80 }, () => timed(() => evaluate(document, compositionId, 275))),
    );
    expect(medianMs).toBeLessThan(2);
  });

  it("resolve o layout de 500 nós em menos de 1 ms na mediana", () => {
    const scene = evaluate(document, compositionId, 275);
    for (let warmup = 0; warmup < 20; warmup += 1) layoutScene(scene, projector);
    const medianMs = median(
      Array.from({ length: 80 }, () => timed(() => layoutScene(scene, projector))),
    );
    expect(medianMs).toBeLessThan(1);
  });
});

function syntheticDocument(): ProjectDocument {
  const document = structuredClone(
    createEmptyProjectDocument({
      id: "prj_perf",
      compositionId: "cmp_perf",
      rootNodeId: "nd_perf_root",
      settings: { defaultFps: 60, defaultResolution: [1920, 1080] },
    }),
  );
  const composition = document.compositions[0];
  if (composition === undefined) throw new Error("composição de performance ausente");
  const root = composition.nodes[composition.root];
  if (root === undefined) throw new Error("raiz de performance ausente");

  for (let index = 0; index < NODE_COUNT; index += 1) {
    const id = `nd_perf_${String(index).padStart(4, "0")}`;
    const node = perfNode(id, root.id, index);
    composition.nodes[id] = node;
    root.children.push(id);
  }
  // É a forma real do documento em produção: validado e profundamente
  // congelado. Isso também habilita caches seguros por identidade.
  return createDocumentStore(document).get();
}

function perfNode(id: string, parent: string, index: number): Node {
  return {
    id,
    type: "shape.circle",
    name: id,
    parent,
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "none",
    timeRange: { in: 0, out: 600 },
    timeRemap: null,
    anchor: { space: "comp", position: [index % 25, Math.floor(index / 25)] },
    size: { mode: "screen", size: [20, 20] },
    transform: {
      position: {
        value: [0, 0],
        keyframes: Array.from({ length: KEYFRAMES_PER_NODE }, (_, keyframe) => ({
          id: `${id}_kf_${keyframe}`,
          frame: keyframe * 60,
          value: [index + keyframe, keyframe * 2],
          in: { kind: "linear" as const },
          out: { kind: "linear" as const },
        })),
        expression: null,
      },
      rotation: animatable(0),
      scale: animatable([1, 1]),
      opacity: animatable(1),
      anchorPoint: animatable([0.5, 0.5]),
      skew: animatable([0, 0]),
      rotationReference: "screen",
    },
    blendMode: "normal",
    trackMatte: null,
    motionBlur: false,
    props: {
      radius: animatable(10),
      fill: animatable("#38bdf8ff"),
      fillAlpha: animatable(1),
      stroke: animatable("#ffffffff"),
      strokeWidth: animatable(1),
    },
    effects: [],
    behaviors: [],
    actions: [],
  };
}

function identityProjector(): ProjectorPortLike<"perf"> {
  return {
    project: ([x, y]) => [x, y],
    unproject: ([x, y]) => [x, y],
    metersPerPixel: () => 1,
    bearingToScreenAngle: (degrees) => degrees,
    elevationAt: () => 0,
    snapshot: () => "perf",
  };
}

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}

function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}
