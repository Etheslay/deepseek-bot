import { describe, expect, it } from "vitest";
import type { ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";
import {
  messagesForStoredSession,
  STORED_SESSION_HISTORY_LIMIT,
  STORED_SESSION_TITLE_LIMIT,
  storedChatSession,
  storedSessionBotId,
  storedSessionId,
} from "../../src/renderer/src/services/stored-session.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function row(
  partial: Partial<ChatHistoryRow> & Pick<ChatHistoryRow, "id" | "text" | "at">,
): ChatHistoryRow {
  return {
    botId: BOT,
    sessionId: storedSessionId(BOT),
    role: "user",
    ...partial,
  };
}

describe("stored chat session", () => {
  it("reads the same history window as the open thread", () => {
    expect(STORED_SESSION_HISTORY_LIMIT).toBe(200);
  });

  it("returns no session when the bot has no messages", () => {
    expect(storedChatSession(BOT, [])).toEqual([]);
    expect(messagesForStoredSession(storedSessionId(BOT), [])).toEqual([]);
  });

  it("returns chat:<botId> and that session's messages", () => {
    const messages = [
      row({ id: "m1", text: "remember this", at: "2026-10-28T00:00:01.000Z" }),
      row({
        id: "m2",
        role: "assistant",
        text: "stored reply",
        at: "2026-10-28T00:00:02.000Z",
      }),
    ];
    expect(storedChatSession(BOT, messages)).toEqual([
      {
        sessionId: `chat:${BOT}`,
        botId: BOT,
        title: "remember this",
        startedAt: "2026-10-28T00:00:01.000Z",
        replayEventCount: 2,
        status: "active",
      },
    ]);
    expect(messagesForStoredSession(`chat:${BOT}`, messages)).toEqual(messages);
  });

  it("ignores rows stored under a different session id", () => {
    const foreign = row({
      id: "m1",
      botId: OTHER,
      sessionId: storedSessionId(OTHER),
      text: "other bot",
      at: "2026-10-28T00:00:01.000Z",
    });
    expect(storedChatSession(BOT, [foreign])).toEqual([]);
    expect(messagesForStoredSession(storedSessionId(BOT), [foreign])).toEqual([]);
  });

  it("labels the session with the first plain user line", () => {
    const messages = [
      row({
        id: "m1",
        text: "【任务】dispatch",
        at: "2026-10-28T00:00:01.000Z",
        meta: {
          kind: "dispatch",
          taskId: "44444444-4444-4444-8444-444444444444",
          fromBotId: OTHER,
        },
      }),
      row({
        id: "m2",
        text: "  hello\nthere  ",
        at: "2026-10-28T00:00:03.000Z",
      }),
    ];
    expect(storedChatSession(BOT, messages)[0]).toMatchObject({
      title: "hello there",
      startedAt: "2026-10-28T00:00:01.000Z",
      replayEventCount: 2,
    });
  });

  it("truncates a long title to one line", () => {
    const text = "a".repeat(STORED_SESSION_TITLE_LIMIT + 12);
    const [session] = storedChatSession(BOT, [
      row({ id: "m1", text, at: "2026-10-28T00:00:01.000Z" }),
    ]);
    expect(session?.title).toHaveLength(STORED_SESSION_TITLE_LIMIT);
    expect(session?.title.endsWith("…")).toBe(true);
    expect(session?.title.startsWith("a")).toBe(true);
  });

  it("accepts only chat:<uuid>", () => {
    expect(storedSessionBotId(`chat:${BOT}`)).toBe(BOT);
    expect(storedSessionBotId(`chat:${BOT}:extra`)).toBeNull();
    expect(storedSessionBotId("sess-success-run")).toBeNull();
    expect(storedSessionBotId("")).toBeNull();
  });
});
