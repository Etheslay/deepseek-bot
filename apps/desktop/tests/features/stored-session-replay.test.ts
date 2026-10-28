// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StoredSessionReplay } from "../../src/renderer/src/features/chat/stored-session-replay.js";
import { setLanguagePreference, t } from "../../src/renderer/src/i18n.js";
import type { ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.textContent = "";
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

async function render(messages: readonly ChatHistoryRow[] | null): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(StoredSessionReplay, { messages }));
  });
  return container;
}

const messages: ChatHistoryRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    botId: "22222222-2222-4222-8222-222222222222",
    sessionId: "chat:22222222-2222-4222-8222-222222222222",
    role: "user",
    text: "remember this",
    at: "2026-10-28T00:00:01.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111112",
    botId: "22222222-2222-4222-8222-222222222222",
    sessionId: "chat:22222222-2222-4222-8222-222222222222",
    role: "assistant",
    text: "stored reply",
    at: "2026-10-28T00:00:02.000Z",
  },
];

describe("StoredSessionReplay", () => {
  it("shows each stored message", async () => {
    const container = await render(messages);
    const bubbles = [...container.querySelectorAll(".msg-bubble")].map((node) => node.textContent);
    expect(bubbles).toEqual(["remember this", "stored reply"]);
    expect(container.querySelector(".msg-row.user")).not.toBeNull();
    expect(container.querySelector(".msg-row.bot")).not.toBeNull();
  });

  it("says nothing is stored when the session has no messages", async () => {
    const container = await render([]);
    expect(container.textContent).toContain(t("shell.noReplayMessages"));
  });

  it("draws nothing while the session is still opening", async () => {
    const container = await render(null);
    expect(container.textContent).toBe("");
  });
});
