// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_MAX_CLIP_SECONDS, type VoiceStatus } from "@deepseek-bot/contracts";
import type { ClipRecorder } from "../../src/renderer/src/features/voice/clip-recorder.js";
import { ComposerMic } from "../../src/renderer/src/features/voice/composer-mic.js";

const startClipRecorder = vi.hoisted(() => vi.fn<() => Promise<ClipRecorder>>());

vi.mock("../../src/renderer/src/features/voice/clip-recorder.js", () => ({
  startClipRecorder,
}));

const ready: VoiceStatus = {
  transcribe: { available: true, reason: null },
  speak: { available: true, reason: null },
};

const unavailable: VoiceStatus = {
  transcribe: { available: false, reason: "whisper path not set" },
  speak: { available: false, reason: "no speech engine" },
};

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  startClipRecorder.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  delete (window as unknown as { deepseekBot?: unknown }).deepseekBot;
});

function deferredRecorder(samples: Float32Array): {
  promise: Promise<ClipRecorder>;
  open: () => void;
  reject: (error?: unknown) => void;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  let resolveStart: (recorder: ClipRecorder) => void = () => undefined;
  let rejectStart: (error?: unknown) => void = () => undefined;
  const stop = vi.fn(async () => samples);
  const cancel = vi.fn();
  const promise = new Promise<ClipRecorder>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  return {
    promise,
    open: () => resolveStart({ stop, cancel }),
    reject: (error) => rejectStart(error),
    stop,
    cancel,
  };
}

async function renderMic(
  props: Partial<{
    status: VoiceStatus | null;
    language: "zh" | "en";
    onTranscript: (text: string) => void;
    onNotify: (message: string) => void;
  }> = {},
): Promise<{ container: HTMLDivElement; button: HTMLButtonElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(ComposerMic, {
        status: props.status === undefined ? ready : props.status,
        ...(props.language !== undefined ? { language: props.language } : {}),
        onTranscript: props.onTranscript ?? (() => undefined),
        onNotify: props.onNotify ?? (() => undefined),
      }),
    );
  });
  const button = container.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("missing mic button");
  }
  return { container, button };
}

function pointer(
  button: HTMLButtonElement,
  type: "pointerdown" | "pointerup" | "pointercancel",
  mouseButton = 0,
): void {
  button.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: mouseButton, pointerId: 1 }),
  );
}

