import { VERB_CATALOG, type SceneTimelineEntry } from "@theatrum/schema";
import type { SceneVerbDefinition, SceneVerbRegistry } from "./contracts.js";
import { suggest } from "./diagnostics.js";

const COMMON_FIELDS = ["at", "id", "ease", "delay", "comment"] as const;

const VERB_FIELDS = {
  "camera.focus": ["on", "zoom", "bearing", "pitch", "duration"],
  "camera.frame": ["on", "padding", "duration"],
  "camera.orbit": ["on", "revolutions", "duration"],
  "camera.follow": ["unit", "damping", "duration"],
  "camera.shake": ["intensity", "duration"],
  "camera.reset": ["duration"],
  "unit.spawn": ["unit", "at_place", "fade"],
  "unit.advance": ["unit", "along", "to", "duration", "trail"],
  "unit.retreat": ["unit", "along", "to", "duration"],
  "unit.patrol": ["unit", "along", "cycles", "duration"],
  "unit.attack": ["unit", "target", "duration"],
  "unit.intercept": ["unit", "target", "duration"],
  "unit.dogfight": ["units", "at_place", "duration"],
  "unit.destroy": ["unit", "explosion"],
  "unit.split": ["unit", "into", "at_place"],
  "unit.merge": ["units", "into", "at_place"],
  battle: ["at_place", "intensity", "duration", "label"],
  bombard: ["from", "at_place", "count", "duration"],
  airstrike: ["unit", "at_place", "duration"],
  "missile.launch": ["from", "to", "duration", "trail"],
  siege: ["at_place", "duration", "label"],
  "amphibious.landing": ["from", "at_place", "duration"],
  airdrop: ["from", "at_place", "duration"],
  "naval.blockade": ["at_place", "radius", "duration"],
  "area.highlight": ["region", "faction", "duration", "fade"],
  "area.transfer": ["region", "from", "to", "duration"],
  "frontline.set": ["through", "duration"],
  "frontline.shift": ["to", "duration"],
  "border.show": ["dataset", "duration"],
  encircle: ["region", "at_place", "duration"],
  "supply.line": ["from", "to", "duration", "flow"],
  "text.title": ["text", "subtitle", "position", "duration", "reveal"],
  "text.caption": ["text", "position", "duration"],
  "text.callout": ["text", "at_place", "duration", "leader"],
  "text.date": ["date", "position", "duration"],
  "text.counter": ["from", "to", "label", "duration"],
  "label.place": ["place", "duration", "style"],
  "arrow.draw": ["along", "from", "to", "duration", "style"],
  "legend.show": ["items", "position", "duration"],
  wait: ["duration"],
  marker: ["label", "color"],
  "group.begin": ["label"],
  "group.end": ["label"],
} as const satisfies Record<SceneTimelineEntry["do"], readonly string[]>;

export const BUILTIN_SCENE_VERBS: readonly SceneVerbDefinition[] = Object.freeze(
  VERB_CATALOG.map((catalogEntry) =>
    Object.freeze({
      ...catalogEntry,
      required: Object.freeze([...catalogEntry.required]),
      fields: Object.freeze([...COMMON_FIELDS, ...VERB_FIELDS[catalogEntry.name]]),
      example: Object.freeze({ ...catalogEntry.example }),
    }),
  ),
);

export function createSceneVerbRegistry(
  definitions: readonly SceneVerbDefinition[] = BUILTIN_SCENE_VERBS,
): SceneVerbRegistry {
  const entries = definitions.map((entry) =>
    Object.freeze({
      ...entry,
      required: Object.freeze([...entry.required]),
      fields: Object.freeze([...entry.fields]),
      example: Object.freeze({ ...entry.example }),
    }),
  );
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (byName.size !== entries.length)
    throw new Error("Registry Scene Script contém verbos duplicados.");
  const names = Object.freeze(entries.map((entry) => entry.name));

  return Object.freeze({
    list: () => entries,
    get: (name: string) => byName.get(name as SceneTimelineEntry["do"]),
    has: (name: string): name is SceneTimelineEntry["do"] => byName.has(name as never),
    suggest: (name: string, limit = 3) => suggest(name, names, limit),
  });
}

export const sceneVerbRegistry = createSceneVerbRegistry();
