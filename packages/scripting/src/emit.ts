import { createIdFactory, hashObject, hashSeed } from "@theatrum/core-utils";
import { assertValidDocument } from "@theatrum/document";
import {
  createEmptyProjectDocument,
  type AnimatableProperty,
  type EasingHandle,
  type Keyframe,
  type Node,
  type PathData,
  type ProjectDocument,
  type SceneScript,
  type SceneTimelineEntry,
  type SceneUnit,
} from "@theatrum/schema";
import type { LngLat } from "@theatrum/gis";
import { SHAPE_CIRCLE_NODE_TYPE } from "@theatrum/scene-graph";
import type { ResolvedTimelineEntry } from "./contracts.js";
import {
  hashSceneScriptDocument,
  SCENE_SCRIPT_DOCUMENT_HASH_PROP,
} from "./document-fingerprint.js";
import type { ResolvedSceneModel } from "./semantic.js";
import { pointer } from "./diagnostics.js";

interface MutableCameraPose {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

interface CameraTrackPoint extends MutableCameraPose {
  readonly frame: number;
  readonly ease: string;
}

export function emitProjectDocument(
  scene: SceneScript,
  resolved: ResolvedSceneModel,
): ProjectDocument {
  const hash = hashObject(scene);
  const ids = createIdFactory(hashSeed("scene-script-v1", hash), { detectCollisions: true });
  const document = createEmptyProjectDocument({
    id: ids("prj"),
    name: scene.meta.title,
    compositionId: ids("cmp"),
    compositionName: scene.meta.title,
    rootNodeId: ids("nd"),
    settings: {
      defaultFps: scene.meta.fps,
      defaultResolution: parseResolution(scene.meta.resolution),
    },
  });
  const composition = document.compositions[0];
  if (composition === undefined) throw new Error("Factory não criou composição principal.");
  composition.duration = resolved.durationFrames;
  composition.workArea = [0, resolved.durationFrames];
  composition.fps = scene.meta.fps;
  [composition.width, composition.height] = parseResolution(scene.meta.resolution);
  composition.background = scene.meta.background ?? "#0a0e14";
  composition.seed = hashSeed(hash, "composition");
  composition.map = {
    styleId: scene.map?.style ?? "style_minimal_political",
    projection: scene.map?.projection ?? "mercator",
    terrain:
      scene.map?.terrain?.enabled === true
        ? {
            enabled: true,
            exaggeration: scene.map.terrain.exaggeration ?? 1,
            sourceId: "terrain_scene_script",
          }
        : null,
    visible: true,
    fadeDuration: 0,
  };

  const root = composition.nodes[composition.root];
  if (root === undefined) throw new Error("Factory não criou nó raiz.");
  root.name = "Scene Script";
  root.timeRange = { in: 0, out: resolved.durationFrames };
  root.size = { mode: "screen", size: [composition.width, composition.height] };
  root.props = {
    sceneScriptVersion: 1,
    sceneScriptHash: hash,
    sourceSceneScript: jsonClone(scene),
    resolvedTimeline: resolved.timeline.map((entry) => ({
      index: entry.index,
      startFrame: entry.startFrame,
      durationFrames: entry.durationFrames,
      endFrame: entry.endFrame,
    })),
  };

  for (const [name, points] of resolved.paths) {
    const source = scene.paths?.[name];
    if (source === undefined) continue;
    document.paths[name] = {
      id: name,
      name,
      space: "geo",
      vertices: points.map((point, index) => ({
        point: [point[0], point[1]],
        inHandle: null,
        outHandle: null,
        ...(source.altitude === undefined ? {} : { altitude: source.altitude }),
        sceneOrder: index,
      })),
      closed: false,
      interpolation: source.smooth === false ? "linear" : "catmull-rom",
      geodesic: source.geodesic ?? false,
    };
    if (source.visible === true) {
      appendNode(
        composition.nodes,
        root,
        makeRouteNode(
          ids("nd"),
          composition.root,
          resolved.durationFrames,
          name,
          source.style?.stroke ?? "#f2a13cff",
          source.style?.width ?? 4,
          source.style?.dash,
        ),
      );
    }
  }

  const unitNodeIds = new Map<string, string>();
  const unitCoordinates = new Map<string, LngLat>();
  (scene.units ?? []).forEach((unit, index) => {
    const coordinate = resolved.coordinates.get(pointer(["units", index, "at"]));
    if (coordinate === undefined) return;
    const id = ids("nd");
    const node = makeUnitNode(
      id,
      composition.root,
      resolved.durationFrames,
      unit,
      coordinate,
      factionColor(scene, unit.faction),
      scene.defaults?.unitSize,
    );
    unitNodeIds.set(unit.id, id);
    unitCoordinates.set(unit.id, coordinate);
    appendNode(composition.nodes, root, node);
  });
  const movementStarts = resolveMovementStarts(resolved, unitCoordinates);

  const cameraPoints: CameraTrackPoint[] = [];
  const initialPose: MutableCameraPose = {
    center: [0, 20],
    zoom: 2,
    bearing: 0,
    pitch: 0,
  };
  for (const entry of resolved.timeline) {
    // Entradas inteiramente após a composição continuam preservadas na fonte e
    // no resolvedTimeline, mas não podem gerar um nó com timeRange invertido.
    if (entry.startFrame > resolved.durationFrames) continue;
    emitTimelineEntry({
      scene,
      entry,
      resolved,
      document,
      root,
      unitNodeIds,
      unitCoordinates,
      movementStarts,
      ids,
      cameraPoints,
      initialPose,
    });
  }
  applyCameraTrack(composition.camera, cameraPoints, ids, initialPose);
  root.props["emittedNodeIds"] = [...root.children];

  const validated = assertValidDocument(document);
  const validatedComposition = validated.compositions[0];
  const validatedRoot = validatedComposition?.nodes[validatedComposition.root];
  if (validatedRoot === undefined) throw new Error("Documento validado perdeu o nó raiz.");
  validatedRoot.props[SCENE_SCRIPT_DOCUMENT_HASH_PROP] = hashSceneScriptDocument(validated);
  return assertValidDocument(validated);
}

interface EmitContext {
  readonly scene: SceneScript;
  readonly entry: ResolvedTimelineEntry;
  readonly resolved: ResolvedSceneModel;
  readonly document: ProjectDocument;
  readonly root: Node;
  readonly unitNodeIds: ReadonlyMap<string, string>;
  readonly unitCoordinates: ReadonlyMap<string, LngLat>;
  readonly movementStarts: ReadonlyMap<number, LngLat>;
  readonly ids: ReturnType<typeof createIdFactory>;
  readonly cameraPoints: CameraTrackPoint[];
  readonly initialPose: MutableCameraPose;
}

/**
 * Resolve a posição de início de cada movimento em ordem temporal. A posição
 * declarada é apenas o primeiro estado da unidade; movimentos seguintes partem
 * do destino anterior e um spawn passa a ser a nova origem.
 */
function resolveMovementStarts(
  resolved: ResolvedSceneModel,
  initialPositions: ReadonlyMap<string, LngLat>,
): ReadonlyMap<number, LngLat> {
  const positions = new Map(initialPositions);
  const starts = new Map<number, LngLat>();
  const ordered = [...resolved.timeline].sort(
    (left, right) => left.startFrame - right.startFrame || left.index - right.index,
  );

  for (const timelineEntry of ordered) {
    const source = timelineEntry.entry;
    if (source.do === "unit.spawn") {
      const spawnedAt = resolved.coordinates.get(
        pointer(["timeline", timelineEntry.index, "at_place"]),
      );
      if (spawnedAt !== undefined) positions.set(source.unit, spawnedAt);
      continue;
    }

    const unit =
      source.do === "unit.advance" ||
      source.do === "unit.retreat" ||
      source.do === "unit.patrol" ||
      source.do === "unit.attack" ||
      source.do === "unit.intercept"
        ? source.unit
        : undefined;
    if (unit === undefined) continue;
    const start = positions.get(unit);
    if (start !== undefined) starts.set(timelineEntry.index, start);

    let end: LngLat | undefined;
    if (source.do === "unit.advance" || source.do === "unit.retreat") {
      if (source.to !== undefined) {
        end = resolved.coordinates.get(pointer(["timeline", timelineEntry.index, "to"]));
      } else if (source.along !== undefined) {
        const points = resolved.paths.get(source.along);
        end = source.do === "unit.retreat" ? points?.[0] : points?.at(-1);
      }
    } else if (source.do === "unit.attack" || source.do === "unit.intercept") {
      end = positions.get(source.target);
    }
    if (end !== undefined) positions.set(unit, end);
  }

  return starts;
}

function emitTimelineEntry(context: EmitContext): void {
  const { entry, document, root } = context;
  const composition = document.compositions[0];
  if (composition === undefined) return;
  const source = entry.entry;

  if (source.do.startsWith("camera.")) {
    emitCameraEntry(context);
    return;
  }
  if (source.do === "marker") {
    composition.markers.push({
      frame: entry.startFrame,
      label: source.label,
      color: source.color ?? "#60a5faff",
      ...(source.comment === undefined ? {} : { comment: source.comment }),
    });
    return;
  }
  if (source.do === "wait" || source.do === "group.begin" || source.do === "group.end") {
    return;
  }

  if (source.do === "unit.spawn" || source.do === "unit.destroy") {
    emitUnitVisibility(context, source);
    return;
  }

  if (
    source.do === "unit.advance" ||
    source.do === "unit.retreat" ||
    source.do === "unit.patrol" ||
    source.do === "unit.attack" ||
    source.do === "unit.intercept"
  ) {
    emitMovementAction(context, source);
    return;
  }

  if (
    source.do === "missile.launch" ||
    source.do === "bombard" ||
    source.do === "airstrike" ||
    source.do === "siege"
  ) {
    emitProjectileAction(context, source);
  }

  if (
    source.do === "arrow.draw" ||
    source.do === "frontline.set" ||
    source.do === "frontline.shift" ||
    source.do === "supply.line"
  ) {
    const route = makeTimelineRoute(context, source);
    if (route !== null) appendNode(composition.nodes, root, route);
    return;
  }

  const visual = makeTimelineVisual(context);
  if (visual !== null) appendNode(composition.nodes, root, visual);
}

function emitUnitVisibility(
  context: EmitContext,
  source: Extract<SceneTimelineEntry, { do: "unit.spawn" | "unit.destroy" }>,
): void {
  const composition = context.document.compositions[0];
  const nodeId = context.unitNodeIds.get(source.unit);
  const node = composition?.nodes[nodeId ?? ""];
  if (composition === undefined || node === undefined) return;
  const start = context.entry.startFrame;
  const end = Math.min(composition.duration, Math.max(start + 1, context.entry.endFrame));
  if (source.do === "unit.spawn") {
    node.timeRange.in = start;
    const at = context.resolved.coordinates.get(
      pointer(["timeline", context.entry.index, "at_place"]),
    );
    if (at !== undefined) node.anchor = { space: "geo", lngLat: [at[0], at[1]] };
    node.transform.opacity = animatable(1, [
      keyframe(context.ids("kf"), start, 0, { kind: "linear" }),
      keyframe(context.ids("kf"), end, 1, { kind: "linear" }),
    ]);
  } else {
    node.transform.opacity = animatable(1, [
      keyframe(context.ids("kf"), start, 1, { kind: "linear" }),
      keyframe(context.ids("kf"), end, 0, { kind: "linear" }),
    ]);
    node.timeRange.out = end;
  }
}

function makeTimelineRoute(
  context: EmitContext,
  source: Extract<
    SceneTimelineEntry,
    { do: "arrow.draw" | "frontline.set" | "frontline.shift" | "supply.line" }
  >,
): Node | null {
  const composition = context.document.compositions[0];
  if (composition === undefined) return null;
  let pathId: string | undefined = "along" in source ? source.along : undefined;
  if (pathId === undefined) {
    const points: LngLat[] = [];
    if (source.do === "frontline.set") {
      source.through.forEach((_, index) => {
        const point = context.resolved.coordinates.get(
          pointer(["timeline", context.entry.index, "through", index]),
        );
        if (point !== undefined) points.push(point);
      });
    } else if (source.do === "frontline.shift") {
      source.to.forEach((_, index) => {
        const point = context.resolved.coordinates.get(
          pointer(["timeline", context.entry.index, "to", index]),
        );
        if (point !== undefined) points.push(point);
      });
    } else {
      const from = context.resolved.coordinates.get(
        pointer(["timeline", context.entry.index, "from"]),
      );
      const to = context.resolved.coordinates.get(pointer(["timeline", context.entry.index, "to"]));
      if (from !== undefined) points.push(from);
      if (to !== undefined) points.push(to);
    }
    if (points.length >= 2) {
      pathId = context.ids("pth");
      context.document.paths[pathId] = {
        id: pathId,
        name: source.do,
        space: "geo",
        vertices: points.map((point) => ({
          point: [point[0], point[1]],
          inHandle: null,
          outHandle: null,
        })),
        closed: false,
        interpolation: "catmull-rom",
        geodesic: source.do === "supply.line",
      };
    }
  }
  if (pathId === undefined) return null;
  const color = source.do === "supply.line" ? "#4ade80ff" : "#ef4444ff";
  const node = makeRouteNode(
    context.ids("nd"),
    composition.root,
    composition.duration,
    pathId,
    color,
    source.do.startsWith("frontline.") ? 5 : 4,
    source.do === "supply.line" ? [10, 8] : undefined,
  );
  node.name = source.do;
  node.timeRange = {
    in: context.entry.startFrame,
    out: Math.min(
      composition.duration,
      Math.max(context.entry.startFrame + 1, context.entry.endFrame),
    ),
  };
  node.props["trimEnd"] = animatable(1, [
    keyframe(context.ids("kf"), context.entry.startFrame, 0, { kind: "linear" }),
    keyframe(
      context.ids("kf"),
      Math.max(context.entry.startFrame + 1, context.entry.endFrame),
      1,
      easing(source.ease ?? "cinematic"),
    ),
  ]);
  return node;
}

function emitMovementAction(
  context: EmitContext,
  source: Extract<
    SceneTimelineEntry,
    {
      do: "unit.advance" | "unit.retreat" | "unit.patrol" | "unit.attack" | "unit.intercept";
    }
  >,
): void {
  const composition = context.document.compositions[0];
  if (composition === undefined) return;
  const ownerId = context.unitNodeIds.get(source.unit);
  const owner = ownerId === undefined ? undefined : composition.nodes[ownerId];
  if (owner === undefined) return;

  let pathId = "along" in source ? source.along : undefined;
  if (pathId === undefined) {
    const start =
      context.movementStarts.get(context.entry.index) ?? context.unitCoordinates.get(source.unit);
    let end: LngLat | undefined;
    if ((source.do === "unit.advance" || source.do === "unit.retreat") && source.to !== undefined) {
      end = context.resolved.coordinates.get(pointer(["timeline", context.entry.index, "to"]));
    } else if (source.do === "unit.attack" || source.do === "unit.intercept") {
      end = context.unitCoordinates.get(source.target);
    }
    if (start !== undefined && end !== undefined) {
      pathId = context.ids("pth");
      context.document.paths[pathId] = pathBetween(pathId, source.do, start, end);
    }
  }
  if (pathId === undefined) return;
  const durationSeconds = Math.max(
    1 / composition.fps,
    context.entry.durationFrames / composition.fps,
  );
  const points = context.document.paths[pathId]?.vertices.map((vertex) => vertex.point) ?? [];
  const approximateKm = polylineDegrees(points) * 111;
  const speedKmh = Math.min(10_000, Math.max(0.1, approximateKm / (durationSeconds / 3600)));
  const actionType =
    source.do === "unit.advance"
      ? "advance"
      : source.do === "unit.retreat"
        ? "retreat"
        : source.do === "unit.patrol"
          ? "patrol"
          : source.do === "unit.attack"
            ? "attack"
            : "intercept";
  owner.actions.push({
    id: context.ids("act"),
    type: actionType,
    enabled: true,
    mode: "live",
    startFrame: context.entry.startFrame,
    params: {
      pathId,
      speedKmh,
      cycles: source.do === "unit.patrol" ? (source.cycles ?? 1) : 1,
      autoOrient: true,
      showRoute: source.do === "unit.advance" ? (source.trail ?? false) : true,
      color: "#f2a13cff",
      sceneDurationFrames: context.entry.durationFrames,
    },
  });
}

function emitProjectileAction(
  context: EmitContext,
  source: Extract<SceneTimelineEntry, { do: "missile.launch" | "bombard" | "airstrike" | "siege" }>,
): void {
  const composition = context.document.compositions[0];
  if (composition === undefined) return;
  const target =
    source.do === "missile.launch"
      ? context.resolved.coordinates.get(pointer(["timeline", context.entry.index, "to"]))
      : context.resolved.coordinates.get(pointer(["timeline", context.entry.index, "at_place"]));
  const origin =
    "from" in source && source.from !== undefined
      ? context.resolved.coordinates.get(pointer(["timeline", context.entry.index, "from"]))
      : target === undefined
        ? undefined
        : ([target[0] - 1, target[1] - 0.5] as const);
  if (origin === undefined || target === undefined) return;
  const pathId = context.ids("pth");
  context.document.paths[pathId] = pathBetween(pathId, source.do, origin, target);
  const owner =
    source.do === "airstrike" && source.unit !== undefined
      ? composition.nodes[context.unitNodeIds.get(source.unit) ?? ""]
      : context.root;
  if (owner === undefined) return;
  const type =
    source.do === "missile.launch"
      ? "missile-launch"
      : source.do === "bombard"
        ? "bombard"
        : source.do === "airstrike"
          ? "airstrike"
          : "siege";
  owner.actions.push({
    id: context.ids("act"),
    type,
    enabled: true,
    mode: "live",
    startFrame: context.entry.startFrame,
    params: {
      pathId,
      durationFrames: Math.max(1, context.entry.durationFrames),
      count: "count" in source ? (source.count ?? 5) : source.do === "siege" ? 8 : 1,
      color: "#fb923cff",
      arcMeters: source.do === "missile.launch" ? 180_000 : 35_000,
      shake: true,
    },
  });
}

function makeTimelineVisual(context: EmitContext): Node | null {
  const { entry, scene, ids } = context;
  const source = entry.entry;
  const composition = context.document.compositions[0];
  if (composition === undefined) return null;
  const end = Math.max(entry.startFrame + 1, entry.endFrame);
  const base = {
    id: ids("nd"),
    parent: composition.root,
    duration: composition.duration,
    timeRange: { in: entry.startFrame, out: Math.min(composition.duration, end) },
  };

  if (
    source.do === "text.title" ||
    source.do === "text.caption" ||
    source.do === "text.date" ||
    source.do === "text.counter" ||
    source.do === "legend.show"
  ) {
    const text =
      source.do === "text.title"
        ? [source.text, source.subtitle].filter(Boolean).join("\n")
        : source.do === "text.caption"
          ? source.text
          : source.do === "text.date"
            ? source.date
            : source.do === "text.counter"
              ? counterText(source.label, source.from, counterDecimals(source.from, source.to))
              : source.items.map((item) => String(item["label"] ?? "Item")).join("\n");
    const position = screenPosition(
      "position" in source ? source.position : undefined,
      composition.width,
      composition.height,
    );
    const props = textProps(text, scene.defaults?.textFont, source.do === "text.title" ? 72 : 30);
    if (source.do === "text.counter") {
      props["text"] = counterTextTrack(context, source);
    }
    return makeNode({
      ...base,
      type: source.do === "text.title" ? "text.title" : "text.label",
      name: text.slice(0, 80),
      anchor: { space: "comp", position: [0, 0] },
      size: { mode: "screen", size: [Math.min(1_200, composition.width), 240] },
      position,
      props,
    });
  }

  if (source.do === "text.callout" || source.do === "label.place") {
    const place =
      source.do === "text.callout"
        ? context.resolved.coordinates.get(pointer(["timeline", entry.index, "at_place"]))
        : context.resolved.coordinates.get(pointer(["timeline", entry.index, "place"]));
    if (place === undefined) return null;
    const text = source.do === "text.callout" ? source.text : String(source.place);
    return makeNode({
      ...base,
      type: "text.label",
      name: text.slice(0, 80),
      anchor: { space: "geo", lngLat: [place[0], place[1]] },
      size: { mode: "screen", size: [420, 96] },
      props: textProps(text, scene.defaults?.textFont, 24),
    });
  }

  if (
    source.do === "area.highlight" ||
    source.do === "area.transfer" ||
    source.do === "border.show" ||
    (source.do === "encircle" && source.region !== undefined)
  ) {
    const geoId = source.do === "border.show" ? source.dataset : (source.region ?? "");
    const color =
      source.do === "area.transfer"
        ? factionColor(scene, source.to)
        : factionColor(scene, source.do === "area.highlight" ? source.faction : undefined);
    const fill =
      source.do === "area.transfer"
        ? transferColorTrack(
            context,
            factionColor(scene, source.from),
            factionColor(scene, source.to),
          )
        : animatable(color);
    const fillAlpha =
      source.do === "area.highlight" ? highlightAlphaTrack(context, source.fade) : animatable(0.35);
    return makeNode({
      ...base,
      type: "geo.region",
      name: geoId,
      anchor: { space: "geo", lngLat: [0, 0] },
      size: { mode: "screen", size: [64, 64] },
      props: {
        geoId: animatable(geoId),
        fill,
        fillAlpha,
        stroke:
          source.do === "area.transfer"
            ? transferColorTrack(
                context,
                factionColor(scene, source.from),
                factionColor(scene, source.to),
              )
            : animatable(color),
        strokeWidth: animatable(2),
        strokeAlpha: animatable(1),
        sceneVerb: source.do,
      },
    });
  }

  const place = timelineAnchor(context);
  if (place === undefined) return null;
  const label = "label" in source && typeof source.label === "string" ? source.label : source.do;
  return makeNode({
    ...base,
    type: SHAPE_CIRCLE_NODE_TYPE.type,
    name: label,
    anchor: { space: "geo", lngLat: [place[0], place[1]] },
    size: { mode: "screen", size: [160, 160] },
    props: {
      radius: animatable(
        source.do === "naval.blockade" ? Math.min(90, Math.max(20, source.radius)) : 48,
      ),
      fill: animatable(
        factionColor(
          scene,
          "faction" in source && typeof source.faction === "string" ? source.faction : undefined,
        ),
      ),
      stroke: animatable("#ffffffff"),
      strokeWidth: animatable(2),
      sceneVerb: source.do,
    },
  });
}

function timelineAnchor(context: EmitContext): LngLat | undefined {
  const { entry, resolved } = context;
  const source = entry.entry;
  for (const field of ["at_place", "from", "to", "place"] as const) {
    if (field in source) {
      const coordinate = resolved.coordinates.get(pointer(["timeline", entry.index, field]));
      if (coordinate !== undefined) return coordinate;
    }
  }
  return undefined;
}

function emitCameraEntry(context: EmitContext): void {
  const source = context.entry.entry;
  const current = context.cameraPoints.at(-1) ?? {
    frame: 0,
    ease: "linear",
    ...context.initialPose,
  };
  if (source.do === "camera.shake") {
    const amplitude = Math.min(12, source.intensity * 4);
    const middle = Math.min(
      context.resolved.durationFrames,
      context.entry.startFrame + Math.max(1, Math.floor(context.entry.durationFrames / 2)),
    );
    context.cameraPoints.push({
      frame: context.entry.startFrame,
      ease: "linear",
      center: [...current.center],
      zoom: current.zoom,
      bearing: current.bearing,
      pitch: current.pitch,
    });
    context.cameraPoints.push({
      frame: middle,
      ease: "linear",
      center: [...current.center],
      zoom: current.zoom,
      bearing: current.bearing + amplitude,
      pitch: current.pitch + amplitude * 0.25,
    });
    context.cameraPoints.push({
      frame: context.entry.endFrame,
      ease: "linear",
      center: [...current.center],
      zoom: current.zoom,
      bearing: current.bearing,
      pitch: current.pitch,
    });
    return;
  }
  if (source.do === "camera.follow") {
    const center = context.unitCoordinates.get(source.unit);
    if (center !== undefined) {
      context.cameraPoints.push({
        frame: context.entry.startFrame,
        ease: source.ease ?? "cinematic",
        center: [...current.center],
        zoom: current.zoom,
        bearing: current.bearing,
        pitch: current.pitch,
      });
      context.cameraPoints.push({
        frame: Math.max(context.entry.startFrame + 1, context.entry.endFrame),
        ease: source.ease ?? "cinematic",
        center: [center[0], center[1]],
        zoom: current.zoom,
        bearing: current.bearing,
        pitch: current.pitch,
      });
    }
    return;
  }
  const endFrame = Math.min(
    context.resolved.durationFrames,
    Math.max(context.entry.startFrame, context.entry.endFrame),
  );
  let next: MutableCameraPose = {
    center: current.center,
    zoom: current.zoom,
    bearing: current.bearing,
    pitch: current.pitch,
  };
  if (source.do === "camera.focus" || source.do === "camera.orbit") {
    const center = context.resolved.coordinates.get(
      pointer(["timeline", context.entry.index, "on"]),
    );
    if (center === undefined) return;
    next = {
      center: [center[0], center[1]],
      zoom: source.do === "camera.focus" ? (source.zoom ?? current.zoom) : current.zoom,
      bearing:
        source.do === "camera.focus"
          ? (source.bearing ?? current.bearing)
          : current.bearing + (source.revolutions ?? 1) * 360,
      pitch: source.do === "camera.focus" ? (source.pitch ?? current.pitch) : current.pitch,
    };
  } else if (source.do === "camera.frame") {
    const points = source.on
      .map((_, index) =>
        context.resolved.coordinates.get(pointer(["timeline", context.entry.index, "on", index])),
      )
      .filter((point): point is LngLat => point !== undefined);
    if (points.length === 0) return;
    next = {
      center: [...centerOf(points)],
      zoom: frameZoom(points, source.padding ?? 0.15),
      bearing: current.bearing,
      pitch: current.pitch,
    };
  } else if (source.do === "camera.reset") {
    next = { ...context.initialPose };
  }
  context.cameraPoints.push({
    frame: context.entry.startFrame,
    ease: source.ease ?? context.scene.defaults?.ease ?? "cinematic",
    center: current.center,
    zoom: current.zoom,
    bearing: current.bearing,
    pitch: current.pitch,
  });
  context.cameraPoints.push({
    frame: endFrame,
    ease: source.ease ?? context.scene.defaults?.ease ?? "cinematic",
    ...next,
  });
}

function applyCameraTrack(
  camera: ProjectDocument["compositions"][number]["camera"],
  points: readonly CameraTrackPoint[],
  ids: ReturnType<typeof createIdFactory>,
  initial: MutableCameraPose,
): void {
  const deduplicated = new Map<number, CameraTrackPoint>();
  for (const point of points) deduplicated.set(point.frame, point);
  const ordered = [...deduplicated.values()].sort((left, right) => left.frame - right.frame);
  if (ordered.length === 0) return;
  camera.center = track(initial.center, ordered, (point) => point.center, ids);
  camera.zoom = track(initial.zoom, ordered, (point) => point.zoom, ids);
  camera.bearing = track(initial.bearing, ordered, (point) => point.bearing, ids);
  camera.pitch = track(initial.pitch, ordered, (point) => point.pitch, ids);
}

function track<T>(
  value: T,
  points: readonly CameraTrackPoint[],
  select: (point: CameraTrackPoint) => T,
  ids: ReturnType<typeof createIdFactory>,
): AnimatableProperty<T> {
  return animatable(
    value,
    points.map((point) => keyframe(ids("kf"), point.frame, select(point), easing(point.ease))),
  );
}

function makeUnitNode(
  id: string,
  parent: string,
  duration: number,
  unit: SceneUnit,
  coordinate: LngLat,
  color: string,
  defaultSize = 56,
): Node {
  const common = {
    id,
    parent,
    duration,
    type:
      unit.kind === "armor"
        ? "unit.armor"
        : unit.kind === "infantry"
          ? "unit.infantry"
          : "symbol.icon",
    name: unit.label ?? unit.id,
    anchor: {
      space: "geo" as const,
      lngLat: [coordinate[0], coordinate[1]] as [number, number],
      ...(typeof unit.at === "object" && !Array.isArray(unit.at) && unit.at.altitude !== undefined
        ? { altitude: unit.at.altitude }
        : {}),
    },
    size: {
      mode: "screen" as const,
      size: [unit.size ?? defaultSize, unit.size ?? defaultSize] as [number, number],
    },
  };
  if (unit.kind === "armor" || unit.kind === "infantry") {
    return makeNode({
      ...common,
      props: {
        assetId: animatable(""),
        callsign: animatable(unit.label ?? unit.id),
        affiliation: animatable("friendly"),
        tint: animatable(color),
        defaultSpeedKmh: animatable(unit.kind === "armor" ? 45 : 5),
        sceneUnitId: unit.id,
      },
      rotation: unit.bearing ?? 0,
    });
  }
  return makeNode({
    ...common,
    props: {
      iconId: animatable(unit.icon ?? unit.kind),
      color: animatable(color),
      outline: animatable("#000000ff"),
      outlineWidth: animatable(1),
      sceneUnitId: unit.id,
    },
    rotation: unit.bearing ?? 0,
  });
}

interface MakeNodeOptions {
  readonly id: string;
  readonly parent: string;
  readonly duration: number;
  readonly type: string;
  readonly name: string;
  readonly anchor: Node["anchor"];
  readonly size: Node["size"];
  readonly props: Record<string, unknown>;
  readonly timeRange?: Node["timeRange"];
  readonly position?: readonly [number, number];
  readonly rotation?: number;
}

function makeNode(options: MakeNodeOptions): Node {
  return {
    id: options.id,
    type: options.type,
    name: options.name,
    parent: options.parent,
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "none",
    timeRange: options.timeRange ?? { in: 0, out: options.duration },
    timeRemap: null,
    anchor: options.anchor,
    size: options.size,
    transform: {
      position: animatable([...(options.position ?? [0, 0])] as [number, number]),
      rotation: animatable(options.rotation ?? 0),
      scale: animatable([1, 1]),
      opacity: animatable(1),
      anchorPoint: animatable([0, 0]),
      skew: animatable([0, 0]),
      rotationReference: options.anchor.space === "geo" ? "geo-bearing" : "screen",
    },
    blendMode: "normal",
    trackMatte: null,
    motionBlur: false,
    props: options.props,
    effects: [],
    behaviors: [],
    actions: [],
  };
}

function makeRouteNode(
  id: string,
  parent: string,
  duration: number,
  pathId: string,
  color: string,
  width: number,
  dash: readonly number[] | undefined,
): Node {
  return makeNode({
    id,
    parent,
    duration,
    type: "route",
    name: pathId,
    anchor: { space: "geo", lngLat: [0, 0] },
    size: { mode: "screen", size: [64, 64] },
    props: {
      pathId: animatable(pathId),
      color: animatable(color),
      width: animatable(width),
      dashPx: animatable(dash?.[0] ?? 0),
      gapPx: animatable(dash?.[1] ?? 0),
      dashOffset: animatable(0),
      trimStart: animatable(0),
      trimEnd: animatable(1),
      arrowSize: animatable(22),
      arrowSpread: animatable(26),
      filled: animatable(false),
      fill: animatable(color),
      fillAlpha: animatable(0.85),
      bodyWidth: animatable(18),
      headWidth: animatable(52),
      headLength: animatable(46),
    },
  });
}

function appendNode(nodes: Record<string, Node>, root: Node, node: Node): void {
  nodes[node.id] = node;
  root.children.push(node.id);
}

function pathBetween(id: string, name: string, start: LngLat, end: LngLat): PathData {
  return {
    id,
    name,
    space: "geo",
    vertices: [
      { point: [start[0], start[1]], inHandle: null, outHandle: null },
      { point: [end[0], end[1]], inHandle: null, outHandle: null },
    ],
    closed: false,
    interpolation: "catmull-rom",
    geodesic: true,
  };
}

function counterTextTrack(
  context: EmitContext,
  source: Extract<SceneTimelineEntry, { do: "text.counter" }>,
): AnimatableProperty<string> {
  const start = context.entry.startFrame;
  const duration = Math.max(1, context.entry.durationFrames);
  const steps = Math.min(60, duration);
  const decimals = counterDecimals(source.from, source.to);
  const keyframes: Keyframe<string>[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const frame = start + Math.round(duration * progress);
    const value = source.from + (source.to - source.from) * progress;
    keyframes.push(
      keyframe(context.ids("kf"), frame, counterText(source.label, value, decimals), {
        kind: "linear",
      }),
    );
  }
  return animatable(counterText(source.label, source.from, decimals), keyframes);
}

function counterDecimals(from: number, to: number): number {
  return Number.isInteger(from) && Number.isInteger(to) ? 0 : 2;
}

function counterText(label: string | undefined, value: number, decimals: number): string {
  const number =
    decimals === 0 ? String(Math.round(value)) : String(Number(value.toFixed(decimals)));
  return label === undefined || label.trim().length === 0 ? number : `${label.trim()} ${number}`;
}

function transferColorTrack(
  context: EmitContext,
  from: string,
  to: string,
): AnimatableProperty<string> {
  const start = context.entry.startFrame;
  const end = Math.max(start + 1, context.entry.endFrame);
  return animatable(from, [
    keyframe(context.ids("kf"), start, from, { kind: "linear" }),
    keyframe(context.ids("kf"), end, to, easing(context.entry.entry.ease ?? "cinematic")),
  ]);
}

function highlightAlphaTrack(
  context: EmitContext,
  fade: "in" | "out" | "in-out" | undefined,
): AnimatableProperty<number> {
  if (fade === undefined) return animatable(0.35);
  const start = context.entry.startFrame;
  const end = Math.max(start + 1, context.entry.endFrame);
  if (fade === "in") {
    return animatable(0.35, [
      keyframe(context.ids("kf"), start, 0, { kind: "linear" }),
      keyframe(context.ids("kf"), end, 0.35, easing(context.entry.entry.ease ?? "cinematic")),
    ]);
  }
  if (fade === "out") {
    return animatable(0.35, [
      keyframe(context.ids("kf"), start, 0.35, { kind: "linear" }),
      keyframe(context.ids("kf"), end, 0, easing(context.entry.entry.ease ?? "cinematic")),
    ]);
  }
  if (end - start < 2) return animatable(0.35);
  const middle = start + Math.floor((end - start) / 2);
  return animatable(0.35, [
    keyframe(context.ids("kf"), start, 0, { kind: "linear" }),
    keyframe(context.ids("kf"), middle, 0.35, easing(context.entry.entry.ease ?? "cinematic")),
    keyframe(context.ids("kf"), end, 0, easing(context.entry.entry.ease ?? "cinematic")),
  ]);
}

function textProps(text: string, font = "Inter", size = 30): Record<string, unknown> {
  return {
    text: animatable(text),
    fontFamily: animatable(font),
    fontSize: animatable(size),
    fontWeight: animatable(size >= 60 ? 700 : 600),
    color: animatable("#ffffffff"),
    align: animatable("center"),
    lineHeight: animatable(1.2),
    tracking: animatable(0),
    halo: animatable("#0b1118e6"),
    haloWidth: animatable(2),
    maxWidth: animatable(0),
  };
}

function animatable<T>(value: T, keyframes: readonly Keyframe<T>[] = []): AnimatableProperty<T> {
  return { value, keyframes: [...keyframes], expression: null };
}

function keyframe<T>(id: string, frame: number, value: T, handle: EasingHandle): Keyframe<T> {
  return { id, frame, value, in: handle, out: handle };
}

function easing(name: string): EasingHandle {
  return name === "linear" ? { kind: "linear" } : { kind: "bezier", handle: [0.33, 0.67] };
}

function parseResolution(value: string): [number, number] {
  const [width, height] = value.split("x").map(Number);
  if (width === undefined || height === undefined) throw new Error(`Resolução inválida: ${value}`);
  return [width, height];
}

function factionColor(scene: SceneScript, faction: string | undefined): string {
  if (faction !== undefined) return scene.factions?.[faction]?.color ?? "#60a5faff";
  return "#60a5faff";
}

function screenPosition(
  position: string | undefined,
  width: number,
  height: number,
): [number, number] {
  const horizontal = position?.includes("left")
    ? width * 0.2
    : position?.includes("right")
      ? width * 0.8
      : width * 0.5;
  const vertical = position?.includes("top")
    ? height * 0.16
    : position?.includes("bottom")
      ? height * 0.84
      : height * 0.5;
  return [horizontal, vertical];
}

function centerOf(points: readonly LngLat[]): LngLat {
  const sum = points.reduce(
    (current, point) => [current[0] + point[0], current[1] + point[1]] as [number, number],
    [0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length];
}

function frameZoom(points: readonly LngLat[], padding: number): number {
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  const span = Math.max(
    Math.max(...longitudes) - Math.min(...longitudes),
    Math.max(...latitudes) - Math.min(...latitudes),
    0.01,
  );
  return Math.max(0, Math.min(18, Math.log2(360 / span) - 1 - padding * 2));
}

function polylineDegrees(points: readonly (readonly [number, number])[]): number {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    result += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
  }
  return result;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
