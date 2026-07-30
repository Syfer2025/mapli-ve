import { z } from "zod";
import {
  FrameAnimatablePropertySchema,
  NumberAnimatablePropertySchema,
  UnknownAnimatablePropertySchema,
  Vec2AnimatablePropertySchema,
} from "./animation.js";
import { APP_NAME, FORMAT_ID, PROJECT_CONTAINER_VERSION, SCHEMA_VERSION } from "./branding.js";
import {
  ColorSchema,
  FiniteNumberSchema,
  FrameSchema,
  IdentifierSchema,
  JsonObjectSchema,
  LongitudeLatitudeSchema,
  NonEmptyStringSchema,
  PositiveNumberSchema,
  Vec2Schema,
} from "./primitives.js";

export const TimeRangeSchema = z
  .object({
    in: FrameSchema,
    out: FrameSchema,
  })
  .passthrough()
  .refine((range) => range.in <= range.out, {
    message: "timeRange.in deve ser menor ou igual a timeRange.out",
    path: ["out"],
  });

export const AnchorSchema = z.discriminatedUnion("space", [
  z
    .object({
      space: z.literal("geo"),
      lngLat: LongitudeLatitudeSchema,
      altitude: FiniteNumberSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      space: z.literal("comp"),
      position: Vec2Schema,
    })
    .passthrough(),
  z
    .object({
      space: z.literal("parent"),
      offset: Vec2Schema,
    })
    .passthrough(),
]);

export const SizeSpecSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("screen"), size: Vec2Schema }).passthrough(),
  z.object({ mode: z.literal("ground"), meters: Vec2Schema }).passthrough(),
]);

export const TransformSchema = z
  .object({
    position: Vec2AnimatablePropertySchema,
    rotation: NumberAnimatablePropertySchema,
    scale: Vec2AnimatablePropertySchema,
    opacity: NumberAnimatablePropertySchema.refine(
      (property) =>
        property.value >= 0 &&
        property.value <= 1 &&
        property.keyframes.every((keyframe) => {
          const value = keyframe.value;
          return typeof value === "number" && value >= 0 && value <= 1;
        }),
      "opacidade deve estar entre 0 e 1",
    ),
    anchorPoint: Vec2AnimatablePropertySchema,
    skew: Vec2AnimatablePropertySchema,
    rotationReference: z.enum(["screen", "geo-bearing"]),
  })
  .passthrough();

export const EffectInstanceDataSchema = z
  .object({
    id: IdentifierSchema,
    type: NonEmptyStringSchema,
    enabled: z.boolean(),
    params: z.record(z.string(), z.union([UnknownAnimatablePropertySchema, z.unknown()])),
  })
  .passthrough();

export const BehaviorInstanceDataSchema = z
  .object({
    id: IdentifierSchema,
    type: NonEmptyStringSchema,
    enabled: z.boolean(),
    params: JsonObjectSchema,
  })
  .passthrough();

export const ActionInstanceDataSchema = z
  .object({
    id: IdentifierSchema,
    type: NonEmptyStringSchema,
    enabled: z.boolean(),
    mode: z.enum(["live", "baked"]),
    startFrame: FrameSchema,
    params: JsonObjectSchema,
  })
  .passthrough();

export const LabelColorSchema = z.enum([
  "none",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "gray",
]);

export const BlendModeSchema = z.enum([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "add",
]);

/**
 * Como o nó de origem recorta o nó que o usa.
 *
 * `alpha` usa a transparência da origem; `luma`, o brilho dela. As variantes
 * invertidas trocam o que fica visível pelo que fica escondido. É a mesma
 * nomenclatura do After Effects, e por um motivo prático: quem já monta mapas
 * animados espera esses quatro nomes.
 */
export const TrackMatteModeSchema = z.enum(["alpha", "alpha-inverted", "luma", "luma-inverted"]);

export const TrackMatteSchema = z
  .object({
    /**
     * Nó que serve de recorte. Ele deixa de ser desenhado por conta própria: só
     * existe como máscara, como no After Effects.
     */
    source: IdentifierSchema,
    mode: TrackMatteModeSchema,
  })
  .passthrough();

