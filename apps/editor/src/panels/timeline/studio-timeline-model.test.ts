import { createBuiltinNodeTypeRegistry } from "@theatrum/scene-graph";
import {
  createEmptyProjectDocument,
  type AnimatableProperty,
  type Composition,
  type Node,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { STUDIO_CAMERA_PROPERTY_PATHS } from "../viewport/studio-tour.js";
import { buildStudioTimelineProjection } from "./studio-timeline-model.js";

const registry = createBuiltinNodeTypeRegistry();

describe("projeção da Timeline do Palco", () => {
  it("fica explicitamente vazia sem palco e nunca recua para camadas do Mapa", () => {
    const composition = createEmptyProjectDocument().compositions[0]!;
    appendNode(composition, "nd_country", "geo.region", "País");

    const projection = buildStudioTimelineProjection(composition, registry);

    expect(projection.stageNodeId).toBeNull();
    expect(projection.diagnostic).toContain("Sem palco");
    expect(projection.model.tracks).toEqual([]);
  });

  it("mostra só câmera, guia e POIs, na ordem topológica", () => {
    const composition = createEmptyProjectDocument().compositions[0]!;
    appendNode(composition, "nd_country", "geo.region", "País");
    const poiB = appendNode(composition, "nd_poi_b", "studio.poi", "Cauda");
    const stage = appendNode(composition, "nd_stage", "studio.stage", "Palco principal");
    const poiA = appendNode(composition, "nd_poi_a", "studio.poi", "Cabine");
    appendNode(composition, "nd_label", "text.label", "Rótulo do mapa");
    setNumber(stage, "tourStartFrame", 10);
    setNumber(stage, "tourTravelFrames", 20);
    setNumber(stage, "tourHoldFrames", 30);

    const projection = buildStudioTimelineProjection(composition, registry, {
      expandedNodeIds: new Set([stage.id, poiA.id, poiB.id]),
    });

    const nodeTracks = projection.model.tracks.filter((track) => track.kind === "node");
    expect(nodeTracks.map((track) => [track.nodeId, track.label])).toEqual([
      [stage.id, "Palco principal"],
      [poiB.id, "Cauda"],
      [poiA.id, "Cabine"],
    ]);
    expect(
      projection.model.tracks
        .filter((track) => track.kind === "property" && track.nodeId === stage.id)
        .map((track) => track.propertyPath),
    ).toEqual(STUDIO_CAMERA_PROPERTY_PATHS);
    expect(projection.model.tracks.some((track) => track.nodeId === "nd_country")).toBe(false);
    expect(projection.model.tracks.some((track) => track.nodeId === "nd_label")).toBe(false);

    const guide = projection.model.tracks.find((track) => track.kind === "guide");
    expect(guide?.label).toBe("Roteiro previsto");
    expect(guide?.keyframes).toEqual([]);
    expect(guide?.cues).toEqual([
      {
        id: "tour-cue:nd_poi_b",
        nodeId: "nd_poi_b",
        label: "Cauda",
        ordinal: 1,
        arrivalFrame: 10,
        departureFrame: 40,
      },
      {
        id: "tour-cue:nd_poi_a",
        nodeId: "nd_poi_a",
        label: "Cabine",
        ordinal: 2,
        arrivalFrame: 60,
        departureFrame: 90,
      },
    ]);
  });

  it("mantém POI desligado editável, mas o remove da agenda prevista", () => {
    const composition = createEmptyProjectDocument().compositions[0]!;
    const stage = appendNode(composition, "nd_stage", "studio.stage", "Palco");
    const disabled = appendNode(composition, "nd_disabled", "studio.poi", "Oculto");
    disabled.enabled = false;
    const enabled = appendNode(composition, "nd_enabled", "studio.poi", "Visível");

    const projection = buildStudioTimelineProjection(composition, registry, {
      expandedNodeIds: new Set([stage.id]),
    });

    expect(
      projection.model.tracks.filter((track) => track.kind === "node").map((track) => track.nodeId),
    ).toEqual([stage.id, disabled.id, enabled.id]);
    expect(projection.model.tracks.find((track) => track.kind === "guide")?.cues).toEqual([
      expect.objectContaining({ nodeId: enabled.id, ordinal: 1 }),
    ]);
  });

  it("não põe a guia no hit semântico de keyframes", () => {
    const composition = createEmptyProjectDocument().compositions[0]!;
    const stage = appendNode(composition, "nd_stage", "studio.stage", "Palco");
    appendNode(composition, "nd_poi", "studio.poi", "Míssil");
    const targetX = stage.props["targetX"] as AnimatableProperty<number>;
    targetX.keyframes.push({
      id: "kf_camera",
      frame: 30,
      value: 5,
      in: { kind: "linear" },
      out: { kind: "linear" },
    });

    const projection = buildStudioTimelineProjection(composition, registry, {
      expandedNodeIds: new Set([stage.id]),
    });
    const guide = projection.model.tracks.find((track) => track.kind === "guide");
    const cameraTrack = projection.model.tracks.find(
      (track) => track.kind === "property" && track.propertyPath === "props.targetX",
    );

    expect(guide?.cues).toHaveLength(1);
    expect(guide?.keyframes).toEqual([]);
    expect(cameraTrack?.keyframes.map((keyframe) => keyframe.id)).toEqual(["kf_camera"]);
  });
});

function appendNode(composition: Composition, id: string, type: string, name: string): Node {
  const root = composition.nodes[composition.root]!;
  const node: Node = {
    ...structuredClone(root),
    id,
    type,
    name,
    parent: root.id,
    children: [],
    props: registry.createDefaultProps(type),
  };
  root.children.push(id);
  composition.nodes[id] = node;
  return node;
}

function setNumber(node: Node, key: string, value: number): void {
  const property = node.props[key] as AnimatableProperty<number>;
  property.value = value;
}
