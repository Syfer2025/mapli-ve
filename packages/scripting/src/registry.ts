import { VERB_CATALOG, type SceneTimelineEntry } from "@theatrum/schema";
import type { SceneVerbDefinition, SceneVerbRegistry } from "./contracts.js";
import { suggest } from "./diagnostics.js";

const COMMON_FIELDS = ["at", "id", "ease", "delay", "comment"] as const;

const EXAMPLE_OVERRIDES: Readonly<
  Partial<Record<SceneTimelineEntry["do"], Readonly<Record<string, unknown>>>>
> = Object.freeze({
  "unit.advance": { to: [10, 10], duration: "1s" },
  "unit.retreat": { to: [10, 10], duration: "1s" },
  "area.highlight": { region: "c:IRN" },
  "area.transfer": { region: "c:IRN" },
  "border.show": { dataset: "c:FRA" },
  encircle: { at_place: [0, 0] },
  "arrow.draw": { from: [0, 0], to: [10, 10] },
});

const IMPLEMENTATION_NOTES: Readonly<Partial<Record<SceneTimelineEntry["do"], string>>> =
  Object.freeze({
    "camera.follow":
      "Enquadra a posição conhecida da unidade; acompanhamento dinâmico da trajetória ainda não é emitido.",
    "unit.dogfight": "Marca o local do combate, mas ainda não anima as manobras das unidades.",
    "unit.split": "Marca a divisão, mas ainda não cria nem reposiciona as unidades resultantes.",
    "unit.merge": "Marca a reunião, mas ainda não remove nem combina as unidades de origem.",
    battle: "Marca o confronto, mas ainda não cria automaticamente um pacote de efeitos.",
    "amphibious.landing":
      "Marca o ponto do desembarque, mas ainda não anima a travessia desde a origem.",
    airdrop: "Marca o ponto do lançamento, mas ainda não anima a queda das unidades.",
    "frontline.shift":
      "Desenha o novo traçado, mas ainda não transforma uma linha de frente anterior.",
    "border.show": "Aceita somente um geoId interno já empacotado; não carrega um dataset externo.",
    encircle: "Destaca uma região ou marca um local, sem animar uma manobra de cerco.",
  });

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
      example: Object.freeze({
        ...catalogEntry.example,
        ...EXAMPLE_OVERRIDES[catalogEntry.name],
      }),
      ...(IMPLEMENTATION_NOTES[catalogEntry.name] === undefined
        ? {}
        : { implementationNote: IMPLEMENTATION_NOTES[catalogEntry.name] }),
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
      ...(entry.implementationNote === undefined
        ? {}
        : { implementationNote: entry.implementationNote }),
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