export const NodeSchema = z
  .object({
    id: IdentifierSchema,
    type: NonEmptyStringSchema,
    name: z.string(),
    parent: IdentifierSchema.nullable(),
    children: z.array(IdentifierSchema),
    enabled: z.boolean(),
    locked: z.boolean(),
    solo: z.boolean(),
    shy: z.boolean(),
    label: LabelColorSchema,
    timeRange: TimeRangeSchema,
    timeRemap: FrameAnimatablePropertySchema.nullable(),
    anchor: AnchorSchema,
    size: SizeSpecSchema,
    transform: TransformSchema,
    blendMode: BlendModeSchema,
    trackMatte: TrackMatteSchema.nullable(),
    motionBlur: z.boolean(),
    props: JsonObjectSchema,
    effects: z.array(EffectInstanceDataSchema),
    behaviors: z.array(BehaviorInstanceDataSchema),
    actions: z.array(ActionInstanceDataSchema),
  })
  .passthrough();

export const PathVertexSchema = z
  .object({
    point: Vec2Schema,
    inHandle: Vec2Schema.nullable(),
    outHandle: Vec2Schema.nullable(),
    altitude: FiniteNumberSchema.optional(),
  })
  .passthrough();

export const PathDataSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string(),
    space: z.enum(["geo", "comp"]),
    vertices: z.array(PathVertexSchema).min(1),
    closed: z.boolean(),
    interpolation: z.enum(["linear", "bezier", "catmull-rom"]),
    geodesic: z.boolean(),
  })
  .passthrough();

export const CameraFollowSchema = z
  .object({
    nodeId: IdentifierSchema,
    offset: Vec2Schema,
    damping: FiniteNumberSchema.min(0).max(1),
    matchBearing: z.boolean(),
  })
  .passthrough();

export const CameraPathSchema = z
  .object({
    pathId: IdentifierSchema,
    progress: NumberAnimatablePropertySchema,
    orientToPath: z.boolean().optional(),
  })
  .passthrough();

export const CameraSchema = z
  .object({
    center: Vec2AnimatablePropertySchema,
    zoom: NumberAnimatablePropertySchema,
    bearing: NumberAnimatablePropertySchema,
    pitch: NumberAnimatablePropertySchema,
    roll: NumberAnimatablePropertySchema,
    fov: NumberAnimatablePropertySchema,
    follow: CameraFollowSchema.nullable(),
    path: CameraPathSchema.nullable(),
  })
  .passthrough();

export const MapSettingsSchema = z
  .object({
    styleId: IdentifierSchema,
    projection: z.enum(["mercator", "globe", "albers", "equal-earth"]),
    terrain: z
      .object({
        enabled: z.boolean(),
        exaggeration: NonNegativeFiniteSchema(),
        sourceId: IdentifierSchema,
      })
      .passthrough()
      .nullable(),
    visible: z.boolean(),
    fadeDuration: NonNegativeFiniteSchema(),
  })
  .passthrough();

function NonNegativeFiniteSchema() {
  return FiniteNumberSchema.nonnegative();
}

export const MarkerSchema = z
  .object({
    frame: FrameSchema,
    label: z.string(),
    color: ColorSchema,
    duration: FrameSchema.optional(),
    comment: z.string().optional(),
  })
  .passthrough();

export const GuideSchema = z
  .object({
    orientation: z.enum(["horizontal", "vertical"]),
    position: FiniteNumberSchema,
    color: ColorSchema.optional(),
    locked: z.boolean().optional(),
  })
  .passthrough();

/**
 * Faixa de áudio usada somente como referência editorial. O arquivo continua
 * pertencendo à Biblioteca e é apontado pelo mesmo `src` persistido usado
 * pelos nós visuais; não há mixagem nem reprodução implícita no documento.
 */
export const ReferenceAudioSchema = z
  .object({
    assetSrc: NonEmptyStringSchema,
    startFrame: FrameSchema,
  })
  .passthrough();

export const CompositionSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string(),
    fps: PositiveNumberSchema,
    duration: FrameSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    pixelAspect: PositiveNumberSchema,
    workArea: z.tuple([FrameSchema, FrameSchema]),
    background: ColorSchema,
    map: MapSettingsSchema,
    camera: CameraSchema,
    root: IdentifierSchema,
    nodes: z.record(IdentifierSchema, NodeSchema),
    markers: z.array(MarkerSchema),
    guides: z.array(GuideSchema),
    referenceAudio: ReferenceAudioSchema.nullable().optional(),
    seed: z.number().int(),
  })
  .passthrough()
  .superRefine((composition, context) => {
    if (composition.workArea[0] > composition.workArea[1]) {
      context.addIssue({
        code: "custom",
        path: ["workArea", 1],
        message: "workArea inicial deve ser menor ou igual ao final",
      });
    }
    if (composition.workArea[1] > composition.duration) {
      context.addIssue({
        code: "custom",
        path: ["workArea", 1],
        message: "workArea não pode ultrapassar a duração",
      });
    }
    if (!(composition.root in composition.nodes)) {
      context.addIssue({
        code: "custom",
        path: ["root"],
        message: `nó raiz "${composition.root}" não existe`,
      });
    }
  });

