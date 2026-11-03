/**
 * D27 local voice backend.
 *
 * `voice.transcribe` turns one bounded WAV clip into text with the whisper.cpp
 * CLI shipped beside the app, and `voice.speak` reads one bounded text aloud
 * with Windows SAPI. Both paths run on this machine: no model call, no cloud
 * transcription, no network. The desktop records and plays audio; the Host
 * never persists the clip or the synthesized sound — a transcript is returned
 * once and the temporary clip file is deleted when the run ends.
 *
 * The clip must be a 16 kHz, mono, 16-bit PCM WAV and stays at most
 * VOICE_MAX_CLIP_SECONDS long, so one request always fits the 1 MiB message
 * envelope. Longer takes are split by the recorder (auto-segmentation) before
 * they reach this contract; the Host rejects longer or malformed clips with
 * INVALID_INPUT and never resamples, converts, or guesses the format.
 */
import { z } from "zod";
import { NonEmptyStringSchema, TEXT_LIMITS } from "./primitives.js";

/** The only sample rate an accepted clip may use (Hz). */
export const VOICE_SAMPLE_RATE = 16_000;
/** Longest clip one request carries, in seconds. */
export const VOICE_MAX_CLIP_SECONDS = 20;
/** Byte budget for one clip: 20 s × 16 kHz × 2 bytes plus the WAV header. */
export const VOICE_MAX_CLIP_BYTES = 640 * 1024 + 1024;
/** Canonical base64 length bound for the encoded clip (4/3 of the byte cap). */
export const VOICE_MAX_AUDIO_BASE64_CHARS = 900_000;
/** One whisper run must finish inside this budget or it is killed. */
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 120_000;
/** One speak run must finish inside this budget or it is killed. */
export const VOICE_SPEAK_TIMEOUT_MS = 120_000;
/** Spoken languages hold-to-talk can ask whisper.cpp to transcribe. */
export const VoiceTranscriptionLanguageSchema = z.enum(["zh", "en"]);
export type VoiceTranscriptionLanguage = z.infer<typeof VoiceTranscriptionLanguageSchema>;
/** Used when a transcribe request omits `language`. */
export const DEFAULT_VOICE_TRANSCRIPTION_LANGUAGE = "zh" satisfies VoiceTranscriptionLanguage;

export const VoiceTranscriptionSchema = z
  .object({
    /** Trimmed whisper.cpp output. An all-silent clip returns an empty text. */
    text: z.string().max(TEXT_LIMITS.voiceTranscript),
    seconds: z.number().min(0).max(VOICE_MAX_CLIP_SECONDS),
  })
  .strict();
export type VoiceTranscription = z.infer<typeof VoiceTranscriptionSchema>;

export const VoiceStatusSchema = z
  .object({
    transcribe: z
      .object({
        available: z.boolean(),
        /** Null when available; a short local reason otherwise. */
        reason: z.string().max(200).nullable(),
      })
      .strict(),
    speak: z
      .object({
        available: z.boolean(),
        reason: z.string().max(200).nullable(),
      })
      .strict(),
  })
  .strict();
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const VoiceSpeakResultSchema = z
  .object({
    spoken: z.literal(true),
  })
  .strict();
export type VoiceSpeakResult = z.infer<typeof VoiceSpeakResultSchema>;

/**
 * Effective local whisper paths. Null means that side is not configured.
 * The user sets both in Settings → Voice. An environment seed applies only
 * when no stored value exists; a stored null stays empty.
 */
export const VoiceConfigSchema = z
  .object({
    whisperBin: z.string().min(1).max(1_024).nullable(),
    whisperModel: z.string().min(1).max(1_024).nullable(),
  })
  .strict();
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

/**
 * Trusted desktop methods. The user pressed the button, so there is no
 * capability, no grant, and no model tool: these methods are not reachable
 * from the model tool registry.
 */
export const VOICE_METHODS = {
  "voice.status": {
    request: z.object({}).strict(),
    response: VoiceStatusSchema,
  },
  "voice.transcribe": {
    request: z
      .object({
        audioBase64: z
          .string()
          .min(1)
          .max(VOICE_MAX_AUDIO_BASE64_CHARS),
        /**
         * whisper.cpp `-l` value. `zh` and `en` only. Omitted requests
         * transcribe as Chinese.
         */
        language: VoiceTranscriptionLanguageSchema.default(DEFAULT_VOICE_TRANSCRIPTION_LANGUAGE),
      })
      .strict(),
    response: VoiceTranscriptionSchema,
  },
  "voice.speak": {
    request: z
      .object({
        text: NonEmptyStringSchema(TEXT_LIMITS.voiceSpeakText),
      })
      .strict(),
    response: VoiceSpeakResultSchema,
  },
  /**
   * Effective whisper paths. A stored string is the path transcription uses.
   * Null clears that side. The model never reads or writes these paths.
   */
  "voice.config.get": {
    request: z.object({}).strict(),
    response: VoiceConfigSchema,
  },
  "voice.config.set": {
    request: VoiceConfigSchema,
    response: VoiceConfigSchema,
  },
} as const;
