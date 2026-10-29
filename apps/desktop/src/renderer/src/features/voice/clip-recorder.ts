/**
 * Microphone capture for the voice button (thin DOM layer).
 *
 * Records raw PCM through a ScriptProcessor (deprecated but present in every
 * Electron renderer and far simpler than an AudioWorklet for one button), then
 * stops cleanly and hands the caller float samples resampled to the contract
 * rate. All decision logic — clip bounds, WAV container, button state — lives in
 * the pure modules next to this file; nothing here is unit-tested because jsdom
 * has no audio stack.
 */
import { VOICE_MAX_CLIP_SECONDS, VOICE_SAMPLE_RATE } from "@deepseek-bot/contracts";
import { downsampleTo16k } from "./wav.js";

export type ClipRecorder = {
  /** Stop capture and resolve the clip at 16 kHz mono. */
  stop: () => Promise<Float32Array>;
  /** Abandon capture without producing a clip. */
  cancel: () => void;
};

export async function startClipRecorder(): Promise<ClipRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    // Copy: the buffer is reused by the audio thread after this callback.
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  // Some Chromium builds only run the processor when it reaches the destination.
  const silence = context.createGain();
  silence.gain.value = 0;
  processor.connect(silence);
  silence.connect(context.destination);

  let finished = false;
  const teardown = (): void => {
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
      source.disconnect();
      silence.disconnect();
    } catch {
      // Already disconnected: nothing to undo.
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    void context.close().catch(() => undefined);
  };

  return {
    stop: async () => {
      if (finished) {
        return new Float32Array(0);
      }
      finished = true;
      teardown();
      let total = 0;
      for (const chunk of chunks) {
        total += chunk.length;
      }
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const resampled = downsampleTo16k(merged, context.sampleRate);
      const maxSamples = VOICE_SAMPLE_RATE * VOICE_MAX_CLIP_SECONDS;
      return resampled.length > maxSamples ? resampled.slice(0, maxSamples) : resampled;
    },
    cancel: () => {
      if (finished) {
        return;
      }
      finished = true;
      teardown();
    },
  };
}