describe("ComposerMic", () => {
  it("stays disabled until voice.status says transcription is available", async () => {
    const blocked = await renderMic({ status: null });
    expect(blocked.button.disabled).toBe(true);
    expect(blocked.button.getAttribute("aria-label")).toContain("正在检查本机语音能力");
    const missing = await renderMic({ status: unavailable });
    expect(missing.button.disabled).toBe(true);
    expect(missing.button.getAttribute("aria-label")).toContain("本机语音转写不可用");
    pointer(missing.button, "pointerdown");
    expect(startClipRecorder).not.toHaveBeenCalled();
  });

  it("records while held and transcribes into the callback on release without sending", async () => {
    const calls: Array<{ method: string; language: string | undefined }> = [];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: { language?: string }) => {
          calls.push({ method, language: payload.language });
          if (method !== "voice.transcribe") {
            throw new Error(`unexpected ${method}`);
          }
          return { text: "  你好。再见。  ", seconds: 1 };
        },
      },
    } as unknown as Window["deepseekBot"];
    const transcripts: string[] = [];
    const recorder = deferredRecorder(new Float32Array(1600));
    startClipRecorder.mockImplementation(() => recorder.promise);
    const { button } = await renderMic({ onTranscript: (text) => transcripts.push(text) });

    await act(async () => {
      button.click();
    });
    expect(startClipRecorder).not.toHaveBeenCalled();

    await act(async () => {
      pointer(button, "pointerdown");
    });
    expect(startClipRecorder).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("recording");

    await act(async () => {
      recorder.open();
    });
    await act(async () => {
      pointer(button, "pointerup");
    });

    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(calls).toEqual([{ method: "voice.transcribe", language: "zh" }]);
    expect(transcripts).toEqual(["你好。再见。"]);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("cancels a hold that ends before the microphone opens and does not transcribe", async () => {
    const calls: string[] = [];
    window.deepseekBot = {
      host: { call: async (method: string) => void calls.push(method) },
    } as unknown as Window["deepseekBot"];
    const recorder = deferredRecorder(new Float32Array(1600));
    startClipRecorder.mockImplementation(() => recorder.promise);
    const transcripts: string[] = [];
    const { button } = await renderMic({ onTranscript: (text) => transcripts.push(text) });

    await act(async () => {
      pointer(button, "pointerdown");
      pointer(button, "pointerup");
    });
    await act(async () => {
      recorder.open();
    });

    expect(recorder.cancel).toHaveBeenCalledOnce();
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(transcripts).toEqual([]);
  });

  it("stops and transcribes once when the hold reaches the clip cap", async () => {
    vi.useFakeTimers();
    const calls: Array<{ method: string; language: string | undefined }> = [];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: { language?: string }) => {
          calls.push({ method, language: payload.language });
          return { text: "到上限", seconds: VOICE_MAX_CLIP_SECONDS };
        },
      },
    } as unknown as Window["deepseekBot"];
    const recorder = deferredRecorder(new Float32Array(1600));
    startClipRecorder.mockImplementation(() => recorder.promise);
    const transcripts: string[] = [];
    const { button } = await renderMic({
      language: "en",
      onTranscript: (text) => transcripts.push(text),
    });

    await act(async () => {
      pointer(button, "pointerdown");
      recorder.open();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_MAX_CLIP_SECONDS * 1000);
    });

    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(transcripts).toEqual(["到上限"]);
    await act(async () => {
      pointer(button, "pointerup");
    });
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(calls).toEqual([{ method: "voice.transcribe", language: "en" }]);
  });

  it("does not transcribe an empty clip", async () => {
    const calls: string[] = [];
    window.deepseekBot = {
      host: { call: async (method: string) => void calls.push(method) },
    } as unknown as Window["deepseekBot"];
    const notes: string[] = [];
    const transcripts: string[] = [];
    const recorder = deferredRecorder(new Float32Array(0));
    startClipRecorder.mockImplementation(() => recorder.promise);
    const { button } = await renderMic({
      onTranscript: (text) => transcripts.push(text),
      onNotify: (message) => notes.push(message),
    });
    await act(async () => {
      pointer(button, "pointerdown");
      recorder.open();
    });
    await act(async () => {
      pointer(button, "pointerup");
    });
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
    expect(transcripts).toEqual([]);
    expect(notes).toEqual(["没有录到声音"]);
  });

  it("reports a failed transcription and does not fill the input", async () => {
    window.deepseekBot = {
      host: {
        call: async () => {
          throw new Error("whisper failed");
        },
      },
    } as unknown as Window["deepseekBot"];
    const notes: string[] = [];
    const transcripts: string[] = [];
    const recorder = deferredRecorder(new Float32Array(1600));
    startClipRecorder.mockImplementation(() => recorder.promise);
    const { button } = await renderMic({
      onTranscript: (text) => transcripts.push(text),
      onNotify: (message) => notes.push(message),
    });
    await act(async () => {
      pointer(button, "pointerdown");
      recorder.open();
    });
    await act(async () => {
      pointer(button, "pointerup");
    });
    expect(transcripts).toEqual([]);
    expect(notes).toEqual(["转写失败，请再试一次"]);
  });

  it("does not start from a right click", async () => {
    const { button } = await renderMic();
    await act(async () => {
      pointer(button, "pointerdown", 2);
    });
    expect(startClipRecorder).not.toHaveBeenCalled();
  });

  it("holds from the keyboard and reports a denied microphone", async () => {
    const notes: string[] = [];
    const recorder = deferredRecorder(new Float32Array(0));
    startClipRecorder.mockImplementation(() => recorder.promise);
    const { button } = await renderMic({ onNotify: (message) => notes.push(message) });
    button.focus();
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(startClipRecorder).toHaveBeenCalledOnce();
    await act(async () => {
      recorder.reject(new Error("denied"));
    });
    expect(notes).toEqual(["无法使用麦克风（权限被拒或没有设备）"]);
  });
});
