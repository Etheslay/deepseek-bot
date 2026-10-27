/** D21 selected-window capture control plane; these schemas do not grant access. */
import { z } from "zod";
import { IsoDateTimeUtcSchema, UuidSchema } from "./primitives.js";

export const ScreenModeSchema = z.enum(["image", "ocr"]);
export type ScreenMode = z.infer<typeof ScreenModeSchema>;

/** Opaque Host-generation token, never a native window handle or file path. */
export const ScreenWindowSchema = z.object({
  id: UuidSchema,
  title: z.string().max(512),
}).strict();
export type ScreenWindow = z.infer<typeof ScreenWindowSchema>;

/** The only screen output exposed to model tools. */
export const ScreenResultSchema = z.object({
  id: UuidSchema,
  mode: ScreenModeSchema,
  at: IsoDateTimeUtcSchema,
  width: z.int().min(1).max(8192),
  height: z.int().min(1).max(8192),
  hasOcr: z.boolean(),
}).strict();
export type ScreenResult = z.infer<typeof ScreenResultSchema>;

export const ScreenStatusSchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean(),
  target: ScreenWindowSchema.nullable(),
  busy: z.boolean(),
}).strict();
export type ScreenStatus = z.infer<typeof ScreenStatusSchema>;

const botRequest = z.object({ botId: UuidSchema }).strict();
const resultRequest = z.object({ botId: UuidSchema, id: UuidSchema }).strict();

/** Trusted desktop only; the model cannot select targets or read pixels/text. */
export const SCREEN_METHODS = {
  "screen.status": { request: botRequest, response: ScreenStatusSchema },
  "screen.windows.list": {
    request: z.object({}).strict(),
    response: z.object({ windows: z.array(ScreenWindowSchema).max(200) }).strict(),
  },
  "screen.target.set": {
    request: z.object({ botId: UuidSchema, id: UuidSchema.nullable() }).strict(),
    response: ScreenStatusSchema,
  },
  "screen.request": {
    request: z.object({ botId: UuidSchema, mode: ScreenModeSchema }).strict(),
    response: ScreenResultSchema,
  },
  "screen.cancel": {
    request: botRequest,
    response: z.object({ cancelled: z.boolean() }).strict(),
  },
  "screen.results.list": {
    request: botRequest,
    response: z.object({ results: z.array(ScreenResultSchema).max(50) }).strict(),
  },
  "screen.result.read": {
    request: resultRequest,
    response: z.object({
      result: ScreenResultSchema,
      imageBase64: z.string().max(360000),
      text: z.string().max(65536).nullable(),
    }).strict(),
  },
  "screen.result.delete": {
    request: resultRequest,
    response: z.object({ deleted: z.literal(true) }).strict(),
  },
} as const;
