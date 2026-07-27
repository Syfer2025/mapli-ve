import { z } from "zod";
import { FrameSchema, Vec2Schema } from "./primitives.js";

export const EasingHandleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hold") }).passthrough(),
  z.object({ kind: z.literal("linear") }).passthrough(),
  z
    .object({
      kind: z.literal("bezier"),
      handle: Vec2Schema,
    })
    .passthrough(),
]);

export const SpatialHandlesSchema = z
  .object({
    in: Vec2Schema.nullable(),
    out: Vec2Schema.nullable(),
  })
  .passthrough();

export function keyframeSchema<T extends z.ZodType>(valueSchema: T) {
  return z
    .object({
      id: z.string().min(1),
      frame: FrameSchema,
      value: valueSchema,
      out: EasingHandleSchema,
      in: EasingHandleSchema,
      spatial: SpatialHandlesSchema.optional(),
      roving: z.boolean().optional(),
    })
    .passthrough();
}

export function animatablePropertySchema<T extends z.ZodType>(valueSchema: T) {
  const KeyframeSchema = keyframeSchema(valueSchema);
  return z
    .object({
      value: valueSchema,
      keyframes: z.array(KeyframeSchema).superRefine((keyframes, context) => {
        let previousFrame = -1;
        const frames = new Set<number>();

        keyframes.forEach((keyframe, index) => {
          if (keyframe.frame < previousFrame) {
            context.addIssue({
              code: "custom",
              path: [index, "frame"],
              message: "keyframes devem estar em ordem crescente de frame",
            });
          }
          if (frames.has(keyframe.frame)) {
            context.addIssue({
              code: "custom",
              path: [index, "frame"],
              message: `frame duplicado: ${keyframe.frame}`,
            });
          }
          previousFrame = keyframe.frame;
          frames.add(keyframe.frame);
        });
      }),
      expression: z.string().nullable(),
    })
    .passthrough();
}

export const UnknownAnimatablePropertySchema = animatablePropertySchema(z.unknown());
export const NumberAnimatablePropertySchema = animatablePropertySchema(z.number().finite());
export const Vec2AnimatablePropertySchema = animatablePropertySchema(Vec2Schema);
export const FrameAnimatablePropertySchema = animatablePropertySchema(FrameSchema);

export type EasingHandle = z.infer<typeof EasingHandleSchema>;
export type SpatialHandles = z.infer<typeof SpatialHandlesSchema>;
export type Keyframe<T> = {
  id: string;
  frame: number;
  value: T;
  out: EasingHandle;
  in: EasingHandle;
  spatial?: SpatialHandles | undefined;
  roving?: boolean | undefined;
  [key: string]: unknown;
};
export type AnimatableProperty<T> = {
  value: T;
  keyframes: Keyframe<T>[];
  expression: string | null;
  [key: string]: unknown;
};
