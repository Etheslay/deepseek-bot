/**
 * 16 kHz mono 16-bit WAV encoding for the voice button.
 *
 * The voice contract accepts exactly one clip shape: `VOICE_SAMPLE_RATE`,
 * `VOICE_MAX_CLIP_SECONDS` and `VOICE_MAX_CLIP_BYTES` (see
 * packages/contracts/src/voice.ts). `MediaRecorder` cannot produce it — browsers
 * hand back webm/opus and the Host explicitly refuses to convert formats — so
 * the renderer records raw PCM and writes the container itself.
 *
 * Pure functions only: the recording hook feeds float samples in, and the tests
 * pin the header bytes and the bounds.
 */
import {
  VOICE_MAX_CLIP_BYTES,
  VOICE_MAX_CLIP_SECONDS,
  VOICE_SAMPLE_RATE,
} from "@deepseek-bot/contracts";

export type ClipProblem = "empty" | "tooLong" | "tooLarge";

/** Linear resample to the contract rate; the recorded context rate varies. */
export function downsampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === VOICE_SAMPLE_RATE || samples.length === 0) {
    return samples;
  }
  const ratio = fromRate / VOICE_SAMPLE_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    out[index] = samples[left]! * (1 - weight) + samples[right]! * weight;
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** Encode mono float samples (already at 16 kHz) as a 16-bit PCM WAV file. */
export function encodeWavPcm16(samples: Float32Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(offset, Math.round(clamped * 0x7fff), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/** Why this clip would be refused before it is sent, or null when it is fine. */
export function clipProblem(samples: Float32Array): ClipProblem | null {
  if (samples.length === 0) {
    return "empty";
  }
  if (samples.length / VOICE_SAMPLE_RATE > VOICE_MAX_CLIP_SECONDS) {
    return "tooLong";
  }
  if (44 + samples.length * 2 > VOICE_MAX_CLIP_BYTES) {
    return "tooLarge";
  }
  return null;
}

export function clipSeconds(samples: Float32Array): number {
  return samples.length / VOICE_SAMPLE_RATE;
}
