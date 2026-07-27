import { z } from "zod";
import { APP_NAME, SCENE_FORMAT_ID, SCENE_SCRIPT_VERSION } from "./branding.js";
import {
  ColorSchema,
  FiniteNumberSchema,
  LongitudeLatitudeSchema,
  NonEmptyStringSchema,
} from "./primitives.js";

const TIME_PATTERN =
  /^(?:(?:\d+(?:\.\d+)?(?:ms|s|f))|(?:\d+m\d+(?:\.\d+)?s)|(?:\d+:\d{2})|(?:\d{2}:\d{2}:\d{2}:\d{2})|(?:after:[^+\s]+(?:\+\d+(?:\.\d+)?(?:ms|s|f))?)|(?:with:[^\s]+)|(?:end-\d+(?:\.\d+)?(?:ms|s|f)))$/;

export const SceneTimeSchema = z.union([
  FiniteNumberSchema.nonnegative(),
  z.string().regex(TIME_PATTERN, "tempo inválido"),
]);

export const ScenePlaceSchema = z.union([
  NonEmptyStringSchema,
  LongitudeLatitudeSchema,
  z
    .object({
      lng: FiniteNumberSchema.min(-180).max(180),
      lat: FiniteNumberSchema.min(-90).max(90),
      altitude: FiniteNumberSchema.optional(),
    })
    .strict(),
]);

export const SceneMetaSchema = z
  .object({
    title: NonEmptyStringSchema,
    fps: z.union([
      z.literal(24),
      z.literal(25),
      z.literal(30),
      z.literal(50),
      z.literal(60),
      z.literal(120),
    ]),
    resolution: z.string().regex(/^[1-9]\d*x[1-9]\d*$/, "resolução deve usar LARGURAxALTURA"),
    duration: SceneTimeSchema,
    background: ColorSchema.optional(),
  })
  .strict();

