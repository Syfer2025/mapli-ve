import {
  AnchorSchema,
  BehaviorInstanceDataSchema,
  BlendModeSchema,
  CameraFollowSchema,
  CameraPathSchema,
  ColorSchema,
  CompositionSchema,
  EasingHandleSchema,
  FrameAnimatablePropertySchema,
  FrameSchema,
  MapSettingsSchema,
  NodeSchema,
  PathDataSchema,
  PathVertexSchema,
  ProjectSettingsSchema,
  SizeSpecSchema,
  TrackMatteSchema,
  keyframeSchema,
} from "@theatrum/schema";
import { z } from "zod";

const IdentifierSchema = z.string().min(1);
const CommandSourceSchema = z.enum(["user", "plugin", "script", "system"]);
const PropertySegmentSchema = z.union([
  z
    .string()
    .min(1)
    .refine(
      (segment) => !["__proto__", "prototype", "constructor"].includes(segment),
      "segmento de propriedade reservado",
    ),
  z.number().int().nonnegative(),
]);
const PropertyTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: IdentifierSchema }).strict(),
  z.object({ kind: z.literal("camera") }).strict(),
]);
const PropertyLocationSchema = z
  .object({
    compositionId: IdentifierSchema,
    target: PropertyTargetSchema,
    path: z.array(PropertySegmentSchema).min(1),
  })
  .strict();
const KeyframeSchema = keyframeSchema(z.unknown());
const KeyframeArraySchema = z.array(KeyframeSchema).superRefine((keyframes, context) => {
  const frames = new Set<number>();
  const ids = new Set<string>();
  keyframes.forEach((keyframe, index) => {
    if (frames.has(keyframe.frame)) {
      context.addIssue({
        code: "custom",
        path: [index, "frame"],
        message: `frame duplicado: ${keyframe.frame}`,
      });
    }
    if (ids.has(keyframe.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `id de keyframe duplicado: ${keyframe.id}`,
      });
    }
    frames.add(keyframe.frame);
    ids.add(keyframe.id);
  });
});

function commandSchema<const T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z
    .object({
      type: z.literal(type),
      payload,
      source: CommandSourceSchema.optional(),
    })
    .strict();
}

