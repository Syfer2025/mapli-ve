import { ColorSchema, Vec2Schema, animatablePropertySchema } from "@theatrum/schema";
import { z } from "zod";
import type { NodeTypeDefinition, PropertyDescriptor } from "./contracts.js";
import { createNodeTypeRegistry, type NodeTypeRegistry } from "./registry.js";

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}

const StringPropertySchema = animatablePropertySchema(z.string());
const NonEmptyStringPropertySchema = animatablePropertySchema(z.string().min(1));
const NumberPropertySchema = animatablePropertySchema(z.number().finite());
const PositiveNumberPropertySchema = animatablePropertySchema(z.number().finite().positive());
const NonNegativeNumberPropertySchema = animatablePropertySchema(z.number().finite().nonnegative());
const ColorPropertySchema = animatablePropertySchema(ColorSchema);

const COMMON_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  {
    path: "anchor",
    label: "Âncora",
    kind: "anchor",
    group: "layout",
    binding: "anchor",
    animatable: false,
  },
  {
    path: "size",
    label: "Tamanho",
    kind: "size",
    group: "layout",
    binding: "size",
    animatable: false,
  },
  {
    path: "transform.position",
    label: "Posição",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    unit: "px",
  },
  {
    path: "transform.rotation",
    label: "Rotação",
    kind: "number",
    group: "transform",
    binding: "animatable",
    animatable: true,
    step: 0.1,
    unit: "degrees",
  },
  {
    path: "transform.scale",
    label: "Escala",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 0.01,
    unit: "ratio",
  },
  {
    path: "transform.opacity",
    label: "Opacidade",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 1,
    step: 0.01,
    unit: "percent",
  },
  {
    path: "transform.anchorPoint",
    label: "Ponto de ancoragem",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    min: 0,
    max: 1,
    step: 0.01,
    unit: "ratio",
  },
  {
    path: "transform.skew",
    label: "Inclinação",
    kind: "vec2",
    group: "transform",
    binding: "animatable",
    animatable: true,
    step: 0.1,
    unit: "degrees",
  },
]);

function property(descriptor: PropertyDescriptor): PropertyDescriptor {
  return descriptor;
}

