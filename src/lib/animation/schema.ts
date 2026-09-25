// Constrained composition schema. The AI authors THIS, not arbitrary JSX.
// Everything is declarative and validated, so it is safe to store, version,
// diff, and drive a properties panel from.
import { z } from "zod";

export const easeSchema = z.enum([
  "linear",
  "inQuad",
  "outQuad",
  "inOutQuad",
  "inCubic",
  "outCubic",
  "inOutCubic",
  "inQuart",
  "outQuart",
  "inOutQuart",
  "inSine",
  "outSine",
  "inOutSine",
  "outBack",
  "outElastic",
  "outExpo",
]);

export const animSchema = z.object({
  from: z.number(),
  to: z.number(),
  start: z.number().min(0),
  end: z.number().min(0),
  ease: easeSchema.optional(),
});

/** A property is either a constant or an animated scalar. */
export const propSchema = z.union([z.number(), animSchema]);

export const motionSchema = z
  .object({
    opacity: propSchema.optional(),
    x: propSchema.optional(),
    y: propSchema.optional(),
    scale: propSchema.optional(),
    rotate: propSchema.optional(),
    blur: propSchema.optional(),
    /** 0..1 horizontal reveal, implemented as a clip-path inset. */
    reveal: propSchema.optional(),
  })
  .default({});

const baseLayer = {
  id: z.string(),
  /** Layer is only mounted between these times (seconds). Defaults to whole composition. */
  in: z.number().min(0).optional(),
  out: z.number().min(0).optional(),
  frame: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
  motion: motionSchema.optional(),
};

export const textLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("text"),
  text: z.string(),
  style: z
    .object({
      fontFamily: z.string().optional(),
      fontSize: z.number().optional(),
      fontWeight: z.union([z.number(), z.string()]).optional(),
      color: z.string().optional(),
      lineHeight: z.number().optional(),
      letterSpacing: z.number().optional(),
      textAlign: z.enum(["left", "center", "right"]).optional(),
      textTransform: z.enum(["none", "uppercase", "lowercase"]).optional(),
      maxWidth: z.number().optional(),
      /** Structured so it maps to an SVG feDropShadow rather than a CSS string. */
      shadow: z
        .object({
          dx: z.number().default(0),
          dy: z.number().default(0),
          blur: z.number().default(0),
          color: z.string().default("#000000"),
          opacity: z.number().optional(),
        })
        .optional(),
    })
    .default({}),
});

/** SVG-native gradient, so the composition rasterises without foreignObject. */
export const gradientSchema = z.object({
  type: z.enum(["linear", "radial"]),
  /** Degrees, 0 = left-to-right. Linear only. */
  angle: z.number().default(0),
  stops: z.array(
    z.object({
      offset: z.number().min(0).max(1),
      color: z.string(),
      opacity: z.number().optional(),
    }),
  ),
});

export const rectLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("rect"),
  style: z
    .object({
      fill: z.string().optional(),
      gradient: gradientSchema.optional(),
      radius: z.number().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().optional(),
      fillOpacity: z.number().optional(),
    })
    .default({}),
});

export const imageLayerSchema = z.object({
  ...baseLayer,
  type: z.literal("image"),
  src: z.string(),
  alt: z.string().optional(),
  style: z
    .object({
      fit: z.enum(["cover", "contain"]).optional(),
      radius: z.number().optional(),
    })
    .default({}),
});

export const layerSchema = z.discriminatedUnion("type", [
  textLayerSchema,
  rectLayerSchema,
  imageLayerSchema,
]);

export const sceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  start: z.number().min(0),
  duration: z.number().positive(),
});

export const compositionSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().min(1).max(60),
  duration: z.number().positive(),
  background: z.string().default("#000000"),
  fonts: z
    .array(z.object({ family: z.string(), url: z.string(), weight: z.string().optional() }))
    .default([]),
  scenes: z.array(sceneSchema).default([]),
  layers: z.array(layerSchema).default([]),
});

export type Anim = z.infer<typeof animSchema>;
export type Gradient = z.infer<typeof gradientSchema>;
export type Frame = NonNullable<z.infer<typeof layerSchema>["frame"]>;
export type Motion = z.infer<typeof motionSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Composition = z.infer<typeof compositionSchema>;

export function parseComposition(input: unknown) {
  return compositionSchema.parse(input);
}