export const SceneMapSchema = z
  .object({
    style: NonEmptyStringSchema.optional(),
    projection: z.enum(["mercator", "globe", "albers", "equal-earth"]).optional(),
    terrain: z
      .object({
        enabled: z.boolean(),
        exaggeration: FiniteNumberSchema.nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const SceneDefaultsSchema = z
  .object({
    unitSize: FiniteNumberSchema.positive().optional(),
    textFont: NonEmptyStringSchema.optional(),
    ease: NonEmptyStringSchema.optional(),
    labelPosition: NonEmptyStringSchema.optional(),
  })
  .strict();

export const SceneFactionSchema = z
  .object({
    color: ColorSchema,
    label: NonEmptyStringSchema,
  })
  .strict();

export const ScenePathStyleSchema = z
  .object({
    stroke: ColorSchema.optional(),
    width: FiniteNumberSchema.positive().optional(),
    dash: z.array(FiniteNumberSchema.nonnegative()).min(1).optional(),
    arrow: z.enum(["none", "start", "end", "both"]).optional(),
  })
  .strict();

export const ScenePathSchema = z
  .object({
    through: z.array(ScenePlaceSchema).min(2),
    smooth: z.boolean().optional(),
    geodesic: z.boolean().optional(),
    altitude: FiniteNumberSchema.optional(),
    arc: FiniteNumberSchema.min(0).max(1).optional(),
    style: ScenePathStyleSchema.optional(),
    visible: z.boolean().optional(),
  })
  .strict();

export const SceneUnitSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.enum(["infantry", "armor", "air", "naval", "sub", "artillery", "missile", "convoy"]),
    faction: NonEmptyStringSchema.optional(),
    at: ScenePlaceSchema,
    label: z.string().optional(),
    size: FiniteNumberSchema.positive().optional(),
    icon: NonEmptyStringSchema.optional(),
    bearing: FiniteNumberSchema.optional(),
  })
  .strict();

const commonTimelineFields = {
  at: SceneTimeSchema,
  id: NonEmptyStringSchema.optional(),
  ease: NonEmptyStringSchema.optional(),
  delay: SceneTimeSchema.optional(),
  comment: z.string().optional(),
};

function verb<const Name extends string, Shape extends z.ZodRawShape>(name: Name, shape: Shape) {
  return z
    .object({
      ...commonTimelineFields,
      do: z.literal(name),
      ...shape,
    })
    .strict();
}

const CameraFocusSchema = verb("camera.focus", {
  on: ScenePlaceSchema,
  zoom: FiniteNumberSchema.optional(),
  bearing: FiniteNumberSchema.optional(),
  pitch: FiniteNumberSchema.optional(),
  duration: SceneTimeSchema,
});
const CameraFrameSchema = verb("camera.frame", {
  on: z.array(ScenePlaceSchema).min(1),
  padding: FiniteNumberSchema.min(0).max(1).optional(),
  duration: SceneTimeSchema,
});
const CameraOrbitSchema = verb("camera.orbit", {
  on: ScenePlaceSchema,
  revolutions: FiniteNumberSchema.optional(),
  duration: SceneTimeSchema,
});
const CameraFollowTimelineSchema = verb("camera.follow", {
  unit: NonEmptyStringSchema,
  damping: FiniteNumberSchema.min(0).max(1).optional(),
  duration: SceneTimeSchema,
});
const CameraShakeSchema = verb("camera.shake", {
  intensity: FiniteNumberSchema.nonnegative(),
  duration: SceneTimeSchema,
});
const CameraResetSchema = verb("camera.reset", { duration: SceneTimeSchema });

const UnitSpawnSchema = verb("unit.spawn", {
  unit: NonEmptyStringSchema,
  at_place: ScenePlaceSchema,
  fade: SceneTimeSchema.optional(),
});
const UnitAdvanceSchema = verb("unit.advance", {
  unit: NonEmptyStringSchema,
  along: NonEmptyStringSchema.optional(),
  to: ScenePlaceSchema.optional(),
  duration: SceneTimeSchema.optional(),
  trail: z.boolean().optional(),
});
const UnitRetreatSchema = verb("unit.retreat", {
  unit: NonEmptyStringSchema,
  along: NonEmptyStringSchema.optional(),
  to: ScenePlaceSchema.optional(),
  duration: SceneTimeSchema.optional(),
});
const UnitPatrolSchema = verb("unit.patrol", {
  unit: NonEmptyStringSchema,
  along: NonEmptyStringSchema,
  cycles: z.number().int().positive().optional(),
  duration: SceneTimeSchema,
});
const UnitAttackSchema = verb("unit.attack", {
  unit: NonEmptyStringSchema,
  target: NonEmptyStringSchema,
  duration: SceneTimeSchema.optional(),
});
const UnitInterceptSchema = verb("unit.intercept", {
  unit: NonEmptyStringSchema,
  target: NonEmptyStringSchema,
  duration: SceneTimeSchema.optional(),
});
const UnitDogfightSchema = verb("unit.dogfight", {
  units: z.array(NonEmptyStringSchema).min(2),
  at_place: ScenePlaceSchema,
  duration: SceneTimeSchema,
});
const UnitDestroySchema = verb("unit.destroy", {
  unit: NonEmptyStringSchema,
  explosion: z.boolean().optional(),
});
const UnitSplitSchema = verb("unit.split", {
  unit: NonEmptyStringSchema,
  into: z.array(NonEmptyStringSchema).min(2),
  at_place: ScenePlaceSchema,
});
const UnitMergeSchema = verb("unit.merge", {
  units: z.array(NonEmptyStringSchema).min(2),
  into: NonEmptyStringSchema,
  at_place: ScenePlaceSchema,
});

const BattleSchema = verb("battle", {
  at_place: ScenePlaceSchema,
  intensity: z.enum(["low", "medium", "high"]),
  duration: SceneTimeSchema,
  label: z.string().optional(),
});
const BombardSchema = verb("bombard", {
  from: ScenePlaceSchema.optional(),
  at_place: ScenePlaceSchema,
  count: z.number().int().positive().optional(),
  duration: SceneTimeSchema,
});
const AirstrikeSchema = verb("airstrike", {
  unit: NonEmptyStringSchema.optional(),
  at_place: ScenePlaceSchema,
  duration: SceneTimeSchema,
});
const MissileLaunchSchema = verb("missile.launch", {
  from: ScenePlaceSchema,
  to: ScenePlaceSchema,
  duration: SceneTimeSchema,
  trail: z.boolean().optional(),
});
const SiegeSchema = verb("siege", {
  at_place: ScenePlaceSchema,
  duration: SceneTimeSchema,
  label: z.string().optional(),
});
const AmphibiousLandingSchema = verb("amphibious.landing", {
  from: ScenePlaceSchema,
  at_place: ScenePlaceSchema,
  duration: SceneTimeSchema,
});
const AirdropSchema = verb("airdrop", {
  from: ScenePlaceSchema,
  at_place: ScenePlaceSchema,
  duration: SceneTimeSchema,
});
const NavalBlockadeSchema = verb("naval.blockade", {
  at_place: ScenePlaceSchema,
  radius: FiniteNumberSchema.positive(),
  duration: SceneTimeSchema,
});

const AreaHighlightSchema = verb("area.highlight", {
  region: NonEmptyStringSchema,
  faction: NonEmptyStringSchema.optional(),
  duration: SceneTimeSchema,
  fade: z.enum(["in", "out", "in-out"]).optional(),
});
const AreaTransferSchema = verb("area.transfer", {
  region: NonEmptyStringSchema,
  from: NonEmptyStringSchema,
  to: NonEmptyStringSchema,
  duration: SceneTimeSchema,
});
const FrontlineSetSchema = verb("frontline.set", {
  through: z.array(ScenePlaceSchema).min(2),
  duration: SceneTimeSchema,
});
const FrontlineShiftSchema = verb("frontline.shift", {
  to: z.array(ScenePlaceSchema).min(2),
  duration: SceneTimeSchema,
});
const BorderShowSchema = verb("border.show", {
  dataset: NonEmptyStringSchema,
  duration: SceneTimeSchema,
});
const EncircleSchema = verb("encircle", {
  region: NonEmptyStringSchema.optional(),
  at_place: ScenePlaceSchema.optional(),
  duration: SceneTimeSchema,
});
const SupplyLineSchema = verb("supply.line", {
  from: ScenePlaceSchema,
  to: ScenePlaceSchema,
  duration: SceneTimeSchema,
  flow: z.boolean().optional(),
});

const TextTitleSchema = verb("text.title", {
  text: z.string(),
  subtitle: z.string().optional(),
  position: NonEmptyStringSchema.optional(),
  duration: SceneTimeSchema,
  reveal: NonEmptyStringSchema.optional(),
});
const TextCaptionSchema = verb("text.caption", {
  text: z.string(),
  position: NonEmptyStringSchema.optional(),
  duration: SceneTimeSchema,
});
const TextCalloutSchema = verb("text.callout", {
  text: z.string(),
  at_place: ScenePlaceSchema,
  duration: SceneTimeSchema,
  leader: z.boolean().optional(),
});
const TextDateSchema = verb("text.date", {
  date: z.string(),
  position: NonEmptyStringSchema.optional(),
  duration: SceneTimeSchema,
});
const TextCounterSchema = verb("text.counter", {
  from: FiniteNumberSchema,
  to: FiniteNumberSchema,
  label: z.string().optional(),
  duration: SceneTimeSchema,
});
const LabelPlaceSchema = verb("label.place", {
  place: ScenePlaceSchema,
  duration: SceneTimeSchema,
  style: z.record(z.string(), z.unknown()).optional(),
});
const ArrowDrawSchema = verb("arrow.draw", {
  along: NonEmptyStringSchema.optional(),
  from: ScenePlaceSchema.optional(),
  to: ScenePlaceSchema.optional(),
  duration: SceneTimeSchema,
  style: z.record(z.string(), z.unknown()).optional(),
});
const LegendShowSchema = verb("legend.show", {
  items: z.array(z.record(z.string(), z.unknown())).min(1),
  position: NonEmptyStringSchema.optional(),
  duration: SceneTimeSchema,
});

const WaitSchema = verb("wait", { duration: SceneTimeSchema });
const MarkerTimelineSchema = verb("marker", {
  label: z.string(),
  color: ColorSchema.optional(),
});
const GroupBeginSchema = verb("group.begin", { label: z.string() });
const GroupEndSchema = verb("group.end", { label: z.string() });

export const SceneTimelineEntrySchema = z.union([
  CameraFocusSchema,
  CameraFrameSchema,
  CameraOrbitSchema,
  CameraFollowTimelineSchema,
  CameraShakeSchema,
  CameraResetSchema,
  UnitSpawnSchema,
  UnitAdvanceSchema,
  UnitRetreatSchema,
  UnitPatrolSchema,
  UnitAttackSchema,
  UnitInterceptSchema,
  UnitDogfightSchema,
  UnitDestroySchema,
  UnitSplitSchema,
  UnitMergeSchema,
  BattleSchema,
  BombardSchema,
  AirstrikeSchema,
  MissileLaunchSchema,
  SiegeSchema,
  AmphibiousLandingSchema,
  AirdropSchema,
  NavalBlockadeSchema,
  AreaHighlightSchema,
  AreaTransferSchema,
  FrontlineSetSchema,
  FrontlineShiftSchema,
  BorderShowSchema,
  EncircleSchema,
  SupplyLineSchema,
  TextTitleSchema,
  TextCaptionSchema,
  TextCalloutSchema,
  TextDateSchema,
  TextCounterSchema,
  LabelPlaceSchema,
  ArrowDrawSchema,
  LegendShowSchema,
  WaitSchema,
  MarkerTimelineSchema,
  GroupBeginSchema,
  GroupEndSchema,
]);

export const SceneScriptV1Schema = z
  .object({
    format: z.literal(SCENE_FORMAT_ID),
    version: z.literal(SCENE_SCRIPT_VERSION),
    meta: SceneMetaSchema,
    map: SceneMapSchema.optional(),
    defaults: SceneDefaultsSchema.optional(),
    places: z.record(NonEmptyStringSchema, ScenePlaceSchema).optional(),
    paths: z.record(NonEmptyStringSchema, ScenePathSchema).optional(),
    factions: z.record(NonEmptyStringSchema, SceneFactionSchema).optional(),
    units: z.array(SceneUnitSchema).optional(),
    timeline: z.array(SceneTimelineEntrySchema),
  })
  .strict();

export const SceneScriptSchema = SceneScriptV1Schema;

export interface VerbCatalogEntry {
  readonly name: z.infer<typeof SceneTimelineEntrySchema>["do"];
  readonly category: "camera" | "units" | "combat" | "geography" | "text" | "control";
  readonly description: string;
  readonly required: readonly string[];
  readonly example: Readonly<Record<string, unknown>>;
}

export const VERB_CATALOG = [
  catalog("camera.focus", "camera", "Move a câmera para um ponto.", ["at", "on", "duration"]),
  catalog("camera.frame", "camera", "Enquadra vários pontos.", ["at", "on", "duration"]),
  catalog("camera.orbit", "camera", "Orbita ao redor de um ponto.", ["at", "on", "duration"]),
  catalog("camera.follow", "camera", "Segue uma unidade.", ["at", "unit", "duration"]),
  catalog("camera.shake", "camera", "Aplica tremor de impacto.", ["at", "intensity", "duration"]),
  catalog("camera.reset", "camera", "Restaura o enquadramento inicial.", ["at", "duration"]),
  catalog("unit.spawn", "units", "Faz uma unidade aparecer.", ["at", "unit", "at_place"]),
  catalog("unit.advance", "units", "Avança uma unidade por path ou destino.", ["at", "unit"]),
  catalog("unit.retreat", "units", "Recua uma unidade.", ["at", "unit"]),
  catalog("unit.patrol", "units", "Patrulha um path.", ["at", "unit", "along", "duration"]),
  catalog("unit.attack", "units", "Avança e engaja um alvo.", ["at", "unit", "target"]),
  catalog("unit.intercept", "units", "Traça curso de interceptação.", ["at", "unit", "target"]),
  catalog("unit.dogfight", "units", "Cria combate aéreo.", ["at", "units", "at_place", "duration"]),
  catalog("unit.destroy", "units", "Remove uma unidade.", ["at", "unit"]),
  catalog("unit.split", "units", "Divide uma unidade.", ["at", "unit", "into", "at_place"]),
  catalog("unit.merge", "units", "Reúne unidades.", ["at", "units", "into", "at_place"]),
  catalog("battle", "combat", "Cria batalha com efeitos.", [
    "at",
    "at_place",
    "intensity",
    "duration",
  ]),
  catalog("bombard", "combat", "Cria bombardeio.", ["at", "at_place", "duration"]),
  catalog("airstrike", "combat", "Cria ataque aéreo.", ["at", "at_place", "duration"]),
  catalog("missile.launch", "combat", "Lança míssil.", ["at", "from", "to", "duration"]),
  catalog("siege", "combat", "Cria cerco.", ["at", "at_place", "duration"]),
  catalog("amphibious.landing", "combat", "Cria desembarque.", [
    "at",
    "from",
    "at_place",
    "duration",
  ]),
  catalog("airdrop", "combat", "Lança paraquedistas.", ["at", "from", "at_place", "duration"]),
  catalog("naval.blockade", "combat", "Cria bloqueio naval.", [
    "at",
    "at_place",
    "radius",
    "duration",
  ]),
  catalog("area.highlight", "geography", "Destaca uma região.", ["at", "region", "duration"]),
  catalog("area.transfer", "geography", "Transfere controle territorial.", [
    "at",
    "region",
    "from",
    "to",
    "duration",
  ]),
  catalog("frontline.set", "geography", "Desenha uma linha de frente.", [
    "at",
    "through",
    "duration",
  ]),
  catalog("frontline.shift", "geography", "Move uma linha de frente.", ["at", "to", "duration"]),
  catalog("border.show", "geography", "Mostra fronteiras de um dataset.", [
    "at",
    "dataset",
    "duration",
  ]),
  catalog("encircle", "geography", "Anima um cerco.", ["at", "duration"]),
  catalog("supply.line", "geography", "Cria linha de suprimento.", [
    "at",
    "from",
    "to",
    "duration",
  ]),
  catalog("text.title", "text", "Mostra um título.", ["at", "text", "duration"]),
  catalog("text.caption", "text", "Mostra uma legenda.", ["at", "text", "duration"]),
  catalog("text.callout", "text", "Mostra chamada ligada a um ponto.", [
    "at",
    "text",
    "at_place",
    "duration",
  ]),
  catalog("text.date", "text", "Mostra uma data.", ["at", "date", "duration"]),
  catalog("text.counter", "text", "Anima um contador.", ["at", "from", "to", "duration"]),
  catalog("label.place", "text", "Rotula um lugar.", ["at", "place", "duration"]),
  catalog("arrow.draw", "text", "Desenha uma seta.", ["at", "duration"]),
  catalog("legend.show", "text", "Mostra uma legenda de facções.", ["at", "items", "duration"]),
  catalog("wait", "control", "Cria um espaçador temporal.", ["at", "duration"]),
  catalog("marker", "control", "Cria marcador na timeline.", ["at", "label"]),
  catalog("group.begin", "control", "Inicia um grupo.", ["at", "label"]),
  catalog("group.end", "control", "Encerra um grupo.", ["at", "label"]),
] as const satisfies readonly VerbCatalogEntry[];

export function parseSceneScript(input: unknown): SceneScript {
  if (typeof input === "object" && input !== null) {
    const version = Reflect.get(input, "version");
    if (typeof version === "number" && version > SCENE_SCRIPT_VERSION) {
      throw new Error(
        `Este Scene Script usa version ${version}, mas esta versão do ${APP_NAME} suporta até ${SCENE_SCRIPT_VERSION}.`,
      );
    }
  }
  return SceneScriptSchema.parse(input);
}

export function safeParseSceneScript(input: unknown) {
  try {
    return { success: true as const, data: parseSceneScript(input) };
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof Error) {
      return { success: false as const, error };
    }
    throw error;
  }
}

function catalog<Name extends VerbCatalogEntry["name"]>(
  name: Name,
  category: VerbCatalogEntry["category"],
  description: string,
  required: readonly string[],
): VerbCatalogEntry {
  const example: Record<string, unknown> = { at: "0s", do: name };
  for (const field of required) {
    if (field !== "at") example[field] = exampleValue(name, field);
  }
  return { name, category, description, required, example };
}

function exampleValue(name: VerbCatalogEntry["name"], field: string): unknown {
  switch (field) {
    case "duration":
      return "1s";
    case "on":
      return name === "camera.frame"
        ? [
            [0, 0],
            [10, 10],
          ]
        : [0, 0];
    case "unit":
      return "unit-1";
    case "units":
      return ["unit-1", "unit-2"];
    case "at_place":
    case "place":
      return [0, 0];
    case "intensity":
      return name === "camera.shake" ? 0.5 : "medium";
    case "along":
      return "path-1";
    case "target":
      return "unit-2";
    case "into":
      return name === "unit.split" ? ["unit-a", "unit-b"] : "unit-merged";
    case "from":
      if (name === "text.counter") return 0;
      if (name === "area.transfer") return "faction-a";
      return [0, 0];
    case "to":
      if (name === "text.counter") return 100;
      if (name === "area.transfer") return "faction-b";
      if (name === "frontline.shift")
        return [
          [0, 0],
          [10, 10],
        ];
      return [10, 10];
    case "radius":
      return 25;
    case "region":
      return "region-1";
    case "through":
      return [
        [0, 0],
        [10, 10],
      ];
    case "dataset":
      return "borders.geojson";
    case "text":
      return "Texto";
    case "date":
      return "1941-06-22";
    case "items":
      return [{ label: "Facção", color: "#8b2635" }];
    case "label":
      return "Marcador";
    default:
      return `<${field}>`;
  }
}

export type SceneTime = z.infer<typeof SceneTimeSchema>;
export type ScenePlace = z.infer<typeof ScenePlaceSchema>;
export type SceneMeta = z.infer<typeof SceneMetaSchema>;
export type SceneMap = z.infer<typeof SceneMapSchema>;
export type SceneDefaults = z.infer<typeof SceneDefaultsSchema>;
export type SceneFaction = z.infer<typeof SceneFactionSchema>;
export type ScenePath = z.infer<typeof ScenePathSchema>;
export type SceneUnit = z.infer<typeof SceneUnitSchema>;
export type SceneTimelineEntry = z.infer<typeof SceneTimelineEntrySchema>;
export type SceneScript = z.infer<typeof SceneScriptSchema>;
