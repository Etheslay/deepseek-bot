/**
 * D27 voice service and handler tests. The real whisper.cpp and SAPI
 * processes are replaced by injected runners; the WAV parser, limits,
 * serialization, deadlines, transient-file cleanup, and the handler wiring
 * are exercised for real.
 */
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DeepSeekBotHost } from "./host.js";
import { createHost } from "./host.js";
import { createVoiceService, parseWavClip, type VoiceService } from "./voice.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Build one strict PCM WAV buffer (44-byte header) for the clip fixtures. */
function wavBytes(
  seconds: number,
  opts: { sampleRate?: number; channels?: number; bits?: number } = {},
): Buffer {
  const sampleRate = opts.sampleRate ?? 16_000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const bytesPerSample = channels * (bits / 8);
  const dataLength = Math.max(1, Math.floor(sampleRate * bytesPerSample * seconds));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, Buffer.alloc(dataLength)]);
}

function base64Of(seconds: number, opts?: { sampleRate?: number; channels?: number; bits?: number }): string {
  return wavBytes(seconds, opts).toString("base64");
}

function expectError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as { code?: string }).code).toBe(code);
}

function makeConfiguredFiles(): { bin: string; model: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "dsb-voice-config-"));
  roots.push(root);
  const bin = join(root, "whisper-cli.exe");
  const model = join(root, "ggml-tiny.bin");
  writeFileSync(bin, "fake");
  writeFileSync(model, "fake");
  return { bin, model, root };
}

describe("voice status", () => {
  it("reports the exact reason when whisper.cpp is not configured", () => {
    const service = createVoiceService();
    expect(service.status().transcribe).toEqual({
      available: false,
      reason: "whisper.cpp binary is not configured",
    });
    const binOnly = createVoiceService({ whisperBin: join(tmpdir(), "missing.exe") });
    expect(binOnly.status().transcribe).toEqual({
      available: false,
      reason: "whisper.cpp model is not configured",
    });
  });

  it("distinguishes a missing binary from a missing model", () => {
    const { bin } = makeConfiguredFiles();
    const noModel = createVoiceService({ whisperBin: bin, whisperModel: join(tmpdir(), "nope.bin") });
    expect(noModel.status().transcribe).toEqual({
      available: false,
      reason: "whisper.cpp model was not found",
    });
    const { model } = makeConfiguredFiles();
    const noBin = createVoiceService({ whisperBin: join(tmpdir(), "nope.exe"), whisperModel: model });
    expect(noBin.status().transcribe).toEqual({
      available: false,
      reason: "whisper.cpp binary was not found",
    });
  });

  it("marks transcription available with both files present and speak per platform", () => {
    const { bin, model } = makeConfiguredFiles();
    const service = createVoiceService({ whisperBin: bin, whisperModel: model });
    expect(service.status().transcribe).toEqual({ available: true, reason: null });
    const speak = service.status().speak;
    if (process.platform === "win32") {
      expect(speak).toEqual({ available: true, reason: null });
    } else {
      expect(speak.available).toBe(false);
      expect(speak.reason).toContain("Windows");
    }
  });
});

describe("voice transcribe", () => {
  function serviceWith(runner: ReturnType<typeof vi.fn>): VoiceService {
    return createVoiceService({ runTranscribe: runner as never });
  }

  it("writes a transient clip, trims the transcript, and deletes the clip", async () => {
    let seenPath = "";
    const runner = vi.fn(async (wavPath: string) => {
      seenPath = wavPath;
      expect(existsSync(wavPath)).toBe(true);
      expect(wavPath.endsWith("clip.wav")).toBe(true);
      return "  hello world \n\n";
    });
    const service = serviceWith(runner);
    const result = await service.transcribe(base64Of(1));
    expect(result).toEqual({ text: "hello world", seconds: 1 });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(existsSync(seenPath)).toBe(false);
  });

  it("reports the clip length implied by the data chunk", async () => {
    const runner = vi.fn(async () => "text");
    const service = serviceWith(runner);
    const result = await service.transcribe(base64Of(0.5));
    expect(result.seconds).toBe(0.5);
  });

  it("rejects malformed or out-of-budget clips with INVALID_INPUT", async () => {
    const runner = vi.fn(async () => "text");
    const service = serviceWith(runner);
    const cases: Array<[string, string]> = [
      ["not base64", "!!!not-base64!!!"],
      ["empty audio", Buffer.alloc(0).toString("base64")],
      ["wrong rate", base64Of(0.1, { sampleRate: 44_100 })],
      ["stereo", base64Of(0.1, { channels: 2 })],
      ["eight bit", base64Of(0.1, { bits: 8 })],
      ["truncated", Buffer.alloc(10).toString("base64")],
      ["too long", base64Of(20.5)],
    ];
    for (const [name, audio] of cases) {
      try {
        await service.transcribe(audio);
        expect.unreachable(`expected ${name} to be rejected`);
      } catch (error) {
        expectError(error, "INVALID_INPUT");
      }
    }
    expect(runner).not.toHaveBeenCalled();
  });

  it("parses a boundary clip at exactly 20 seconds", () => {
    expect(parseWavClip(wavBytes(20)).seconds).toBe(20);
    expect(() => parseWavClip(wavBytes(20.1))).toThrowError(/exceeds 20 seconds/);
  });

  it("runs one job at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const runner = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return "done";
    });
    const service = serviceWith(runner);
    const [first, second] = await Promise.all([
      service.transcribe(base64Of(0.1)),
      service.transcribe(base64Of(0.1)),
    ]);
    expect(first.text).toBe("done");
    expect(second.text).toBe("done");
    expect(maxActive).toBe(1);
  });

  it("stops a run that exceeds its deadline with TOOL_TIMEOUT", async () => {
    const runner = vi.fn(
      (_wavPath: string, signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => resolve("late"), { once: true });
        }),
    );
    const service = createVoiceService({ runTranscribe: runner as never, transcribeTimeoutMs: 40 });
    try {
      await service.transcribe(base64Of(0.1));
      expect.unreachable("expected the deadline to fire");
    } catch (error) {
      expectError(error, "TOOL_TIMEOUT");
    }
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed whisper run as RUNTIME_UNAVAILABLE", async () => {
    const service = createVoiceService({
      runTranscribe: async () => {
        throw new Error("whisper crashed");
      },
    });
    try {
      await service.transcribe(base64Of(0.1));
      expect.unreachable("expected the run to fail");
    } catch (error) {
      expectError(error, "RUNTIME_UNAVAILABLE");
    }
  });

  it("refuses new work and stops the live job after close()", async () => {
    let signalStarted: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let aborted = false;
    const service = createVoiceService({
      transcribeTimeoutMs: 10_000,
      runTranscribe: (_wavPath, signal) => {
        signalStarted?.();
        return new Promise<string>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("stopped"));
            },
            { once: true },
          );
        });
      },
    });
    const pending = service.transcribe(base64Of(0.1));
    await startedPromise;
    service.close();
    await expect(pending).rejects.toSatisfy((error: unknown) => {
      expectError(error, "TOOL_TIMEOUT");
      return true;
    });
    expect(aborted).toBe(true);
    await expect(service.transcribe(base64Of(0.1))).rejects.toSatisfy((error: unknown) => {
      expectError(error, "RUNTIME_UNAVAILABLE");
      return true;
    });
    service.close();
  });
});

