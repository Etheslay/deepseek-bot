// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPanel } from "../../src/renderer/src/features/memory/memory-panel.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const NOTE = "<img src=x onerror=alert(1)>Private note";
const MEMORY = "33333333-3333-4333-8333-333333333333";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
});

function click(container: ParentNode, label: string): void {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  if (button === undefined) throw new Error(`missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("memory panel", () => {
  it("lists, writes and deletes only the open bot, and keeps note text as text", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    let notes = [
      { id: MEMORY, botId: BOT, text: NOTE, at: "2026-10-26T12:00:00.000Z" },
    ];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "memory.list") return { memories: notes };
          if (method === "memory.write") {
            const text = (payload as { text: string }).text;
            notes = [{ id: MEMORY, botId: BOT, text, at: "2026-10-26T12:01:00.000Z" }];
            return notes[0];
          }
          if (method === "memory.delete") {
            notes = [];
            return { deleted: true };
          }
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(MemoryPanel, { botId: BOT }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toContainEqual({ method: "memory.list", payload: { botId: BOT } });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(NOTE);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const search = container.querySelector('input[aria-label="检索记忆"]');
    if (!(search instanceof HTMLInputElement)) throw new Error("missing search");
    await act(async () => {
      setValue?.call(search, "  alpha  ");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(calls).toContainEqual({
      method: "memory.list",
      payload: { botId: BOT, query: "alpha" },
    });
    const draft = container.querySelector('input[aria-label="记忆内容"]');
    if (!(draft instanceof HTMLInputElement)) throw new Error("missing draft");
    await act(async () => {
      setValue?.call(draft, "  desk note  ");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "保存记忆");
    });
    expect(calls).toContainEqual({
      method: "memory.write",
      payload: { botId: BOT, text: "desk note" },
    });
    expect(container.textContent).toContain("已保存记忆");
    await act(async () => {
      click(container, "删除");
    });
    expect(calls).toContainEqual({
      method: "memory.delete",
      payload: { botId: BOT, memoryId: MEMORY },
    });
    expect(container.textContent).toContain("已删除记忆");
  });
});
