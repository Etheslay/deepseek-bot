/**
 * Hold-to-talk for the composer microphone.
 *
 * Press arms capture. Release while a clip is open stops it and the caller
 * transcribes that one clip into the input. Release before capture is ready
 * abandons the clip. The 20s contract cap stops and transcribes even if the
 * pointer is still down; the following release does nothing. This is one clip
 * per hold — it does not split sentences.
 */

export type HoldPhase = "idle" | "arming" | "recording" | "transcribing";

export type HoldState = {
  readonly phase: HoldPhase;
  /** Pointer or key is still down. */
  readonly held: boolean;
};

export type HoldEvent =
  | "press"
  | "release"
  | "capture-ready"
  | "capture-failed"
  | "cap"
  | "transcribe-done";

export type HoldEffect = "start" | "cancel" | "stop" | "none";

export const HOLD_IDLE: HoldState = { phase: "idle", held: false };

export function reduceHold(
  state: HoldState,
  event: HoldEvent,
): { readonly state: HoldState; readonly effect: HoldEffect } {
  switch (event) {
    case "press":
      if (state.phase !== "idle" || state.held) {
        return { state, effect: "none" };
      }
      return { state: { phase: "arming", held: true }, effect: "start" };
    case "release":
      if (state.phase === "arming") {
        return { state: { phase: "idle", held: false }, effect: "cancel" };
      }
      if (state.phase === "recording") {
        return { state: { phase: "transcribing", held: false }, effect: "stop" };
      }
      return { state: { ...state, held: false }, effect: "none" };
    case "capture-ready":
      if (state.phase !== "arming") {
        return { state, effect: "none" };
      }
      if (!state.held) {
        return { state: { phase: "idle", held: false }, effect: "cancel" };
      }
      return { state: { phase: "recording", held: true }, effect: "none" };
    case "capture-failed":
      if (state.phase !== "arming") {
        return { state, effect: "none" };
      }
      return { state: { phase: "idle", held: false }, effect: "none" };
    case "cap":
      if (state.phase !== "recording") {
        return { state, effect: "none" };
      }
      return { state: { phase: "transcribing", held: state.held }, effect: "stop" };
    case "transcribe-done":
      if (state.phase !== "transcribing") {
        return { state, effect: "none" };
      }
      return { state: { phase: "idle", held: state.held }, effect: "none" };
    default:
      return { state, effect: "none" };
  }
}

/**
 * Place one transcript into the composer draft. A hold is one string: punctuation
 * stays inside it. An empty result leaves the draft untouched.
 */
export function appendTranscript(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (text.length === 0) {
    return draft;
  }
  return draft.trim().length > 0 ? `${draft} ${text}` : text;
}
