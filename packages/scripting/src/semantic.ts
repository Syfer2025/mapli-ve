import { geodesicDistance, type GazetteerPort, type LngLat } from "@theatrum/gis";
import type { ScenePlace, SceneScript, SceneTimelineEntry, SceneUnit } from "@theatrum/schema";
import type { ResolvedTimelineEntry, SceneDiagnostic } from "./contracts.js";
import { diagnostic, pointer, suggest } from "./diagnostics.js";
import { ScenePlaceResolver } from "./places.js";
import { parseAbsoluteSceneTime, resolveTimelineTimes, type SceneTimeContext } from "./time.js";

export interface ResolvedSceneModel {
  readonly durationFrames: number;
  readonly timeline: readonly ResolvedTimelineEntry[];
  readonly namedPlaces: ReadonlyMap<string, LngLat>;
  readonly paths: ReadonlyMap<string, readonly LngLat[]>;
  readonly coordinates: ReadonlyMap<string, LngLat>;
}

export async function resolveSceneSemantics(
  scene: SceneScript,
  gazetteer: GazetteerPort,
  diagnostics: SceneDiagnostic[],
  semanticWarnings = true,
): Promise<ResolvedSceneModel | null> {
  const provisionalContext: SceneTimeContext = {
    fps: scene.meta.fps,
    durationFrames: Number.MAX_SAFE_INTEGER,
  };
  const durationFrames = parseAbsoluteSceneTime(scene.meta.duration, provisionalContext);
  if (durationFrames === null || durationFrames <= 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "invalid-time",
        "/meta/duration",
        "duração da cena deve ser um tempo absoluto maior que zero",
      ),
    );
    return null;
  }
  const timeContext = { fps: scene.meta.fps, durationFrames };
  const placeResolver = new ScenePlaceResolver(scene, gazetteer, diagnostics);
  await placeResolver.resolveDeclarations();

  const coordinates = new Map<string, LngLat>();
  const paths = new Map<string, readonly LngLat[]>();
  const pathEntries = Object.entries(scene.paths ?? {}).sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  );
  const resolvedPaths = await Promise.all(
    pathEntries.map(async ([pathName, path]) => {
      const points = await Promise.all(
        path.through.map(async (place, index) => {
          const parts = ["paths", pathName, "through", index] as const;
          const resolved = await placeResolver.resolve(place, parts);
          if (resolved !== null) coordinates.set(pointer(parts), resolved);
          return resolved;
        }),
      );
      return points.every((point): point is LngLat => point !== null)
        ? ([pathName, Object.freeze(points)] as const)
        : null;
    }),
  );
  for (const path of resolvedPaths) {
    if (path !== null) paths.set(path[0], path[1]);
  }

  await Promise.all(
    (scene.units ?? []).map(async (unit, index) => {
      const parts = ["units", index, "at"] as const;
      const resolved = await placeResolver.resolve(unit.at, parts);
      if (resolved !== null) coordinates.set(pointer(parts), resolved);
    }),
  );

  await resolveTimelinePlaces(scene.timeline, placeResolver, coordinates);
  validateReferences(scene, paths, diagnostics);
  const timeline = resolveTimelineTimes(scene.timeline, timeContext, diagnostics);
  validateTimelineBounds(timeline, durationFrames, diagnostics);
  validateMovementOverlaps(timeline, diagnostics);
  validateGroups(scene.timeline, diagnostics);
  if (semanticWarnings) validateSpeeds(scene, timeline, paths, diagnostics);

  return Object.freeze({
    durationFrames,
    timeline,
    namedPlaces: placeResolver.named(),
    paths,
    coordinates,
  });
}

