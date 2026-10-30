// @vitest-environment jsdom
/**
 * B6 incremental streaming in the host service: live assistant segments are
 * smoothed through the shared pacing rules, the authoritative reply wins at
 * settlement, and a bridge without the channel degrades to the old full
 * replay.
 */
import { describe, expect, it } from "vitest";
import { createHostService } from "../../src/renderer/src/services/host-service.js";

type Notice = { botId: string; sessionId: string; text: string };

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeService(reply: string, options: { segments?: Notice[] } = {}): {
  deltas: string[];
  finish: () => Promise<{ cancelled: boolean; text?: string }>;
  push: (notice: Notice) => void;
} {
  const listeners = new Set<(notice: Notice) => void>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bridge = {
    host: {
      call: async (method: string) => {
        if (method !== "chat.send") return {};
        await gate;
        return { text: reply };
      },
      ...(options.segments !== undefined
        ? {
            onChatStream: (listener: (notice: Notice) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          }
        : {}),
    },
    settings: { saveKey: async () => ({ configured: true }) },
  };
  const service = createHostService(bridge as unknown as Parameters<typeof createHostService>[0]);
  const deltas: string[] = [];
  const handle = service.chat.stream("bot-1", "你好", {
    onDelta: (chunk) => deltas.push(chunk),
    onTool: () => undefined,
  });
  return {
    deltas,
    push: (notice) => {
      for (const listener of listeners) listener(notice);
    },
    finish: async () => {
      release();
      const result = await handle.finish();
      return { cancelled: result.cancelled, ...(result.text !== undefined ? { text: result.text } : {}) };
    },
  };
}

const joined = (deltas: string[]): string => deltas.join("");

describe("chat streaming (B6 incremental)", () => {
  it("keeps the paced full replay when the bridge has no stream channel", async () => {
    const reply = "第一句。第二句。";
    const stream = makeService(reply);
    await stream.finish();
    await waitFor(() => joined(stream.deltas) === reply);
    expect(joined(stream.deltas)).toBe(reply);
  });

  it("paces a live segment and settles on the authoritative reply", async () => {
    const reply = "最终回复";
    const stream = makeService(reply, {
      segments: [{ botId: "bot-1", sessionId: "chat:bot-1:s1", text: reply }],
    });
    stream.push({ botId: "bot-1", sessionId: "chat:bot-1:s1", text: reply });
    const result = await stream.finish();
    await waitFor(() => joined(stream.deltas) === reply);
    expect(joined(stream.deltas)).toBe(reply);
    expect(result).toEqual({ cancelled: false, text: reply });
  });

  it("does not append a diverging reply after interim narration; the caller commits text", async () => {
    const stream = makeService("最终回复", {
      segments: [{ botId: "bot-1", sessionId: "chat:bot-1:s1", text: "旁白" }],
    });
    stream.push({ botId: "bot-1", sessionId: "chat:bot-1:s1", text: "旁白" });
    const result = await stream.finish();
    await waitFor(() => joined(stream.deltas) === "旁白");
    // No further deltas: the reply does not extend the shown narration.
    expect(joined(stream.deltas)).toBe("旁白");
    expect(result).toEqual({ cancelled: false, text: "最终回复" });
  });

  it("ignores segments that belong to another bot", async () => {
    const reply = "最终回复";
    const stream = makeService(reply, {
      segments: [{ botId: "other", sessionId: "chat:other:s1", text: "别的机器人" }],
    });
    stream.push({ botId: "other", sessionId: "chat:other:s1", text: "别的机器人" });
    const result = await stream.finish();
    await waitFor(() => joined(stream.deltas) === reply);
    expect(stream.deltas).toEqual([reply]);
    expect(result).toEqual({ cancelled: false, text: reply });
  });
});
