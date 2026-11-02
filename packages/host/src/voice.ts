/**
 * D27 local voice backend.
 *
 * `transcribe` runs the shipped whisper.cpp binary over one bounded WAV
 * clip; `speak` reads one bounded text aloud with Windows SAPI through a
 * fixed PowerShell script. Both are trusted desktop paths: the user pressed
 * the button, so there is no capability, no grant, and no model tool. Nothing
 * leaves the machine, the temporary clip is deleted when the run ends, and
 * error messages never quote process output back to the caller.
 *
 * The binary and model default to the bundle fetched at dev/pack time. An
 * explicit boot path (environment or test) replaces that default. A later
 * null config drops an override and returns to the boot paths; it does not
 * turn a shipped engine off. A missing bundle keeps `status` honest.
 *
 * One local voice job runs at a time — whisper and SAPI are heavy, so calls
 * queue behind each other instead of stacking speech processes. Each job has
 * one deadline: the service aborts the job's signal (which kills the real
 * child process) and reports TOOL_TIMEOUT. `close()` aborts the live job and
 * refuses new ones.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_VOICE_TRANSCRIPTION_LANGUAGE,
  VOICE_MAX_CLIP_BYTES,
  VOICE_MAX_CLIP_SECONDS,
  VOICE_SAMPLE_RATE,
  VOICE_SPEAK_TIMEOUT_MS,
  VOICE_TRANSCRIBE_TIMEOUT_MS,
  type VoiceSpeakResult,
  type VoiceStatus,
  type VoiceTranscription,
  type VoiceTranscriptionLanguage,
} from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";

export type VoiceTranscribeRunner = (
  wavPath: string,
  signal: AbortSignal,
) => Promise<string>;
export type VoiceSpeakRunner = (text: string, signal: AbortSignal) => Promise<void>;

export interface VoiceService {
  status(): VoiceStatus;
  /** Current local whisper configuration (null = not set). */
  config(): { whisperBin: string | null; whisperModel: string | null };
  /** Apply a new configuration live; null clears. The KV persistence lives in the caller. */
  setConfig(next: { whisperBin: string | null; whisperModel: string | null }): void;
  transcribe(audioBase64: string, language?: VoiceTranscriptionLanguage): Promise<VoiceTranscription>;
  speak(text: string): Promise<VoiceSpeakResult>;
  close(): void;
}

export interface VoiceServiceOptions {
  readonly whisperBin?: string;
  readonly whisperModel?: string;
  readonly transcribeTimeoutMs?: number;
  readonly speakTimeoutMs?: number;
  /** Test seam: replaces the real whisper.cpp process. */
  readonly runTranscribe?: VoiceTranscribeRunner;
  /** Test seam: replaces the real SAPI process. */
  readonly runSpeak?: VoiceSpeakRunner;
}

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

function unavailable(message: string): EngineError {
  return new EngineError({ code: "RUNTIME_UNAVAILABLE", message, retryable: false });
}

function timeout(ms: number): EngineError {
  return new EngineError({
    code: "TOOL_TIMEOUT",
    message: `voice run exceeded its ${ms} ms budget and was stopped`,
    retryable: true,
  });
}

function transcriptionLanguage(language: string): VoiceTranscriptionLanguage {
  if (language === "zh" || language === "en") {
    return language;
  }
  throw invalid("voice transcription language must be zh or en");
}

/** Fixed whisper-cli argv. Language is only `-l zh` or `-l en`. */
export function whisperCliArgs(
  model: string,
  wavPath: string,
  language: VoiceTranscriptionLanguage,
): string[] {
  return ["-m", model, "-f", wavPath, "-l", transcriptionLanguage(language), "-nt", "-np"];
}

/**
 * Parse one strict WAV clip: RIFF/WAVE, 16 kHz, mono, 16-bit PCM. Chunk
 * walking is size-bounded so a truncated or lying header cannot overrun the
 * buffer. Returns the payload seconds implied by the data chunk.
 */
