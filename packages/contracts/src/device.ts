/**
 * D21 device actions.
 *
 * `device.action.request` still does not move a pointer or send a key. One
 * exact approval of that request is stored as a local record. The real input
 * path is `device.action.input`: one exact once approval, then one bounded
 * pointer or key action. It does not accept a command, a path, or a key name
 * outside the allowlist.
 */
import { z } from "zod";
import { IsoDateTimeUtcSchema, UuidSchema } from "./primitives.js";

export const DeviceActionKindSchema = z.enum(["pointer", "key"]);
export type DeviceActionKind = z.infer<typeof DeviceActionKindSchema>;

/** The only value an accepted device action returns in this slice. */
export const DeviceActionResultSchema = z
  .object({
    id: UuidSchema,
    at: IsoDateTimeUtcSchema,
  })
  .strict();
export type DeviceActionResult = z.infer<typeof DeviceActionResultSchema>;

/** One stored acceptance: id, bot, action name, and time. */
export const DeviceActionRecordSchema = z
  .object({
    id: UuidSchema,
    botId: UuidSchema,
    action: DeviceActionKindSchema,
    at: IsoDateTimeUtcSchema,
  })
  .strict();
export type DeviceActionRecord = z.infer<typeof DeviceActionRecordSchema>;

const DEVICE_KEY_LETTERS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
] as const;
const DEVICE_KEY_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const DEVICE_KEY_NAMED = [
  "enter",
  "escape",
  "tab",
  "space",
  "backspace",
  "delete",
  "left",
  "up",
  "right",
  "down",
  "home",
  "end",
  "pageup",
  "pagedown",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
] as const;

/** One tap. Modifiers are only shift, ctrl, and alt. The Windows key is absent. */
export const DEVICE_KEY_NAMES = [
  ...DEVICE_KEY_LETTERS,
  ...DEVICE_KEY_DIGITS,
  ...DEVICE_KEY_NAMED,
] as const;
export const DeviceKeyNameSchema = z.enum(DEVICE_KEY_NAMES);
export type DeviceKeyName = z.infer<typeof DeviceKeyNameSchema>;

export const DEVICE_POINTER_EDGE = 8192;

export const DevicePointerInputSchema = z
  .object({
    kind: z.literal("pointer"),
    gesture: z.enum(["move", "click"]),
    button: z.enum(["left", "right", "middle"]),
    x: z.int().min(0).max(DEVICE_POINTER_EDGE),
    y: z.int().min(0).max(DEVICE_POINTER_EDGE),
  })
  .strict();
export type DevicePointerInput = z.infer<typeof DevicePointerInputSchema>;

export const DeviceKeyInputSchema = z
  .object({
    kind: z.literal("key"),
    name: DeviceKeyNameSchema,
    action: z.literal("tap"),
    shift: z.boolean(),
    ctrl: z.boolean(),
    alt: z.boolean(),
  })
  .strict();
export type DeviceKeyInput = z.infer<typeof DeviceKeyInputSchema>;

/** One bounded input. A command, a path, or a free string is not a field. */
export const DeviceInputSchema = z.discriminatedUnion("kind", [
  DevicePointerInputSchema,
  DeviceKeyInputSchema,
]);
export type DeviceInput = z.infer<typeof DeviceInputSchema>;

/** Local artifact of one performed input. No filesystem path. */
export const DeviceInputRecordSchema = z
  .object({
    id: UuidSchema,
    botId: UuidSchema,
    at: IsoDateTimeUtcSchema,
    input: DeviceInputSchema,
  })
  .strict();
export type DeviceInputRecord = z.infer<typeof DeviceInputRecordSchema>;

export const DeviceInputResultSchema = z
  .object({
    id: UuidSchema,
    at: IsoDateTimeUtcSchema,
    kind: DeviceActionKindSchema,
  })
  .strict();
export type DeviceInputResult = z.infer<typeof DeviceInputResultSchema>;

/** Trusted request. A model tool uses the same kind and the same approval gate. */
export const DEVICE_METHODS = {
  "device.action.request": {
    request: z
      .object({
        botId: UuidSchema,
        kind: DeviceActionKindSchema,
      })
      .strict(),
    response: DeviceActionResultSchema,
  },
  /**
   * Local records for one bot, newest first. A denial, a disabled policy, a
   * reused approval, or an unknown action name is not in this list. Default
   * 50, at most 100. This method does not move a pointer or send a key.
   */
  "device.action.list": {
    request: z
      .object({
        botId: UuidSchema,
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z.object({
      records: z.array(DeviceActionRecordSchema),
    }),
  },
  /**
   * One pointer move/click or one key tap after one exact once approval.
   * The response has no path, command, or coordinates. The local artifact
   * is listed separately.
   */
  "device.action.input": {
    request: z
      .object({
        botId: UuidSchema,
        input: DeviceInputSchema,
      })
      .strict(),
    response: DeviceInputResultSchema,
  },
  /** Performed inputs for one bot, newest first. Default 50, at most 100. */
  "device.action.input.list": {
    request: z
      .object({
        botId: UuidSchema,
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z
      .object({
        records: z.array(DeviceInputRecordSchema).max(100),
      })
      .strict(),
  },
} as const;
