/**
 * Renderer interface-state persistence (G1', protocol v0.13).
 *
 * One settings KV row holds the desktop's sidebar snapshot (order +
 * selection), written only through the contract-validated `ui.state.set`
 * handler and read back through `UiStateSchema`: a corrupt or hand-edited
 * row degrades to the empty state instead of failing the desktop. Nothing
 * key-shaped can end up in the row — the schema accepts only stable entity
 * IDs, never free text or arbitrary payloads.
 */
import {
  EMPTY_UI_STATE,
  UiStateSchema,
  type UiState,
} from "@deepseek-bot/contracts";
import { getSettingRaw, setSetting, type OpenedDatabase } from "@deepseek-bot/storage";

export const UI_STATE_SETTING = "ui.state.v1";

/**
 * Read the persisted snapshot. Missing and schema-invalid rows both answer
 * the empty state — the desktop restores its default view in that case.
 */
export function readUiState(db: OpenedDatabase): UiState {
  const parsed = UiStateSchema.safeParse(getSettingRaw(db, UI_STATE_SETTING));
  return parsed.success ? parsed.data : { ...EMPTY_UI_STATE };
}

/** Replace the whole snapshot. Callers must have validated via the contract. */
export function writeUiState(db: OpenedDatabase, state: UiState): void {
  setSetting(db, UI_STATE_SETTING, state);
}
