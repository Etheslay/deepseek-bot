import { describe, expect, it } from "vitest";
import {
  VOICE_MAX_CLIP_BYTES,
  VOICE_MAX_CLIP_SECONDS,
  VOICE_SAMPLE_RATE,
} from "@deepseek-bot/contracts";
import {
  clipProblem,
  clipSeconds,
  downsampleTo16k,
  encodeWavPcm16,
} from "../../src/renderer/src/features/voice/wav.js";

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

describe("encodeWavPcm16", () => {
  it("writes a canonical 16 kHz mono 16-bit PCM header the Host accepts", () => {
    const bytes = encodeWavPcm16(new Float32Array(16_000));
    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(readAscii(bytes, 8, 4)).toBe("WAVE");
    expect(readAscii(bytes, 12, 4)).toBe("fmt ");
    expect(readUint32(bytes, 16)).toBe(16);
    expect(readUint16(bytes, 20)).toBe(1); // PCM
    expect(readUint16(bytes, 22)).toBe(1); // mono
    expect(readUint32(bytes, 24)).toBe(VOICE_SAMPLE_RATE);
    expect(readUint32(bytes, 28)).toBe(VOICE_SAMPLE_RATE * 2);
    expect(readUint16(bytes, 32)).toBe(2);
    expect(readUint16(bytes, 34)).toBe(16);
    expect(readAscii(bytes, 36, 4)).toBe("data");
    expect(readUint32(bytes, 40)).toBe(bytes.length - 44);
    expect(bytes.length).toBe(44 + 16_000 * 2);
  });

  it("clamps and scales samples to signed 16-bit", () => {
    const bytes = encodeWavPcm16(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x7fff);
    // Over-range input must clip instead of wrapping.
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });

  it("fits the contract byte cap for a full-length clip", () => {
    const longest = new Float32Array(VOICE_SAMPLE_RATE * VOICE_MAX_CLIP_SECONDS);
    const bytes = encodeWavPcm16(longest);
    expect(bytes.length).toBeLessThanOrEqual(VOICE_MAX_CLIP_BYTES);
    expect(clipProblem(longest)).toBeNull();
  });
});

describe("clipProblem", () => {
  it("rejects an empty capture", () => {
    expect(clipProblem(new Float32Array(0))).toBe("empty");
  });

  it("rejects a clip past the duration limit", () => {
    const tooLong = new Float32Array(VOICE_SAMPLE_RATE * VOICE_MAX_CLIP_SECONDS + 16_000);
    expect(clipProblem(tooLong)).toBe("tooLong");
  });

  it("reports the duration in seconds", () => {
    expect(clipSeconds(new Float32Array(8_000))).toBe(0.5);
  });
});

describe("downsampleTo16k", () => {
  it("keeps 16 kHz input untouched", () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(samples, VOICE_SAMPLE_RATE)).toBe(samples);
  });

  it("halves the sample count when the context runs at 32 kHz", () => {
    const samples = new Float32Array(3_200).fill(0.5);
    const out = downsampleTo16k(samples, 32_000);
    expect(out.length).toBe(1_600);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[out.length - 1]).toBeCloseTo(0.5, 5);
  });

  it("returns nothing for an empty capture", () => {
    expect(downsampleTo16k(new Float32Array(0), 48_000).length).toBe(0);
  });
});
