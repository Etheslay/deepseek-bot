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
  /**
   * v0.14: collapsed sidebar groups by persisted UUID. Optional on purpose —
   * 0.13 writers omit it and stay accepted; readers treat missing as "none
   * collapsed".
   */
  collapsedGroupIds: orderedIds.optional(),
}).strict();

export type UiState = z.infer<typeof UiStateSchema>;

/** The snapshot a fresh install (or a corrupt row) answers with. */
export const EMPTY_UI_STATE: UiState = {
  botOrder: [],
  groupOrder: [],
  selectedBotId: null,
  selectedGroupId: null,
};

/**
 * Renderer→Host interface-state methods (G1', protocol v0.13). The desktop
 * stores one schema-valid snapshot (sidebar order + selection) per bot data
 * root; a missing or corrupt row degrades to the empty state instead of
 * failing the call. The shape is fixed — no arbitrary UI payloads ride this
 * channel, and nothing key-shaped can end up in the row.
 */
export const UI_STATE_METHODS = {
  /**
   * Read the persisted snapshot. The Host always answers with a schema-valid
   * state: the empty state when nothing is stored yet.
   */
  "ui.state.get": {
    request: z.object({}).strict(),
    response: z.object({ state: UiStateSchema }),
  },
  /**
   * Replace the whole snapshot atomically. The request schema validates the
   * full shape before anything is written; the response echoes the stored
   * state. Last write wins, matching the desktop's debounced writer.
   */
  "ui.state.set": {
    request: z.object({ state: UiStateSchema }).strict(),
    response: z.object({ state: UiStateSchema }),
  },
} as const;
