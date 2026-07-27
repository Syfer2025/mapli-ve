import { createEmptyProjectDocument, type Keyframe } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import {
  buildTimelineModel,
  parsePropertyPath,
  readAnimatableProperty,
  type TimelineNodeTypeRegistry,
} from "./timeline-model.js";

const registry: TimelineNodeTypeRegistry = {
  get: () => ({
    properties: [
      {
        path: "transform.opacity",
        label: "Opacidade",
        group: "appearance",
        animatable: true,
      },
      {
        path: "transform.rotationReference",
        label: "Referência",
        group: "transform",
        animatable: false,
      },
    ],
  }),
};

describe("timeline model", () => {
  it("gera barras e trilhas animáveis exclusivamente pelos descriptors", () => {
    const document = createEmptyProjectDocument();
    const composition = document.compositions[0];
    const root = composition?.nodes[composition.root];
    expect(composition).toBeDefined();
    expect(root).toBeDefined();
    root?.transform.opacity.keyframes.push(keyframe("kf_10", 10), keyframe("kf_20", 20));

    const model = buildTimelineModel(composition!, registry, {
      expandedNodeIds: new Set([composition!.root]),
      selectedNodeIds: new Set([composition!.root]),
    });

    expect(model.tracks.map((track) => [track.kind, track.label])).toEqual([
      ["node", "Cena"],
      ["property", "Opacidade"],
    ]);
    expect(model.tracks[0]).toMatchObject({
      selected: true,
      timeRange: [0, 600],
    });
    expect(model.tracks[1]?.keyframes.map(({ id, frame }) => [id, frame])).toEqual([
      ["kf_10", 10],
      ["kf_20", 20],
    ]);
  });

  it("respeita shy, evita ciclos e anexa órfãos de forma estável", () => {
    const document = createEmptyProjectDocument();
    const composition = document.compositions[0]!;
    const root = composition.nodes[composition.root]!;
    const orphan = structuredClone(root);
    orphan.id = "nd_orphan";
    orphan.name = "Órfão";
    orphan.parent = "nd_missing";
    orphan.children = [];
    const shy = structuredClone(root);
    shy.id = "nd_shy";
    shy.name = "Oculto";
    shy.parent = root.id;
    shy.children = [root.id];
    shy.shy = true;
    root.children.push(shy.id);
    composition.nodes[orphan.id] = orphan;
    composition.nodes[shy.id] = shy;

    const model = buildTimelineModel(composition, registry, { hideShy: true });
    expect(model.tracks.map((track) => track.nodeId)).toEqual([root.id, orphan.id]);
  });

  it("resolve paths pontuados e JSON Pointer sem depender do tipo de nó", () => {
    const document = createEmptyProjectDocument();
    const root = document.compositions[0]!.nodes["nd_root"]!;

    expect(parsePropertyPath("transform.opacity")).toEqual(["transform", "opacity"]);
    expect(parsePropertyPath("/props/a~1b/~0value")).toEqual(["props", "a/b", "~value"]);
    expect(readAnimatableProperty(root, "transform.opacity")?.value).toBe(1);
    expect(readAnimatableProperty(root, "transform.rotationReference")).toBeUndefined();
  });
});

function keyframe(id: string, frame: number): Keyframe<number> {
  return {
    id,
    frame,
    value: frame / 100,
    in: { kind: "linear" },
    out: { kind: "linear" },
  };
}