async function resolveTimelinePlaces(
  entries: readonly SceneTimelineEntry[],
  resolver: ScenePlaceResolver,
  coordinates: Map<string, LngLat>,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  const one = (place: ScenePlace, parts: readonly (string | number)[]): void => {
    tasks.push(
      resolver.resolve(place, parts).then((resolved) => {
        if (resolved !== null) coordinates.set(pointer(parts), resolved);
      }),
    );
  };
  const many = (places: readonly ScenePlace[], parts: readonly (string | number)[]): void => {
    places.forEach((place, index) => one(place, [...parts, index]));
  };

  entries.forEach((entry, index) => {
    const base = ["timeline", index] as const;
    switch (entry.do) {
      case "camera.focus":
      case "camera.orbit":
        one(entry.on, [...base, "on"]);
        break;
      case "camera.frame":
        many(entry.on, [...base, "on"]);
        break;
      case "unit.spawn":
      case "unit.dogfight":
      case "unit.split":
      case "unit.merge":
      case "battle":
      case "siege":
      case "naval.blockade":
        one(entry.at_place, [...base, "at_place"]);
        break;
      case "bombard":
        if (entry.from !== undefined) one(entry.from, [...base, "from"]);
        one(entry.at_place, [...base, "at_place"]);
        break;
      case "airstrike":
      case "amphibious.landing":
      case "airdrop":
        if ("from" in entry) one(entry.from, [...base, "from"]);
        one(entry.at_place, [...base, "at_place"]);
        break;
      case "missile.launch":
      case "supply.line":
        one(entry.from, [...base, "from"]);
        one(entry.to, [...base, "to"]);
        break;
      case "frontline.set":
        many(entry.through, [...base, "through"]);
        break;
      case "frontline.shift":
        many(entry.to, [...base, "to"]);
        break;
      case "encircle":
        if (entry.at_place !== undefined) one(entry.at_place, [...base, "at_place"]);
        break;
      case "text.callout":
        one(entry.at_place, [...base, "at_place"]);
        break;
      case "label.place":
        one(entry.place, [...base, "place"]);
        break;
      case "arrow.draw":
        if (entry.from !== undefined) one(entry.from, [...base, "from"]);
        if (entry.to !== undefined) one(entry.to, [...base, "to"]);
        break;
      case "unit.advance":
      case "unit.retreat":
        if (entry.to !== undefined) one(entry.to, [...base, "to"]);
        break;
      default:
        break;
    }
  });
  await Promise.all(tasks);
}

function validateReferences(
  scene: SceneScript,
  resolvedPaths: ReadonlyMap<string, readonly LngLat[]>,
  diagnostics: SceneDiagnostic[],
): void {
  const unitIds = new Set<string>();
  const factionIds = new Set(Object.keys(scene.factions ?? {}));
  const pathIds = new Set(Object.keys(scene.paths ?? {}));
  const units = scene.units ?? [];
  const usedUnitIds = new Set<string>();

  units.forEach((unit, index) => {
    if (unitIds.has(unit.id)) {
      diagnostics.push(
        diagnostic(
          "error",
          "duplicate-id",
          pointer(["units", index, "id"]),
          `unidade "${unit.id}" foi declarada mais de uma vez`,
        ),
      );
    }
    unitIds.add(unit.id);
    if (unit.faction !== undefined && !factionIds.has(unit.faction)) {
      missingReference(diagnostics, ["units", index, "faction"], "facção", unit.faction, [
        ...factionIds,
      ]);
    }
  });

  scene.timeline.forEach((entry, index) => {
    const base = ["timeline", index] as const;
    for (const field of unitReferenceFields(entry)) {
      const value = entry[field as keyof typeof entry];
      if (typeof value === "string") {
        usedUnitIds.add(value);
        if (!unitIds.has(value)) {
          missingReference(diagnostics, [...base, field], "unidade", value, [...unitIds]);
        }
      } else if (Array.isArray(value)) {
        value.forEach((unit, unitIndex) => {
          if (typeof unit === "string") {
            usedUnitIds.add(unit);
            if (!unitIds.has(unit)) {
              missingReference(diagnostics, [...base, field, unitIndex], "unidade", unit, [
                ...unitIds,
              ]);
            }
          }
        });
      }
    }

    if ("along" in entry && entry.along !== undefined && !pathIds.has(entry.along)) {
      missingReference(diagnostics, [...base, "along"], "path", entry.along, [...pathIds]);
    }
    if ("faction" in entry && entry.faction !== undefined && !factionIds.has(entry.faction)) {
      missingReference(diagnostics, [...base, "faction"], "facção", entry.faction, [...factionIds]);
    }
    if (entry.do === "area.transfer") {
      if (!factionIds.has(entry.from)) {
        missingReference(diagnostics, [...base, "from"], "facção", entry.from, [...factionIds]);
      }
      if (!factionIds.has(entry.to)) {
        missingReference(diagnostics, [...base, "to"], "facção", entry.to, [...factionIds]);
      }
    }

    if (
      (entry.do === "unit.advance" || entry.do === "unit.retreat") &&
      (entry.along === undefined) === (entry.to === undefined)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing-reference",
          pointer(base),
          `${entry.do} exige exatamente um de "along" ou "to"`,
        ),
      );
    }
    if (
      entry.do === "encircle" &&
      (entry.region === undefined) === (entry.at_place === undefined)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "missing-reference",
          pointer(base),
          'encircle exige exatamente um de "region" ou "at_place"',
        ),
      );
    }
    if (entry.do === "arrow.draw") {
      const byPath = entry.along !== undefined;
      const byPoints = entry.from !== undefined && entry.to !== undefined;
      if (byPath === byPoints) {
        diagnostics.push(
          diagnostic(
            "error",
            "missing-reference",
            pointer(base),
            'arrow.draw exige "along" ou o par "from"+"to"',
          ),
        );
      }
      if (entry.along !== undefined && !resolvedPaths.has(entry.along)) {
        missingReference(diagnostics, [...base, "along"], "path", entry.along, [...pathIds]);
      }
    }
  });

  units.forEach((unit, index) => {
    if (usedUnitIds.has(unit.id)) return;
    diagnostics.push(
      diagnostic(
        "info",
        "unused-unit",
        pointer(["units", index]),
        `unidade "${unit.id}" foi declarada, mas não é usada na timeline`,
        { hint: "remova a unidade ou referencie-a em um verbo unit.* ou camera.follow" },
      ),
    );
  });
}

