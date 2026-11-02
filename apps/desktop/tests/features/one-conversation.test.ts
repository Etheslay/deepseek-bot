/**
 * Each bot has one conversation. The sidebar does not list sessions, and
 * chat reads/sends stay on the default session. Stored extra sessions are
 * left unread.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  BotSessionSublist,
  botConversationId,
  scopeToBotConversation,
  selectBotConversation,
} from "../../src/renderer/src/features/chat/one-conversation.js";
import { storedSessionId } from "../../src/renderer/src/services/stored-session.js";

const BOT = "11111111-1111-4111-8111-111111111111";
const EXTRA = "cs:44444444-4444-4444-8444-444444444444";
const OTHER = "cs:55555555-5555-4555-8555-555555555555";

const roots: Root[] = [];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("one conversation per bot", () => {
  it("does not render a session list under the bot", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(createElement(BotSessionSublist));
    });
    expect(container.querySelector(".session-sublist")).toBeNull();
    expect(container.querySelector(".session-item")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent ?? "").not.toContain("新建会话");
    expect(container.textContent ?? "").not.toContain("New chat");
  });

  it("uses the bot's default session and leaves extra sessions unread", () => {
    const choice = selectBotConversation(BOT, [storedSessionId(BOT), EXTRA, OTHER]);
    expect(botConversationId(BOT)).toBe(`chat:${BOT}`);
    expect(choice.sessionId).toBe(botConversationId(BOT));
    expect(choice.sessionId.startsWith("cs:")).toBe(false);
    expect(choice.unreadSessionIds).toEqual([EXTRA, OTHER]);
  });

  it("omits sessionId so send and history stay on that one conversation", () => {
    const history = scopeToBotConversation({
      botId: BOT,
      limit: 200,
      sessionId: EXTRA,
    });
    const usage = scopeToBotConversation({ botId: BOT, sessionId: EXTRA });
    const send = scopeToBotConversation({
      text: "你好",
      primitive: false,
      sessionId: botConversationId(BOT),
    });
    expect(history).toEqual({ botId: BOT, limit: 200 });
    expect(usage).toEqual({ botId: BOT });
    expect(send).toEqual({ text: "你好", primitive: false });
    expect("sessionId" in history).toBe(false);
    expect("sessionId" in usage).toBe(false);
    expect("sessionId" in send).toBe(false);
  });
});