export const AssetDescriptorSchema = z
  .object({
    id: IdentifierSchema,
    kind: NonEmptyStringSchema,
    src: NonEmptyStringSchema,
    meta: JsonObjectSchema,
  })
  .passthrough();

export const GeoDataDescriptorSchema = z
  .object({
    id: IdentifierSchema,
    kind: NonEmptyStringSchema,
    src: NonEmptyStringSchema,
    meta: JsonObjectSchema,
  })
  .passthrough();

export const MapStyleDescriptorSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string(),
    src: NonEmptyStringSchema,
    kind: NonEmptyStringSchema,
  })
  .passthrough();

export const PaletteSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string(),
    colors: z.record(z.string(), ColorSchema),
  })
  .passthrough();

export const ProjectSettingsSchema = z
  .object({
    defaultFps: PositiveNumberSchema,
    defaultResolution: Vec2Schema.refine(
      ([width, height]) =>
        Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0,
      "resolução deve conter inteiros positivos",
    ),
    units: z.enum(["metric", "imperial"]),
    dateFormat: z.string(),
    language: NonEmptyStringSchema,
    colorSpace: z.enum(["srgb", "display-p3"]),
  })
  .passthrough();

export const ProjectDocumentV1Schema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: IdentifierSchema,
    name: z.string(),
    settings: ProjectSettingsSchema,
    assets: z.array(AssetDescriptorSchema),
    geoData: z.array(GeoDataDescriptorSchema),
    paths: z.record(IdentifierSchema, PathDataSchema),
    styles: z.array(MapStyleDescriptorSchema),
    palettes: z.array(PaletteSchema),
    compositions: z.array(CompositionSchema),
  })
  .passthrough();

export const ProjectDocumentSchema = ProjectDocumentV1Schema;

export const ProjectManifestV1Schema = z
  .object({
    format: z.literal(FORMAT_ID),
    container: z.literal(PROJECT_CONTAINER_VERSION),
    schemaVersion: z.literal(SCHEMA_VERSION),
    app: z
      .object({
        name: z.literal(APP_NAME),
        version: NonEmptyStringSchema,
      })
      .passthrough(),
    project: z
      .object({
        id: IdentifierSchema,
        name: z.string(),
      })
      .passthrough(),
    created: z.iso.datetime(),
    modified: z.iso.datetime(),
    stats: z
      .object({
        compositions: z.number().int().nonnegative(),
        nodes: z.number().int().nonnegative(),
        assets: z.number().int().nonnegative(),
        durationFrames: FrameSchema,
      })
      .passthrough(),
  })
  .passthrough();

export const ProjectManifestSchema = ProjectManifestV1Schema;

export type TimeRange = z.infer<typeof TimeRangeSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type SizeSpec = z.infer<typeof SizeSpecSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type EffectInstanceData = z.infer<typeof EffectInstanceDataSchema>;
export type BehaviorInstanceData = z.infer<typeof BehaviorInstanceDataSchema>;
export type ActionInstanceData = z.infer<typeof ActionInstanceDataSchema>;
export type LabelColor = z.infer<typeof LabelColorSchema>;
export type BlendMode = z.infer<typeof BlendModeSchema>;
export type TrackMatteMode = z.infer<typeof TrackMatteModeSchema>;
export type TrackMatte = z.infer<typeof TrackMatteSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type PathVertex = z.infer<typeof PathVertexSchema>;
export type PathData = z.infer<typeof PathDataSchema>;
export type CameraFollow = z.infer<typeof CameraFollowSchema>;
export type CameraPath = z.infer<typeof CameraPathSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type MapSettings = z.infer<typeof MapSettingsSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type Guide = z.infer<typeof GuideSchema>;
export type ReferenceAudio = z.infer<typeof ReferenceAudioSchema>;
export type Composition = z.infer<typeof CompositionSchema>;
export type AssetDescriptor = z.infer<typeof AssetDescriptorSchema>;
export type GeoDataDescriptor = z.infer<typeof GeoDataDescriptorSchema>;
export type MapStyleDescriptor = z.infer<typeof MapStyleDescriptorSchema>;
export type Palette = z.infer<typeof PaletteSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