function unitReferenceFields(entry: SceneTimelineEntry): readonly string[] {
  switch (entry.do) {
    case "camera.follow":
    case "unit.spawn":
    case "unit.advance":
    case "unit.retreat":
    case "unit.patrol":
    case "unit.destroy":
    case "unit.split":
      return ["unit"];
    case "unit.attack":
    case "unit.intercept":
      return ["unit", "target"];
    case "airstrike":
      return entry.unit === undefined ? [] : ["unit"];
    case "unit.dogfight":
    case "unit.merge":
      return ["units"];
    default:
      return [];
  }
}

function missingReference(
  diagnostics: SceneDiagnostic[],
  parts: readonly (string | number)[],
  kind: string,
  value: string,
  candidates: readonly string[],
): void {
  diagnostics.push(
    diagnostic("error", "missing-reference", pointer(parts), `${kind} "${value}" não existe`, {
      hint: `declare ${kind} antes de referenciá-la`,
      didYouMean: suggest(value, candidates),
    }),
  );
}

function validateTimelineBounds(
  timeline: readonly ResolvedTimelineEntry[],
  durationFrames: number,
  diagnostics: SceneDiagnostic[],
): void {
  for (const resolved of timeline) {
    if (resolved.startFrame < 0) {
      diagnostics.push(
        diagnostic(
          "error",
          "outside-duration",
          pointer(["timeline", resolved.index, "at"]),
          `entrada começa no frame ${resolved.startFrame}, fora de 0..${durationFrames}`,
        ),
      );
      continue;
    }
    if (resolved.startFrame > durationFrames) {
      diagnostics.push(
        diagnostic(
          "warning",
          "outside-duration",
          pointer(["timeline", resolved.index, "at"]),
          `entrada começa no frame ${resolved.startFrame}, após o fim ${durationFrames}`,
          { hint: "antecipe a entrada ou aumente meta.duration" },
        ),
      );
      continue;
    }
    if (resolved.endFrame > durationFrames) {
      diagnostics.push(
        diagnostic(
          "warning",
          "outside-duration",
          pointer(["timeline", resolved.index, "duration"]),
          `entrada termina no frame ${resolved.endFrame}, após o fim ${durationFrames}`,
          { hint: "reduza at/duration ou aumente meta.duration" },
        ),
      );
    }
  }
}

