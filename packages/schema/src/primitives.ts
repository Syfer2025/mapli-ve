import { z } from "zod";

export const FiniteNumberSchema = z.number().finite();
export const NonNegativeNumberSchema = FiniteNumberSchema.nonnegative();
export const PositiveNumberSchema = FiniteNumberSchema.positive();
export const FrameSchema = z.number().int().nonnegative();
export const Vec2Schema = z.tuple([FiniteNumberSchema, FiniteNumberSchema]);
export const Vec3Schema = z.tuple([FiniteNumberSchema, FiniteNumberSchema, FiniteNumberSchema]);
export const LongitudeLatitudeSchema = z.tuple([
  FiniteNumberSchema.min(-180).max(180),
  FiniteNumberSchema.min(-90).max(90),
]);

/**
 * A validação aceita caixa mista para abrir os exemplos históricos da spec.
 * A serialização canônica é responsável por emitir a forma minúscula.
 */
export const ColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i, "use #RRGGBB ou #RRGGBBAA");

export const IdentifierSchema = z.string().min(1);
export const NonEmptyStringSchema = z.string().min(1);
export const JsonObjectSchema = z.record(z.string(), z.unknown());

export type Frame = z.infer<typeof FrameSchema>;
export type Vec2 = z.infer<typeof Vec2Schema>;
export type Vec3 = z.infer<typeof Vec3Schema>;
export type Color = z.infer<typeof ColorSchema>;
