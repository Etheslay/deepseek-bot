import { describe, expect, it } from "vitest";
import {
  METHOD_CONTRACTS,
  METHODS,
  TEXT_LIMITS,
  VOICE_MAX_AUDIO_BASE64_CHARS,
  VOICE_MAX_CLIP_SECONDS,
  VOICE_SAMPLE_RATE,
  VoiceSpeakResultSchema,
  VoiceStatusSchema,
  VoiceTranscriptionSchema,
} from "./index.js";

const AUDIO = Buffer.from("fake wav bytes").toString("base64");

describe("D27 voice contracts", () => {
  it("registers the three trusted methods on the whitelist and the contract map", () => {
    expect(METHODS).toContain("voice.status");
    expect(METHODS).toContain("voice.transcribe");
    expect(METHODS).toContain("voice.speak");
    for (const method of ["voice.status", "voice.transcribe", "voice.speak"] as const) {
      expect(METHOD_CONTRACTS[method]).toBeDefined();
    }
  });

  it("keeps voice.status an empty request with a strict two-sided status", () => {
    const contract = METHOD_CONTRACTS["voice.status"];
    expect(contract.request.safeParse({}).success).toBe(true);
    expect(contract.request.safeParse({ botId: "x" }).success).toBe(false);
    const status = {
      transcribe: { available: false, reason: "whisper.cpp binary is not configured" },
      speak: { available: true, reason: null },
    };
    expect(contract.response.safeParse(status).success).toBe(true);
    expect(VoiceStatusSchema.safeParse(status).success).toBe(true);
    expect(
      contract.response.safeParse({ ...status, extra: true }).success,
    ).toBe(false);
    expect(
      contract.response
        .safeParse({ transcribe: { available: true, reason: null } })
        .success,
    ).toBe(false);
  });

  it("bounds the transcribe clip to one canonical-base64 string", () => {
    const contract = METHOD_CONTRACTS["voice.transcribe"];
    expect(contract.request.safeParse({ audioBase64: AUDIO }).success).toBe(true);
    expect(contract.request.safeParse({}).success).toBe(false);
    expect(contract.request.safeParse({ audioBase64: "" }).success).toBe(false);
    expect(
      contract.request.safeParse({ audioBase64: AUDIO, seconds: 1 }).success,
    ).toBe(false);
    expect(
      contract.request.safeParse({ audioBase64: "a".repeat(VOICE_MAX_AUDIO_BASE64_CHARS + 1) })
        .success,
    ).toBe(false);
    expect(
      contract.request.safeParse({ audioBase64: "a".repeat(VOICE_MAX_AUDIO_BASE64_CHARS) })
        .success,
    ).toBe(true);
  });

  it("returns a trimmed transcript with the clip length and nothing else", () => {
    const transcript = { text: "hello", seconds: 1.5 };
    expect(VoiceTranscriptionSchema.safeParse(transcript).success).toBe(true);
    expect(METHOD_CONTRACTS["voice.transcribe"].response.safeParse(transcript).success).toBe(true);
    expect(VoiceTranscriptionSchema.safeParse({ text: "", seconds: 0 }).success).toBe(true);
    expect(
      VoiceTranscriptionSchema.safeParse({ text: "x".repeat(TEXT_LIMITS.voiceTranscript + 1), seconds: 1 })
        .success,
    ).toBe(false);
    expect(
      VoiceTranscriptionSchema.safeParse({ text: "hi", seconds: VOICE_MAX_CLIP_SECONDS + 0.5 })
        .success,
    ).toBe(false);
    expect(
      VoiceTranscriptionSchema.safeParse({ ...transcript, path: "C:\\tmp\\clip.wav" }).success,
    ).toBe(false);
  });

  it("bounds speak text and returns only the spoken flag", () => {
    const contract = METHOD_CONTRACTS["voice.speak"];
    expect(contract.request.safeParse({ text: "你好，世界" }).success).toBe(true);
    expect(contract.request.safeParse({}).success).toBe(false);
    expect(contract.request.safeParse({ text: "" }).success).toBe(false);
    expect(
      contract.request.safeParse({ text: "x".repeat(TEXT_LIMITS.voiceSpeakText + 1) }).success,
    ).toBe(false);
    expect(
      contract.request.safeParse({ text: "x".repeat(TEXT_LIMITS.voiceSpeakText) }).success,
    ).toBe(true);
    expect(VoiceSpeakResultSchema.safeParse({ spoken: true }).success).toBe(true);
    expect(VoiceSpeakResultSchema.safeParse({ spoken: true, at: "now" }).success).toBe(false);
  });

  it("pins the clip constants the recorder depends on", () => {
    expect(VOICE_SAMPLE_RATE).toBe(16_000);
    expect(VOICE_MAX_CLIP_SECONDS).toBe(20);
    // 20 s of 16 kHz mono 16-bit PCM plus header slack stays inside the
    // 1 MiB message envelope after base64 (4/3 growth).
    expect(VOICE_MAX_AUDIO_BASE64_CHARS).toBeLessThan(1_048_576);
  });

  it("bounds the whisper config surface and allows clearing", () => {
    const contract = METHOD_CONTRACTS["voice.config.get"];
    expect(contract.request.safeParse({}).success).toBe(true);
    expect(contract.request.safeParse({ x: 1 }).success).toBe(false);
    const setter = METHOD_CONTRACTS["voice.config.set"];
    expect(setter.request.safeParse({ whisperBin: null, whisperModel: null }).success).toBe(true);
    expect(
      setter.request.safeParse({ whisperBin: "C:\\whisper\\cli.exe", whisperModel: "m.bin" })
        .success,
    ).toBe(true);
    expect(setter.request.safeParse({ whisperBin: "", whisperModel: null }).success).toBe(false);
    expect(
      setter.request.safeParse({ whisperBin: "x".repeat(1_025), whisperModel: null }).success,
    ).toBe(false);
    expect(setter.request.safeParse({ whisperBin: "a.exe" }).success).toBe(false);
    expect(
      setter.response.safeParse({ whisperBin: null, whisperModel: "m.bin" }).success,
    ).toBe(true);
    expect(METHODS).toContain("voice.config.get");
    expect(METHODS).toContain("voice.config.set");
  });
});
