import { describe, expect, it, vi } from "vitest";
import {
  runChatStream,
  type ChatStreamFn,
  type StreamStateForBot,
  type StreamUpdater,
} from "../../src/renderer/src/features/chat/stream-runner.js";
import type { StreamHandle, StreamResult } from "../../src/renderer/src/services/desktop-service.js";

function fakeStream(
  result: StreamResult,
  chunks = 2,
): { stream: ChatStreamFn; texts: string[] } {
  const texts: string[] = [];
  const stream: ChatStreamFn = (botId, text, handlers) => {
    void botId;
    void Promise.resolve().then(() => {
      for (let i = 0; i < chunks; i += 1) {
        texts.push(text);
        handlers.onDelta(text);
      }
    });
    return {
      cancel: () => undefined,
      finish: () => Promise.resolve(result),
    };
  };
  return { stream, texts };
}

function installUpdater(): {
  state: () => StreamStateForBot | null;
  update: StreamUpdater;
} {
  let current: StreamStateForBot | null = null;
  return {
    state: () => current,
    update: (fn) => {
      current = fn(current);
    },
  };
}

function run(
  stream: ChatStreamFn,
  forKey: number,
  onAssistant: (text: string) => void,
  update: StreamUpdater,
  onSettled?: (result: StreamResult) => void,
): StreamHandle {
  // The component resets the stream state before starting a turn; mirror that.
  update(() => ({ text: "", tools: [], failure: null, cancelled: false, forKey }));
  return runChatStream({
    stream,
    botId: "bot-1",
    text: "你好",
    forKey,
    update,
    onAssistant,
    ...(onSettled !== undefined ? { onSettled } : {}),
  });
}

describe("runChatStream (U5: one shared starter for composer, retry and cards)", () => {
  it("accumulates deltas and hands the full text to onAssistant, then clears the stream", async () => {
    const { stream, texts } = fakeStream({ cancelled: false, failure: null });
    const { update, state } = installUpdater();
    const onAssistant = vi.fn();
    const handle = run(stream, 7, onAssistant, update);
    await handle.finish();
    expect(texts).toEqual(["你好", "你好"]);
    expect(onAssistant).toHaveBeenCalledWith("你好你好");
    expect(state()).toBeNull();
  });

  it("applies the failure instead of the assistant bubble when the turn fails", async () => {
    const { stream } = fakeStream({
      cancelled: false,
      failure: { code: "AUTH_FAILED", message: "bad key", retryable: false },
    });
    const { update, state } = installUpdater();
    const handle = run(stream, 7, vi.fn(), update);
    await handle.finish();
    expect(state()?.failure).toEqual({
      code: "AUTH_FAILED",
      message: "bad key",
      retryable: false,
    });
  });

  it("keeps the cancelled state visible when the user stops the turn", async () => {
    const { stream } = fakeStream({ cancelled: true, failure: null });
    const { update, state } = installUpdater();
    const handle = run(stream, 7, vi.fn(), update);
    await handle.finish();
    expect(state()?.cancelled).toBe(true);
  });

  it("reports the settled result so D22 can update the tray and notify (U5)", async () => {
    const { stream } = fakeStream({ cancelled: false, failure: null });
    const { update } = installUpdater();
    const settled = vi.fn();
    const handle = run(stream, 7, vi.fn(), update, settled);
    await handle.finish();
    expect(settled).toHaveBeenCalledWith({ cancelled: false, failure: null });
  });

  it("still settles when the turn is cancelled or fails, with the raw result", async () => {
    for (const result of [
      { cancelled: true, failure: null },
      { cancelled: false, failure: { code: "AUTH_FAILED", message: "bad key", retryable: false } },
    ] as StreamResult[]) {
      const { stream } = fakeStream(result);
      const { update } = installUpdater();
      const settled = vi.fn();
      const handle = run(stream, 7, vi.fn(), update, settled);
      await handle.finish();
      expect(settled).toHaveBeenCalledWith(result);
    }
  });

  it("ignores updates that belong to another bot chat", async () => {
    const { stream } = fakeStream({ cancelled: false, failure: null });
    const { update, state } = installUpdater();
    const handle = run(stream, 7, vi.fn(), update);
    // Another chat (forKey 8) took over the stream state before the finish.
    update(() => ({ text: "other", tools: [], failure: null, cancelled: false, forKey: 8 }));
    await handle.finish();
    expect(state()).toEqual({
      text: "other",
      tools: [],
      failure: null,
      cancelled: false,
      forKey: 8,
    });
  });
});
