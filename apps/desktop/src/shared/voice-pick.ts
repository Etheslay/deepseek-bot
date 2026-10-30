/**
 * Desktop file dialogs for the local whisper configuration (D27 settings
 * slice). Like knowledge-import, the renderer never supplies a path: it names
 * which kind of file it wants and main answers with the picked absolute path
 * or a cancellation.
 */
import { IpcDeniedError } from "./ipc-channels.js";

/** Which whisper file the panel is asking for. */
export type VoicePickKind = "bin" | "model";

export type VoicePickResult =
  | { ok: true; path: string }
  | { ok: false; code: "cancelled" };

/** Main rejects anything but the two known kinds before opening a dialog. */
export function assertValidVoicePickKind(value: unknown): asserts value is VoicePickKind {
  if (value !== "bin" && value !== "model") {
    throw new IpcDeniedError(
      "INVALID_PAYLOAD",
      "voice file pick kind must be 'bin' or 'model'",
    );
  }
}
