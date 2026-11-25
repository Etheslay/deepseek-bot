/**
 * Button gating for the voice controls (pure).
 *
 * `voice.status` reports whether the user's whisper.cpp paths and the local
 * speech engine are usable. The composer mic and the per-message speak button both
 * derive their label/disabled state from that plus their own busy phase, so the
 * rules live here and stay unit-testable.
 */
import type { VoiceStatus } from "@deepseek-bot/contracts";
import type { MessageKey } from "../../i18n.js";

export type VoicePhase = "idle" | "recording" | "transcribing";

export type VoiceButton = {
  readonly disabled: boolean;
  /** i18n key for the tooltip/label. */
  readonly labelKey: MessageKey;
  /** i18n key explaining why the button is disabled, if it is. */
  readonly reasonKey: MessageKey | null;
};

export function transcribeButton(
  status: VoiceStatus | null,
  phase: VoicePhase,
  captureEnabled = true,
): VoiceButton {
  if (!captureEnabled && phase === "idle") {
    return { disabled: true, labelKey: "voice.record", reasonKey: "voice.micOff" };
  }
  if (phase === "transcribing") {
    return { disabled: true, labelKey: "voice.transcribing", reasonKey: null };
  }
  if (phase === "recording") {
    return { disabled: false, labelKey: "voice.recording", reasonKey: null };
  }
  if (status === null) {
    return { disabled: true, labelKey: "voice.record", reasonKey: "voice.checking" };
  }
  if (!status.transcribe.available) {
    return {
      disabled: true,
      labelKey: "voice.record",
      reasonKey: "voice.transcribeUnavailable",
    };
  }
  return { disabled: false, labelKey: "voice.record", reasonKey: null };
}

export function speakButton(
  status: VoiceStatus | null,
  speaking: boolean,
): VoiceButton {
  if (speaking) {
    return { disabled: true, labelKey: "voice.speaking", reasonKey: null };
  }
  if (status === null) {
    return { disabled: true, labelKey: "voice.speak", reasonKey: "voice.checking" };
  }
  if (!status.speak.available) {
    return { disabled: true, labelKey: "voice.speak", reasonKey: "voice.speakUnavailable" };
  }
  return { disabled: false, labelKey: "voice.speak", reasonKey: null };
}

/** Map a failed transcribe/speak call to a short reason key for the toast. */
export function voiceFailureKey(kind: "transcribe" | "speak"): MessageKey {
  return kind === "transcribe" ? "voice.transcribeFailed" : "voice.speakFailed";
}

export type TranscribeProblem =
  | "binRequired"
  | "modelRequired"
  | "binNotFound"
  | "modelNotFound"
  | "unavailable";

export const TRANSCRIBE_PROBLEM_KEYS: Record<TranscribeProblem, MessageKey> = {
  binRequired: "voice.settingsBinRequired",
  modelRequired: "voice.settingsModelRequired",
  binNotFound: "voice.settingsBinNotFound",
  modelNotFound: "voice.settingsModelNotFound",
  unavailable: "voice.settingsUnavailable",
};

/** Null when transcription is usable, the mapped problem otherwise. */
export function transcribeProblem(status: VoiceStatus): TranscribeProblem | null {
  if (status.transcribe.available) {
    return null;
  }
  const reason = status.transcribe.reason ?? "";
  if (reason.includes("binary was not found")) return "binNotFound";
  if (reason.includes("model was not found")) return "modelNotFound";
  if (reason.includes("binary is not configured")) return "binRequired";
  if (reason.includes("model is not configured")) return "modelRequired";
  return "unavailable";
}

/** Which field an inline error belongs to; null shows the status line only. */
export function transcribeProblemField(problem: TranscribeProblem): "bin" | "model" | null {
  if (problem === "binRequired" || problem === "binNotFound") return "bin";
  if (problem === "modelRequired" || problem === "modelNotFound") return "model";
  return null;
}