export const CommandSchemas = {
  "project.rename": commandSchema("project.rename", z.object({ name: z.string() }).strict()),
  "project.update-settings": commandSchema(
    "project.update-settings",
    z.object({ settings: ProjectSettingsSchema.partial() }).strict(),
  ),

  "composition.create": commandSchema(
    "composition.create",
    z.object({ composition: CompositionSchema }).strict(),
  ),
  "composition.duplicate": commandSchema(
    "composition.duplicate",
    z.object({ composition: CompositionSchema }).strict(),
  ),
  "composition.rename": commandSchema(
    "composition.rename",
    z.object({ compositionId: IdentifierSchema, name: z.string() }).strict(),
  ),
  "composition.delete": commandSchema(
    "composition.delete",
    z.object({ compositionId: IdentifierSchema }).strict(),
  ),
  "composition.set-duration": commandSchema(
    "composition.set-duration",
    z.object({ compositionId: IdentifierSchema, duration: FrameSchema }).strict(),
  ),
  "composition.set-fps": commandSchema(
    "composition.set-fps",
    z
      .object({
        compositionId: IdentifierSchema,
        fps: z.number().finite().positive(),
        mode: z.enum(["remap", "reinterpret"]),
      })
      .strict(),
  ),
  "composition.set-resolution": commandSchema(
    "composition.set-resolution",
    z
      .object({
        compositionId: IdentifierSchema,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        pixelAspect: z.number().finite().positive().optional(),
      })
      .strict(),
  ),
  "composition.set-work-area": commandSchema(
    "composition.set-work-area",
    z
      .object({
        compositionId: IdentifierSchema,
        workArea: z.tuple([FrameSchema, FrameSchema]),
      })
      .strict()
      .refine(({ workArea }) => workArea[0] <= workArea[1], "workArea invertida"),
  ),
  "composition.set-background": commandSchema(
    "composition.set-background",
    z.object({ compositionId: IdentifierSchema, background: ColorSchema }).strict(),
  ),
  "composition.set-seed": commandSchema(
    "composition.set-seed",
    z.object({ compositionId: IdentifierSchema, seed: z.number().int() }).strict(),
  ),
  "composition.set-map": commandSchema(
    "composition.set-map",
    z.object({ compositionId: IdentifierSchema, map: MapSettingsSchema }).strict(),
  ),

  "node.create": commandSchema(
    "node.create",
    z
      .object({
        compositionId: IdentifierSchema,
        parentId: IdentifierSchema,
        node: NodeSchema,
        index: z.number().int().nonnegative().optional(),
      })
      .strict(),
  ),
  "node.rename": commandSchema(
    "node.rename",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        name: z.string(),
      })
      .strict(),
  ),
  "node.reparent": commandSchema(
    "node.reparent",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        parentId: IdentifierSchema,
        index: z.number().int().nonnegative().optional(),
      })
      .strict(),
  ),
  "node.reorder": commandSchema(
    "node.reorder",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        index: z.number().int().nonnegative(),
      })
      .strict(),
  ),
  "node.delete": commandSchema(
    "node.delete",
    z.object({ compositionId: IdentifierSchema, nodeId: IdentifierSchema }).strict(),
  ),
  "node.set-flags": commandSchema(
    "node.set-flags",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        flags: z
          .object({
            enabled: z.boolean().optional(),
            locked: z.boolean().optional(),
            solo: z.boolean().optional(),
            shy: z.boolean().optional(),
            motionBlur: z.boolean().optional(),
          })
          .strict()
          .refine((flags) => Object.keys(flags).length > 0, "informe ao menos uma flag"),
      })
      .strict(),
  ),
  "node.set-time-range": commandSchema(
    "node.set-time-range",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        in: FrameSchema,
        out: FrameSchema,
      })
      .strict()
      .refine((payload) => payload.in <= payload.out, "timeRange invertido"),
  ),
  /**
   * `timeRemap` nasce nulo, então `property.set` não alcança — ele exige um
   * wrapper animável já existente. Como `timeRange`, o campo tem comando próprio.
   */
  "node.set-time-remap": commandSchema(
    "node.set-time-remap",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        timeRemap: FrameAnimatablePropertySchema.nullable(),
      })
      .strict(),
  ),
  "node.set-anchor": commandSchema(
    "node.set-anchor",
    z
      .object({ compositionId: IdentifierSchema, nodeId: IdentifierSchema, anchor: AnchorSchema })
      .strict(),
  ),
  "node.set-size": commandSchema(
    "node.set-size",
    z
      .object({ compositionId: IdentifierSchema, nodeId: IdentifierSchema, size: SizeSpecSchema })
      .strict(),
  ),
  "node.set-blend-mode": commandSchema(
    "node.set-blend-mode",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        blendMode: BlendModeSchema,
      })
      .strict(),
  ),

  /**
   * Recorte por outro nó. Nulo desliga. O comando não valida ciclo nem origem
   * ausente: isso é papel do validador de documento, que vê a composição toda.
   */
  "node.set-track-matte": commandSchema(
    "node.set-track-matte",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        trackMatte: TrackMatteSchema.nullable(),
      })
      .strict(),
  ),

  "property.set": commandSchema(
    "property.set",
    PropertyLocationSchema.extend({ value: z.unknown() }).strict(),
  ),
  "property.reset": commandSchema(
    "property.reset",
    PropertyLocationSchema.extend({ value: z.unknown() }).strict(),
  ),
  "property.set-expression": commandSchema(
    "property.set-expression",
    PropertyLocationSchema.extend({ expression: z.string().nullable() }).strict(),
  ),

  "keyframe.set": commandSchema(
    "keyframe.set",
    PropertyLocationSchema.extend({ keyframe: KeyframeSchema }).strict(),
  ),
  "keyframe.remove": commandSchema(
    "keyframe.remove",
    PropertyLocationSchema.extend({ keyframeId: IdentifierSchema }).strict(),
  ),
  "keyframe.move": commandSchema(
    "keyframe.move",
    PropertyLocationSchema.extend({ keyframeId: IdentifierSchema, frame: FrameSchema }).strict(),
  ),
  "keyframe.set-easing": commandSchema(
    "keyframe.set-easing",
    PropertyLocationSchema.extend({
      keyframeId: IdentifierSchema,
      in: EasingHandleSchema.optional(),
      out: EasingHandleSchema.optional(),
    })
      .strict()
      .refine(
        (payload) => payload.in !== undefined || payload.out !== undefined,
        "informe in ou out",
      ),
  ),
  "keyframe.clear": commandSchema("keyframe.clear", PropertyLocationSchema),
  "keyframe.replace-all": commandSchema(
    "keyframe.replace-all",
    PropertyLocationSchema.extend({ keyframes: KeyframeArraySchema }).strict(),
  ),

  // Caminhos vivem no projeto, não na composição: a mesma rota serve a várias
  // cenas e a vários objetos. Ver docs/03-DATA-MODEL.md § 7.
  "path.create": commandSchema("path.create", z.object({ path: PathDataSchema }).strict()),
  "path.delete": commandSchema("path.delete", z.object({ pathId: IdentifierSchema }).strict()),
  "path.rename": commandSchema(
    "path.rename",
    z.object({ pathId: IdentifierSchema, name: z.string() }).strict(),
  ),
  /**
   * Um único comando cobre inserir, mover e remover vértice. O caminho inteiro é
   * pequeno, e substituir a lista mantém o handler trivial e o patch de undo
   * exato — sem três comandos que podem divergir entre si.
   */
  "path.set-vertices": commandSchema(
    "path.set-vertices",
    z
      .object({
        pathId: IdentifierSchema,
        vertices: z.array(PathVertexSchema).min(1),
      })
      .strict(),
  ),
  "path.set-flags": commandSchema(
    "path.set-flags",
    z
      .object({
        pathId: IdentifierSchema,
        flags: z
          .object({
            closed: z.boolean().optional(),
            interpolation: z.enum(["linear", "bezier", "catmull-rom"]).optional(),
            geodesic: z.boolean().optional(),
          })
          .strict()
          .refine((flags) => Object.keys(flags).length > 0, "informe ao menos um flag"),
      })
      .strict(),
  ),

  "behavior.add": commandSchema(
    "behavior.add",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        behavior: BehaviorInstanceDataSchema,
        index: z.number().int().nonnegative().optional(),
      })
      .strict(),
  ),
  "behavior.remove": commandSchema(
    "behavior.remove",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        behaviorId: IdentifierSchema,
      })
      .strict(),
  ),
  "behavior.set-params": commandSchema(
    "behavior.set-params",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        behaviorId: IdentifierSchema,
        params: z.record(z.string(), z.unknown()),
      })
      .strict(),
  ),
  "behavior.set-enabled": commandSchema(
    "behavior.set-enabled",
    z
      .object({
        compositionId: IdentifierSchema,
        nodeId: IdentifierSchema,
        behaviorId: IdentifierSchema,
        enabled: z.boolean(),
      })
      .strict(),
  ),

  "camera.set-follow": commandSchema(
    "camera.set-follow",
    z
      .object({
        compositionId: IdentifierSchema,
        follow: CameraFollowSchema.nullable(),
      })
      .strict(),
  ),
  "camera.set-path": commandSchema(
    "camera.set-path",
    z
      .object({
        compositionId: IdentifierSchema,
        path: CameraPathSchema.nullable(),
      })
      .strict(),
  ),
} as const;

export type NativeCommandType = keyof typeof CommandSchemas;
export type NativeCommand = z.infer<(typeof CommandSchemas)[NativeCommandType]>;
export type CommandSource = z.infer<typeof CommandSourceSchema>;

export function safeParseNativeCommand(
  input: unknown,
):
  | { readonly success: true; readonly data: NativeCommand }
  | { readonly success: false; readonly error: z.ZodError } {
  if (typeof input !== "object" || input === null || !("type" in input)) {
    const invalid = z.object({ type: z.string() }).safeParse(input);
    if (!invalid.success) return invalid;
    throw new Error("Validação inconsistente de comando sem type.");
  }
  const type = Reflect.get(input, "type");
  if (typeof type !== "string" || !(type in CommandSchemas)) {
    const invalid = z
      .enum(Object.keys(CommandSchemas) as [NativeCommandType, ...NativeCommandType[]])
      .safeParse(type);
    if (!invalid.success) return invalid;
    throw new Error("Validação inconsistente de tipo de comando.");
  }
  return CommandSchemas[type as NativeCommandType].safeParse(input) as
    | { readonly success: true; readonly data: NativeCommand }
    | { readonly success: false; readonly error: z.ZodError };
}