function defineNodeType<P extends Record<string, unknown>>(
  input: Omit<NodeTypeDefinition<P>, "animatable">,
): NodeTypeDefinition<P> {
  const properties = Object.freeze(
    input.properties.map((descriptor) =>
      Object.freeze({
        ...descriptor,
        ...(descriptor.options === undefined
          ? {}
          : {
              options: Object.freeze(
                descriptor.options.map((option) => Object.freeze({ ...option })),
              ),
            }),
      }),
    ),
  );
  return Object.freeze({
    ...input,
    defaultProps: deepFreeze(input.propertySchema.parse(input.defaultProps)),
    properties,
    animatable: Object.freeze(properties.filter((descriptor) => descriptor.animatable)),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const EmptyPropsSchema = z.object({}).passthrough();

const TextPropsSchema = z
  .object({
    text: StringPropertySchema,
    fontFamily: NonEmptyStringPropertySchema,
    fontSize: PositiveNumberPropertySchema,
    fontWeight: animatablePropertySchema(z.number().int().min(100).max(900)),
    color: ColorPropertySchema,
    align: animatablePropertySchema(z.enum(["left", "center", "right"])),
    lineHeight: PositiveNumberPropertySchema,
    tracking: NumberPropertySchema,
  })
  .passthrough();

const TEXT_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  property({
    path: "props.text",
    label: "Texto",
    kind: "multiline-text",
    group: "content",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.fontFamily",
    label: "Fonte",
    kind: "text",
    group: "content",
    binding: "animatable",
    animatable: false,
  }),
  property({
    path: "props.fontSize",
    label: "Tamanho da fonte",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 1,
    step: 1,
    unit: "px",
  }),
  property({
    path: "props.fontWeight",
    label: "Peso",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: false,
    min: 100,
    max: 900,
    step: 100,
  }),
  property({
    path: "props.color",
    label: "Cor",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.align",
    label: "Alinhamento",
    kind: "enum",
    group: "content",
    binding: "animatable",
    animatable: false,
    options: [
      { value: "left", label: "Esquerda" },
      { value: "center", label: "Centro" },
      { value: "right", label: "Direita" },
    ],
  }),
  property({
    path: "props.lineHeight",
    label: "Altura da linha",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    min: 0.1,
    step: 0.05,
    unit: "ratio",
  }),
  property({
    path: "props.tracking",
    label: "Espaçamento",
    kind: "number",
    group: "content",
    binding: "animatable",
    animatable: true,
    step: 0.1,
    unit: "px",
  }),
]);

const ImagePropsSchema = z
  .object({
    assetId: StringPropertySchema,
    fit: animatablePropertySchema(z.enum(["contain", "cover", "fill"])),
    tint: ColorPropertySchema,
  })
  .passthrough();

const SvgPropsSchema = z
  .object({
    assetId: StringPropertySchema,
    fill: ColorPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const LinePropsSchema = z
  .object({
    points: z.array(Vec2Schema).min(2),
    stroke: ColorPropertySchema,
    strokeWidth: PositiveNumberPropertySchema,
  })
  .passthrough();

const PolygonPropsSchema = z
  .object({
    points: z.array(Vec2Schema).min(3),
    fill: ColorPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const CirclePropsSchema = z
  .object({
    radius: PositiveNumberPropertySchema,
    fill: ColorPropertySchema,
    stroke: ColorPropertySchema,
    strokeWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const SymbolPropsSchema = z
  .object({
    iconId: StringPropertySchema,
    color: ColorPropertySchema,
    outline: ColorPropertySchema,
    outlineWidth: NonNegativeNumberPropertySchema,
  })
  .passthrough();

const UnitPropsSchema = z
  .object({
    assetId: StringPropertySchema,
    callsign: StringPropertySchema,
    affiliation: animatablePropertySchema(z.enum(["friendly", "hostile", "neutral", "unknown"])),
    tint: ColorPropertySchema,
  })
  .passthrough();

const ASSET_ID_PROPERTY = property({
  path: "props.assetId",
  label: "Asset",
  kind: "asset",
  group: "content",
  binding: "animatable",
  animatable: false,
});

const COLOR_PROPERTY = property({
  path: "props.color",
  label: "Cor",
  kind: "color",
  group: "appearance",
  binding: "animatable",
  animatable: true,
});

const STROKE_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  property({
    path: "props.stroke",
    label: "Traço",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.strokeWidth",
    label: "Espessura",
    kind: "number",
    group: "appearance",
    binding: "animatable",
    animatable: true,
    min: 0,
    step: 0.1,
    unit: "px",
  }),
]);

const POINTS_PROPERTY = property({
  path: "props.points",
  label: "Pontos",
  kind: "points",
  group: "content",
  binding: "geometry",
  animatable: false,
});

export const GROUP_NODE_TYPE = defineNodeType({
  type: "group",
  category: "structure",
  label: "Grupo",
  icon: "layers",
  defaultProps: {},
  propertySchema: EmptyPropsSchema,
  properties: COMMON_PROPERTIES,
  supportsChildren: true,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const NULL_NODE_TYPE = defineNodeType({
  type: "null",
  category: "structure",
  label: "Objeto nulo",
  icon: "crosshair",
  defaultProps: {},
  propertySchema: EmptyPropsSchema,
  properties: COMMON_PROPERTIES,
  supportsChildren: true,
  defaultAnchorSpace: "parent",
  defaultSizeMode: "screen",
});

const PrecompPropsSchema = z
  .object({
    compositionId: StringPropertySchema,
    /** Congela o conteúdo interno no frame apontado por `timeRemap`. */
    freeze: animatablePropertySchema(z.boolean()),
  })
  .passthrough();

/**
 * Pré-composição: um nó que carrega outra composição inteira. A expansão é do
 * avaliador (`animation`), porque aninhar é operação de tempo e hierarquia — o
 * `timeRemap` do nó escolhe qual frame interno entra, e o transform dele vira o
 * pai da raiz aninhada. Aqui só vive a declaração do tipo.
 */
export const PRECOMP_NODE_TYPE = defineNodeType({
  type: "precomp",
  category: "structure",
  label: "Pré-composição",
  icon: "layers-2",
  defaultProps: {
    compositionId: animatable(""),
    freeze: animatable(false),
  },
  propertySchema: PrecompPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.compositionId",
      label: "Composição",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    property({
      path: "props.freeze",
      label: "Congelar",
      kind: "boolean",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
  ],
  supportsChildren: true,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const TEXT_TITLE_NODE_TYPE = defineNodeType({
  type: "text.title",
  category: "text",
  label: "Título",
  icon: "type",
  defaultProps: {
    text: animatable("Título"),
    fontFamily: animatable("Inter"),
    fontSize: animatable(72),
    fontWeight: animatable(700),
    color: animatable("#ffffffff"),
    align: animatable("center" as const),
    lineHeight: animatable(1.1),
    tracking: animatable(0),
  },
  propertySchema: TextPropsSchema,
  properties: [...COMMON_PROPERTIES, ...TEXT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const TEXT_LABEL_NODE_TYPE = defineNodeType({
  type: "text.label",
  category: "text",
  label: "Rótulo",
  icon: "tag",
  defaultProps: {
    text: animatable("Rótulo"),
    fontFamily: animatable("Inter"),
    fontSize: animatable(24),
    fontWeight: animatable(600),
    color: animatable("#ffffffff"),
    align: animatable("center" as const),
    lineHeight: animatable(1.2),
    tracking: animatable(0),
  },
  propertySchema: TextPropsSchema,
  properties: [...COMMON_PROPERTIES, ...TEXT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const IMAGE_NODE_TYPE = defineNodeType({
  type: "image",
  category: "media",
  label: "Imagem",
  icon: "image",
  defaultProps: {
    assetId: animatable(""),
    fit: animatable("contain" as const),
    tint: animatable("#ffffffff"),
  },
  propertySchema: ImagePropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    ASSET_ID_PROPERTY,
    property({
      path: "props.fit",
      label: "Ajuste",
      kind: "enum",
      group: "content",
      binding: "animatable",
      animatable: false,
      options: [
        { value: "contain", label: "Conter" },
        { value: "cover", label: "Cobrir" },
        { value: "fill", label: "Preencher" },
      ],
    }),
    property({
      path: "props.tint",
      label: "Tonalidade",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const SVG_NODE_TYPE = defineNodeType({
  type: "svg",
  category: "media",
  label: "SVG",
  icon: "bezier-curve",
  defaultProps: {
    assetId: animatable(""),
    fill: animatable("#ffffffff"),
    stroke: animatable("#000000ff"),
    strokeWidth: animatable(0),
  },
  propertySchema: SvgPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    ASSET_ID_PROPERTY,
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    ...STROKE_PROPERTIES,
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const SHAPE_LINE_NODE_TYPE = defineNodeType({
  type: "shape.line",
  category: "shape",
  label: "Linha",
  icon: "minus",
  defaultProps: {
    points: [
      [0, 0],
      [100, 0],
    ],
    stroke: animatable("#ffffffff"),
    strokeWidth: animatable(4),
  },
  propertySchema: LinePropsSchema,
  properties: [...COMMON_PROPERTIES, POINTS_PROPERTY, ...STROKE_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

export const SHAPE_POLYGON_NODE_TYPE = defineNodeType({
  type: "shape.polygon",
  category: "shape",
  label: "Polígono",
  icon: "pentagon",
  defaultProps: {
    points: [
      [50, 0],
      [100, 100],
      [0, 100],
    ],
    fill: animatable("#3b82f680"),
    stroke: animatable("#60a5faff"),
    strokeWidth: animatable(2),
  },
  propertySchema: PolygonPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    POINTS_PROPERTY,
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    ...STROKE_PROPERTIES,
  ],
  supportsChildren: false,
  defaultAnchorSpace: "comp",
  defaultSizeMode: "screen",
});

/**
 * Tipo escrito do zero para provar o critério 5 da Fase 4: um tipo novo toca
 * este arquivo de registro e `renderer/src/builtins.ts`. Timeline, Inspector,
 * comandos, seleção e serialização não recebem uma linha sequer.
 */
export const SHAPE_CIRCLE_NODE_TYPE = defineNodeType({
  type: "shape.circle",
  category: "shape",
  label: "Círculo",
  icon: "circle",
  defaultProps: {
    radius: animatable(48),
    fill: animatable("#3b82f680"),
    stroke: animatable("#60a5faff"),
    strokeWidth: animatable(2),
  },
  propertySchema: CirclePropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.radius",
      label: "Raio",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 1,
      unit: "px",
    }),
    property({
      path: "props.fill",
      label: "Preenchimento",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    ...STROKE_PROPERTIES,
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const SYMBOL_ICON_NODE_TYPE = defineNodeType({
  type: "symbol.icon",
  category: "symbol",
  label: "Ícone",
  icon: "map-pin",
  defaultProps: {
    iconId: animatable("marker"),
    color: animatable("#ffffffff"),
    outline: animatable("#000000ff"),
    outlineWidth: animatable(1),
  },
  propertySchema: SymbolPropsSchema,
  properties: [
    ...COMMON_PROPERTIES,
    property({
      path: "props.iconId",
      label: "Ícone",
      kind: "text",
      group: "content",
      binding: "animatable",
      animatable: false,
    }),
    COLOR_PROPERTY,
    property({
      path: "props.outline",
      label: "Contorno",
      kind: "color",
      group: "appearance",
      binding: "animatable",
      animatable: true,
    }),
    property({
      path: "props.outlineWidth",
      label: "Espessura do contorno",
      kind: "number",
      group: "appearance",
      binding: "animatable",
      animatable: true,
      min: 0,
      step: 0.1,
      unit: "px",
    }),
  ],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

const UNIT_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([
  ASSET_ID_PROPERTY,
  property({
    path: "props.callsign",
    label: "Identificação",
    kind: "text",
    group: "content",
    binding: "animatable",
    animatable: true,
  }),
  property({
    path: "props.affiliation",
    label: "Afiliação",
    kind: "enum",
    group: "content",
    binding: "animatable",
    animatable: false,
    options: [
      { value: "friendly", label: "Aliado" },
      { value: "hostile", label: "Hostil" },
      { value: "neutral", label: "Neutro" },
      { value: "unknown", label: "Desconhecido" },
    ],
  }),
  property({
    path: "props.tint",
    label: "Tonalidade",
    kind: "color",
    group: "appearance",
    binding: "animatable",
    animatable: true,
  }),
]);

export const UNIT_ARMOR_NODE_TYPE = defineNodeType({
  type: "unit.armor",
  category: "unit",
  label: "Blindado",
  icon: "shield",
  defaultProps: {
    assetId: animatable("lib:unit.armor.default"),
    callsign: animatable(""),
    affiliation: animatable("friendly" as const),
    tint: animatable("#ffffffff"),
  },
  propertySchema: UnitPropsSchema,
  properties: [...COMMON_PROPERTIES, ...UNIT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const UNIT_INFANTRY_NODE_TYPE = defineNodeType({
  type: "unit.infantry",
  category: "unit",
  label: "Infantaria",
  icon: "person-standing",
  defaultProps: {
    assetId: animatable("lib:unit.infantry.default"),
    callsign: animatable(""),
    affiliation: animatable("friendly" as const),
    tint: animatable("#ffffffff"),
  },
  propertySchema: UnitPropsSchema,
  properties: [...COMMON_PROPERTIES, ...UNIT_PROPERTIES],
  supportsChildren: false,
  defaultAnchorSpace: "geo",
  defaultSizeMode: "screen",
});

export const BUILTIN_NODE_TYPE_IDS = Object.freeze([
  "group",
  "null",
  "precomp",
  "text.title",
  "text.label",
  "image",
  "svg",
  "shape.line",
  "shape.polygon",
  "shape.circle",
  "symbol.icon",
  "unit.armor",
  "unit.infantry",
] as const);

export type BuiltinNodeType = (typeof BUILTIN_NODE_TYPE_IDS)[number];

export const BUILTIN_NODE_TYPES: readonly NodeTypeDefinition[] = Object.freeze([
  GROUP_NODE_TYPE,
  NULL_NODE_TYPE,
  PRECOMP_NODE_TYPE,
  TEXT_TITLE_NODE_TYPE,
  TEXT_LABEL_NODE_TYPE,
  IMAGE_NODE_TYPE,
  SVG_NODE_TYPE,
  SHAPE_LINE_NODE_TYPE,
  SHAPE_POLYGON_NODE_TYPE,
  SHAPE_CIRCLE_NODE_TYPE,
  SYMBOL_ICON_NODE_TYPE,
  UNIT_ARMOR_NODE_TYPE,
  UNIT_INFANTRY_NODE_TYPE,
]);

export function createBuiltinNodeTypeRegistry(): NodeTypeRegistry {
  return createNodeTypeRegistry(BUILTIN_NODE_TYPES);
}