export function parseWavClip(bytes: Buffer): { seconds: number } {
  if (bytes.length > VOICE_MAX_CLIP_BYTES) {
    throw invalid(`voice clip exceeds ${VOICE_MAX_CLIP_SECONDS} seconds`);
  }
  if (
    bytes.length < 44 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WAVE"
  ) {
    throw invalid("voice clip must be a RIFF/WAVE file");
  }
  let offset = 12;
  let format: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bits: number | undefined;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("latin1", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.length) {
      format = bytes.readUInt16LE(body);
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      bits = bytes.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataLength = Math.min(size, Math.max(bytes.length - body, 0));
      break;
    }
    // Chunks are word-aligned; a lying huge size just ends the walk.
    if (size === 0) break;
    offset = body + size + (size % 2);
  }
  if (format !== 1 || channels !== 1 || sampleRate !== VOICE_SAMPLE_RATE || bits !== 16) {
    throw invalid(`voice clip must be ${VOICE_SAMPLE_RATE} Hz mono 16-bit PCM WAV`);
  }
  if (dataLength <= 0) {
    throw invalid("voice clip audio is empty");
  }
  const bytesPerSecond = VOICE_SAMPLE_RATE * 2;
  if (dataLength > bytesPerSecond * VOICE_MAX_CLIP_SECONDS) {
    throw invalid(`voice clip exceeds ${VOICE_MAX_CLIP_SECONDS} seconds`);
  }
  return { seconds: dataLength / bytesPerSecond };
}

/** Canonical base64: decode, reject empties, and refuse non-canonical padding. */
function decodeClipAudio(audioBase64: string): Buffer {
  const bytes = Buffer.from(audioBase64, "base64");
  if (!bytes.length || bytes.length > VOICE_MAX_CLIP_BYTES || bytes.toString("base64") !== audioBase64) {
    throw invalid("voice clip audio must be canonical base64 within the size budget");
  }
  return bytes;
}