function validateMovementOverlaps(
  timeline: readonly ResolvedTimelineEntry[],
  diagnostics: SceneDiagnostic[],
): void {
  const byUnit = new Map<string, ResolvedTimelineEntry[]>();
  for (const resolved of timeline) {
    const unit = movementUnit(resolved.entry);
    if (unit === null) continue;
    const entries = byUnit.get(unit);
    if (entries === undefined) byUnit.set(unit, [resolved]);
    else entries.push(resolved);
  }

  for (const [unit, entries] of byUnit) {
    entries.sort((left, right) => left.startFrame - right.startFrame || left.index - right.index);
    let active: ResolvedTimelineEntry | undefined;
    let activeEnd = -1;
    for (const current of entries) {
      const currentEnd = Math.max(current.startFrame + 1, current.endFrame);
      if (active !== undefined && current.startFrame < activeEnd) {
        diagnostics.push(
          diagnostic(
            "error",
            "contradictory-overlap",
            pointer(["timeline", current.index, "at"]),
            `movimento de "${unit}" sobrepõe /timeline/${active.index}`,
            { hint: "termine o primeiro movimento antes de iniciar o próximo" },
          ),
        );
      }
      if (currentEnd > activeEnd) {
        active = current;
        activeEnd = currentEnd;
      }
    }
  }
}

function movementUnit(entry: SceneTimelineEntry): string | null {
  switch (entry.do) {
    case "unit.advance":
    case "unit.retreat":
    case "unit.patrol":
    case "unit.attack":
    case "unit.intercept":
      return entry.unit;
    default:
      return null;
  }
}

function validateGroups(
  timeline: readonly SceneTimelineEntry[],
  diagnostics: SceneDiagnostic[],
): void {
  const stack: { readonly label: string; readonly index: number }[] = [];
  timeline.forEach((entry, index) => {
    if (entry.do === "group.begin") {
      stack.push({ label: entry.label, index });
    } else if (entry.do === "group.end") {
      const open = stack.pop();
      if (open === undefined) {
        diagnostics.push(
          diagnostic(
            "error",
            "unbalanced-group",
            pointer(["timeline", index]),
            `group.end "${entry.label}" não possui group.begin`,
          ),
        );
      } else if (open.label !== entry.label) {
        diagnostics.push(
          diagnostic(
            "error",
            "unbalanced-group",
            pointer(["timeline", index, "label"]),
            `grupo termina como "${entry.label}", mas começou como "${open.label}"`,
            { didYouMean: [open.label] },
          ),
        );
      }
    }
  });
  for (const open of stack) {
    diagnostics.push(
      diagnostic(
        "error",
        "unbalanced-group",
        pointer(["timeline", open.index]),
        `group.begin "${open.label}" não possui group.end`,
      ),
    );
  }
}

function validateSpeeds(
  scene: SceneScript,
  timeline: readonly ResolvedTimelineEntry[],
  paths: ReadonlyMap<string, readonly LngLat[]>,
  diagnostics: SceneDiagnostic[],
): void {
  const units = new Map((scene.units ?? []).map((unit) => [unit.id, unit]));
  for (const resolved of timeline) {
    const entry = resolved.entry;
    if (
      !(entry.do === "unit.advance" || entry.do === "unit.retreat" || entry.do === "unit.patrol") ||
      entry.along === undefined ||
      resolved.durationFrames <= 0
    ) {
      continue;
    }
    const points = paths.get(entry.along);
    const unit = units.get(entry.unit);
    if (points === undefined || unit === undefined) continue;
    let meters = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (previous !== undefined && current !== undefined) {
        meters += geodesicDistance(previous, current);
      }
    }
    const hours = resolved.durationFrames / scene.meta.fps / 3600;
    const speed = meters / 1000 / hours;
    const limit = plausibleSpeed(unit);
    if (speed <= limit) continue;
    diagnostics.push(
      diagnostic(
        "warning",
        "implausible-speed",
        pointer(["timeline", resolved.index, "duration"]),
        `${unit.id} percorre ${(meters / 1000).toFixed(0)} km em ${(
          resolved.durationFrames / scene.meta.fps
        ).toFixed(1)}s (≈ ${speed.toFixed(0)} km/h)`,
        { hint: `para ${unit.kind}, use duração compatível com até ≈ ${limit} km/h` },
      ),
    );
  }
}

function plausibleSpeed(unit: SceneUnit): number {
  switch (unit.kind) {
    case "infantry":
      return 15;
    case "armor":
    case "artillery":
    case "convoy":
      return 130;
    case "naval":
    case "sub":
      return 160;
    case "air":
      return 3_000;
    case "missile":
      return 30_000;
  }
}