describe("voice speak", () => {
  it("hands the text to the platform runner and reports spoken", async () => {
    const runner = vi.fn(async (text: string) => {
      expect(text).toBe("你好，世界");
    });
    const service = createVoiceService({ runSpeak: runner as never });
    expect(await service.speak("你好，世界")).toEqual({ spoken: true });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("stops a speech run that exceeds its deadline", async () => {
    const service = createVoiceService({
      speakTimeoutMs: 40,
      runSpeak: (_text, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    });
    try {
      await service.speak("too slow");
      expect.unreachable("expected the deadline to fire");
    } catch (error) {
      expectError(error, "TOOL_TIMEOUT");
    }
  });

  it("surfaces a failed speech run as RUNTIME_UNAVAILABLE", async () => {
    const service = createVoiceService({
      runSpeak: async () => {
        throw new Error("sapi failed");
      },
    });
    try {
      await service.speak("hello");
      expect.unreachable("expected the run to fail");
    } catch (error) {
      expectError(error, "RUNTIME_UNAVAILABLE");
    }
  });
});

describe("voice handlers", () => {
  it("serves voice.status, voice.transcribe and voice.speak over the contract surface", async () => {
    const { bin, model } = makeConfiguredFiles();
    const root = mkdtempSync(join(tmpdir(), "dsb-voice-host-"));
    roots.push(root);
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
      voice: {
        whisperBin: bin,
        whisperModel: model,
        runTranscribe: async (wavPath) => {
          expect(existsSync(wavPath)).toBe(true);
          return " 你好，本地语音 ";
        },
        runSpeak: async () => undefined,
      },
    });
    hosts.push(host);
    const status = (await host.handleMethod("voice.status", {})) as {
      transcribe: { available: boolean };
      speak: { available: boolean };
    };
    expect(status.transcribe.available).toBe(true);
    expect(status.speak.available).toBe(process.platform === "win32");
    const transcription = (await host.handleMethod("voice.transcribe", {
      audioBase64: base64Of(0.25),
    })) as { text: string; seconds: number };
    expect(transcription.text).toBe("你好，本地语音");
    expect(transcription.seconds).toBe(0.25);
    const spoken = (await host.handleMethod("voice.speak", { text: "本机播报" })) as {
      spoken: boolean;
    };
    expect(spoken.spoken).toBe(true);
  });

  it("keeps voice out of the model tool registry", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-voice-host-"));
    roots.push(root);
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
    });
    hosts.push(host);
    const names = host.agentTools.capabilities.list().map((entry) => entry.name);
    for (const name of names) {
      expect(name).not.toMatch(/voice/i);
    }
  });

  it("removes transient clips even when the host shuts down mid-run", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-voice-host-"));
    roots.push(root);
    let signalStarted: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
      voice: {
        runTranscribe: (_wavPath, signal) => {
          signalStarted?.();
          return new Promise<string>((resolve) => {
            signal.addEventListener("abort", () => resolve("stopped"), { once: true });
          });
        },
      },
    });
    hosts.push(host);
    const before = readdirSync(tmpdir()).filter((entry) => entry.startsWith("deepseek-bot-voice-"));
    const pending = host.handleMethod("voice.transcribe", { audioBase64: base64Of(0.1) });
    await startedPromise;
    await host.shutdown();
    // The in-flight run stops with the service deadline; the clip is gone
    // once the rejection surfaces (the finally block runs first).
    await expect(pending).rejects.toSatisfy((error: unknown) => {
      expectError(error, "TOOL_TIMEOUT");
      return true;
    });
    const after = readdirSync(tmpdir()).filter((entry) => entry.startsWith("deepseek-bot-voice-"));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