export function createVoiceService(options: VoiceServiceOptions = {}): VoiceService {
  const transcribeTimeoutMs = options.transcribeTimeoutMs ?? VOICE_TRANSCRIBE_TIMEOUT_MS;
  const speakTimeoutMs = options.speakTimeoutMs ?? VOICE_SPEAK_TIMEOUT_MS;
  // Boot paths are the shipped bundle or an explicit environment/test path.
  // voice.config.set may override them; null returns to this boot pair.
  const bootBin = options.whisperBin;
  const bootModel = options.whisperModel;
  let whisperBin = bootBin;
  let whisperModel = bootModel;
  let closed = false;
  const active = new Set<AbortController>();
  // One local voice at a time; the queue keeps the machine from stacking
  // speech processes behind each other.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  function requireOpen(): void {
    if (closed) throw unavailable("voice host is closed");
  }

  function transcribeStatus(): VoiceStatus["transcribe"] {
    if (whisperBin === undefined || whisperBin.length === 0) {
      return { available: false, reason: "whisper.cpp binary is not configured" };
    }
    if (whisperModel === undefined || whisperModel.length === 0) {
      return { available: false, reason: "whisper.cpp model is not configured" };
    }
    if (!existsSync(whisperBin)) {
      return { available: false, reason: "whisper.cpp binary was not found" };
    }
    if (!existsSync(whisperModel)) {
      return { available: false, reason: "whisper.cpp model was not found" };
    }
    return { available: true, reason: null };
  }

  function speakStatus(): VoiceStatus["speak"] {
    if (process.platform !== "win32") {
      return { available: false, reason: "Windows SAPI speech is only available on Windows" };
    }
    return { available: true, reason: null };
  }

  /** The real whisper.cpp run: fixed argument array, no shell, output captured. */
  async function runWhisperProcess(
    wavPath: string,
    signal: AbortSignal,
    language: VoiceTranscriptionLanguage,
  ): Promise<string> {
    const child = spawn(
      whisperBin!,
      whisperCliArgs(whisperModel!, wavPath, language),
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const stop = (): void => {
      child.kill();
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    if (signal.aborted) {
      // The service already reported the deadline or shutdown; return quietly
      // so the race settles on that error instead of this run.
      return stdout;
    }
    if (exit !== 0) {
      // Process output stays local; the caller gets the exit code only.
      throw unavailable(`whisper.cpp transcription failed (exit ${exit ?? "unknown"})`);
    }
    return stdout;
  }

  /** The real SAPI run: one fixed PowerShell script, text carried as base64. */
  async function runSpeakProcess(text: string, signal: AbortSignal): Promise<void> {
    const textBase64 = Buffer.from(text, "utf8").toString("base64");
    const script =
      "$ErrorActionPreference = 'Stop'; " +
      "Add-Type -AssemblyName System.Speech; " +
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
      `$s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${textBase64}'))); ` +
      "$s.Dispose()";
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    const stop = (): void => {
      child.kill();
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    if (signal.aborted) {
      return;
    }
    if (exit !== 0) {
      // The script and its errors stay local; the caller gets the exit code.
      throw unavailable(`Windows SAPI speech failed (exit ${exit ?? "unknown"})`);
    }
  }

  async function transcribe(
    audioBase64: string,
    language: VoiceTranscriptionLanguage = DEFAULT_VOICE_TRANSCRIPTION_LANGUAGE,
  ): Promise<VoiceTranscription> {
    requireOpen();
    const spoken = transcriptionLanguage(language);
    const bytes = decodeClipAudio(audioBase64);
    const { seconds } = parseWavClip(bytes);
    const dir = await mkdtemp(join(tmpdir(), `deepseek-bot-voice-${randomUUID().slice(0, 8)}-`));
    const wavPath = join(dir, "clip.wav");
    await writeFile(wavPath, bytes, { mode: 0o600 });
    const controller = new AbortController();
    active.add(controller);
    let timer: NodeJS.Timeout | undefined;
    try {
      const raw = await enqueue(() => {
        if (closed) throw unavailable("voice host is closed");
        timer = setTimeout(() => {
          controller.abort();
        }, transcribeTimeoutMs);
        timer.unref?.();
        // The deadline listener registers before the runner so an abort
        // settles the race with TOOL_TIMEOUT even when the runner also
        // settles on the same signal.
        return Promise.race([
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(timeout(transcribeTimeoutMs)), {
              once: true,
            });
          }),
          (options.runTranscribe ??
            ((path, abort) => runWhisperProcess(path, abort, spoken)))(wavPath, controller.signal),
        ]);
      });
      return { text: raw.trim(), seconds };
    } catch (error) {
      if (error instanceof EngineError) throw error;
      // Runner failures stay sanitized: no process output, no raw message.
      throw unavailable("voice transcription failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      active.delete(controller);
      // The clip is transient: delete it even when the run failed. Windows
      // may hold the file for a moment after the child exits; retry briefly
      // and leave the tmpdir behind rather than failing the call.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  }

  async function speak(text: string): Promise<VoiceSpeakResult> {
    requireOpen();
    const controller = new AbortController();
    active.add(controller);
    let timer: NodeJS.Timeout | undefined;
    try {
      await enqueue(() => {
        if (closed) throw unavailable("voice host is closed");
        timer = setTimeout(() => {
          controller.abort();
        }, speakTimeoutMs);
        timer.unref?.();
        return Promise.race([
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(timeout(speakTimeoutMs)), {
              once: true,
            });
          }),
          (options.runSpeak ?? runSpeakProcess)(text, controller.signal),
        ]);
      });
      return { spoken: true };
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw unavailable("voice speech failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      active.delete(controller);
    }
  }

  return {
    status() {
      return { transcribe: transcribeStatus(), speak: speakStatus() };
    },
    config() {
      return { whisperBin: whisperBin ?? null, whisperModel: whisperModel ?? null };
    },
    setConfig(next) {
      whisperBin = next.whisperBin === null ? bootBin : next.whisperBin;
      whisperModel = next.whisperModel === null ? bootModel : next.whisperModel;
    },
    transcribe,
    speak,
    close() {
      if (closed) return;
      closed = true;
      for (const controller of active) controller.abort();
      active.clear();
    },
  };
}
