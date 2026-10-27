/** D21 device-action approval gate. These schemas do not move a pointer or send a key. */
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
} as const;
