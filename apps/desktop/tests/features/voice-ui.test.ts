import { describe, expect, it } from "vitest";
import type { VoiceStatus } from "@deepseek-bot/contracts";
import {
  speakButton,
  transcribeButton,
  transcribeProblem,
  voiceFailureKey,
} from "../../src/renderer/src/features/voice/voice-ui.js";

const bothReady: VoiceStatus = {
  transcribe: { available: true, reason: null },
  speak: { available: true, reason: null },
};

const neitherReady: VoiceStatus = {
  transcribe: { available: false, reason: "whisper path not set" },
  speak: { available: false, reason: "no speech engine" },
};

describe("transcribeButton", () => {
  it("stays disabled until the status arrives", () => {
    const button = transcribeButton(null, "idle");
    expect(button.disabled).toBe(true);
    expect(button.reasonKey).toBe("voice.checking");
  });

  it("stays disabled when the microphone switch is off", () => {
    const button = transcribeButton(bothReady, "idle", false);
    expect(button.disabled).toBe(true);
    expect(button.reasonKey).toBe("voice.micOff");
  });

  it("is enabled when whisper is configured", () => {
    expect(transcribeButton(bothReady, "idle")).toEqual({
      disabled: false,
      labelKey: "voice.record",
      reasonKey: null,
    });
  });

  it("explains the missing whisper path instead of failing silently", () => {
    const button = transcribeButton(neitherReady, "idle");
    expect(button.disabled).toBe(true);
    expect(button.reasonKey).toBe("voice.transcribeUnavailable");
  });

  it("stays enabled and shows the recording label while a clip is open", () => {
    const button = transcribeButton(bothReady, "recording");
    expect(button.disabled).toBe(false);
    expect(button.labelKey).toBe("voice.recording");
  });

  it("locks while transcribing", () => {
    const button = transcribeButton(bothReady, "transcribing");
    expect(button.disabled).toBe(true);
    expect(button.labelKey).toBe("voice.transcribing");
  });
});

describe("speakButton", () => {
  it("is enabled when the local engine exists", () => {
    expect(speakButton(bothReady, false).disabled).toBe(false);
  });

  it("is disabled while this reply is being read", () => {
    const button = speakButton(bothReady, true);
    expect(button.disabled).toBe(true);
    expect(button.labelKey).toBe("voice.speaking");
  });

  it("reports a missing engine", () => {
    const button = speakButton(neitherReady, false);
    expect(button.disabled).toBe(true);
    expect(button.reasonKey).toBe("voice.speakUnavailable");
  });
});

describe("transcribeProblem", () => {
  it("maps an empty configuration to the settings messages", () => {
    expect(
      transcribeProblem({
        transcribe: { available: false, reason: "whisper.cpp binary is not configured" },
        speak: { available: false, reason: null },
      }),
    ).toBe("binRequired");
    expect(
      transcribeProblem({
        transcribe: { available: false, reason: "whisper.cpp model is not configured" },
        speak: { available: false, reason: null },
      }),
    ).toBe("modelRequired");
  });
});

describe("voiceFailureKey", () => {
  it("maps each half to its own toast", () => {
    expect(voiceFailureKey("transcribe")).toBe("voice.transcribeFailed");
    expect(voiceFailureKey("speak")).toBe("voice.speakFailed");
  });
});
