import { z } from "zod";
import { UuidSchema } from "./primitives.js";

/** Order and selection use persisted IDs; never store arbitrary UI payloads. */
const orderedIds = z.array(UuidSchema).max(1000).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "ordered IDs must be unique" },
);

export const UiStateSchema = z.object({
  botOrder: orderedIds,
  groupOrder: orderedIds,
  selectedBotId: UuidSchema.nullable(),
  selectedGroupId: UuidSchema.nullable(),
}).strict();

export type UiState = z.infer<typeof UiStateSchema>;
