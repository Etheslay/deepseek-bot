/**
 * D21 device-action approval gate.
 *
 * These schemas do not move a pointer or send a key. One exact approval is
 * stored as a local record and can be listed for that bot. The request
 * response stays `{id, at}`.
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
} as const;
