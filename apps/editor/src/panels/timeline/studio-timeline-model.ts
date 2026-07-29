import { topologicalOrder } from "@theatrum/scene-graph";
import type { Composition } from "@theatrum/schema";
import {
  buildStudioTourSchedule,
  documentStudioPois,
  documentStudioTourTiming,
  STUDIO_CAMERA_PROPERTY_PATHS,
  type TourSchedule,
  type TourStop,
} from "../viewport/studio-tour.js";
import {
  buildTimelineModel,
  type BuildTimelineOptions,
  type TimelineModel,
  type TimelineNodeTypeRegistry,
  type TimelineTrack,
} from "./timeline-model.js";

const CAMERA_PATHS = new Set<string>(STUDIO_CAMERA_PROPERTY_PATHS);
const EMPTY_TRACKS: readonly TimelineTrack[] = Object.freeze([]);

export interface StudioTimelineProjection {
  readonly model: TimelineModel;
  readonly stageNodeId: string | null;
  readonly diagnostic: string | null;
}

/**
 * Projeção semântica da Timeline do Palco.
 *
 * Reaproveita o construtor genérico para descriptors e keyframes; este módulo
 * apenas seleciona e ordena o que pertence ao contexto do Palco
 * ([ADR-019](../../../../../docs/adr/ADR-019-studio-aware-timeline.md)).
 */
export function buildStudioTimelineProjection(
  composition: Composition,
  registry: TimelineNodeTypeRegistry,
  options: BuildTimelineOptions = {},
): StudioTimelineProjection {
  const order = topologicalOrder(composition);
  const stageNodeId =
    order.find((nodeId) => composition.nodes[nodeId]?.type === "studio.stage") ?? null;
  if (stageNodeId === null) {
    return Object.freeze({
      model: emptyStudioModel(composition),
      stageNodeId: null,
      diagnostic: "Sem palco nesta composição.",
    });
  }

  const poiNodeIds = order.filter((nodeId) => composition.nodes[nodeId]?.type === "studio.poi");
  const base = buildTimelineModel(composition, registry, options);
  const stageTracks = tracksForNode(base.tracks, stageNodeId)
    .filter(
      (track) =>
        track.kind === "node" ||
        (track.kind === "property" &&
          track.propertyPath !== null &&
          CAMERA_PATHS.has(track.propertyPath)),
    )
    .map(normalizeDepth);
  const poiTracks = poiNodeIds.flatMap((nodeId) =>
    tracksForNode(base.tracks, nodeId)
      .filter(
        (track) =>
          track.kind === "node" ||
          (track.kind === "property" && track.propertyPath?.startsWith("props.") === true),
      )
      .map(normalizeDepth),
  );

  const stops = documentStudioPois(composition);
  const schedule = buildStudioTourSchedule(
    stops,
    documentStudioTourTiming(composition, stageNodeId),
  );
  const guide = createTourGuide(stageNodeId, schedule);

  return Object.freeze({
    model: Object.freeze({
      ...base,
      tracks: Object.freeze([...stageTracks, guide, ...poiTracks]),
    }),
    stageNodeId,
    diagnostic: null,
  });
}

export function findStudioStageNodeId(composition: Composition): string | null {
  return (
    topologicalOrder(composition).find(
      (nodeId) => composition.nodes[nodeId]?.type === "studio.stage",
    ) ?? null
  );
}

function tracksForNode(tracks: readonly TimelineTrack[], nodeId: string): readonly TimelineTrack[] {
  return tracks.filter((track) => track.nodeId === nodeId);
}

function normalizeDepth(track: TimelineTrack): TimelineTrack {
  return Object.freeze({
    ...track,
    depth: track.kind === "property" ? 1 : 0,
  });
}

function createTourGuide(stageNodeId: string, schedule: TourSchedule<TourStop>): TimelineTrack {
  return Object.freeze({
    id: `guide:${stageNodeId}:tour`,
    kind: "guide",
    nodeId: stageNodeId,
    propertyPath: null,
    label: "Roteiro previsto",
    depth: 0,
    enabled: true,
    locked: true,
    selected: false,
    labelColor: "#c9963f",
    timeRange: Object.freeze([schedule.timing.startFrame, schedule.endFrame] as [number, number]),
    keyframes: Object.freeze([]),
    cues: Object.freeze(
      schedule.entries.map(({ item, index, arrivalFrame, departureFrame }) =>
        Object.freeze({
          id: `tour-cue:${item.id}`,
          nodeId: item.id,
          label: item.name,
          ordinal: index + 1,
          arrivalFrame,
          departureFrame,
        }),
      ),
    ),
  });
}

function emptyStudioModel(composition: Composition): TimelineModel {
  return Object.freeze({
    duration: composition.duration,
    fps: composition.fps,
    workArea: Object.freeze([composition.workArea[0], composition.workArea[1]] as [number, number]),
    tracks: EMPTY_TRACKS,
    markers: Object.freeze(
      composition.markers.map((marker) =>
        Object.freeze({
          frame: marker.frame,
          label: marker.label,
          color: marker.color,
        }),
      ),
    ),
  });
}
