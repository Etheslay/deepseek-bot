// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPanel } from "../../src/renderer/src/features/memory/memory-panel.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const NOTE = "<img src=x onerror=alert(1)>Private note";
const MEMORY = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";

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

const EMPTY_LOADS = {
  "knowledge.list": { docs: [] },
  "memory.retention.get": {
    policy: { retentionDays: 0, memoryMaxPerBot: 0, knowledgeMaxPerBot: 0 },
  },
};

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
          if (method in EMPTY_LOADS) return EMPTY_LOADS[method as keyof typeof EMPTY_LOADS];
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
      root.render(createElement(MemoryPanel, { botId: BOT, onClose: () => undefined }));
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

  it("imports a picked file as a knowledge document and skips rejected files", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const imports: Array<
      { ok: true; title: string; text: string } | { ok: false; code: "format" | "cancelled" }
    > = [
      { ok: false, code: "format" },
      { ok: false, code: "cancelled" },
      { ok: true, title: "部署手册", text: "Imported knowledge" },
    ];
    let docs: Array<{ id: string; botId: string; title: string; size: number; at: string }> = [];
    window.deepseekBot = {
      knowledge: {
        importFile: async () => {
          const next = imports.shift();
          if (next === undefined) throw new Error("unexpected import");
          return next;
        },
      },
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "memory.list") return { memories: [] };
          if (method === "knowledge.list") return { docs };
          if (method in EMPTY_LOADS) return EMPTY_LOADS[method as keyof typeof EMPTY_LOADS];
          if (method === "knowledge.write") {
            const body = payload as { title: string; text: string };
            const doc = {
              id: DOC,
              botId: BOT,
              title: body.title,
              size: body.text.length,
              at: "2026-10-26T12:02:00.000Z",
            };
            docs = [doc];
            return doc;
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
      root.render(createElement(MemoryPanel, { botId: BOT, onClose: () => undefined }));
    });
    await act(async () => {
      click(container, "导入知识");
    });
    expect(container.textContent).toContain("只接受 .txt 和 .md 文件");
    expect(calls.some((call) => call.method === "knowledge.write")).toBe(false);
    await act(async () => {
      click(container, "导入知识");
    });
    expect(calls.some((call) => call.method === "knowledge.write")).toBe(false);
    await act(async () => {
      click(container, "导入知识");
    });
    expect(calls).toContainEqual({
      method: "knowledge.write",
      payload: { botId: BOT, title: "部署手册", text: "Imported knowledge" },
    });
    expect(container.textContent).toContain("已导入知识");
    expect(container.textContent).toContain("部署手册");
    expect(JSON.stringify(calls)).not.toContain("filePath");
  });

  it("searches knowledge documents and shows bounded snippets", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const hit = {
      docId: DOC,
      title: "部署手册",
      score: 0.82,
      snippet: "把 dist 目录发布到服务器",
      at: "2026-10-26T12:00:00.000Z",
    };
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "memory.list") return { memories: [] };
          if (method === "knowledge.list") return { docs: [] };
          if (method in EMPTY_LOADS) return EMPTY_LOADS[method as keyof typeof EMPTY_LOADS];
          if (method === "knowledge.search") return { hits: [hit] };
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(MemoryPanel, { botId: BOT, onClose: () => undefined }));
    });
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const search = container.querySelector('input[aria-label="检索知识"]');
    if (!(search instanceof HTMLInputElement)) throw new Error("missing knowledge search");
    await act(async () => {
      setValue?.call(search, "发布服务器");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "搜索知识");
    });
    expect(calls).toContainEqual({
      method: "knowledge.search",
      payload: { botId: BOT, query: "发布服务器" },
    });
    expect(container.textContent).toContain("部署手册");
    expect(container.textContent).toContain("把 dist 目录发布到服务器");
  });

  it("reads and saves the retention policy", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "memory.list") return { memories: [] };
          if (method === "knowledge.list") return { docs: [] };
          if (method === "memory.retention.get") {
            return {
              policy: { retentionDays: 30, memoryMaxPerBot: 500, knowledgeMaxPerBot: 100 },
            };
          }
          if (method === "memory.retention.set") return payload;
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(MemoryPanel, { botId: BOT, onClose: () => undefined }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toContainEqual({ method: "memory.retention.get", payload: {} });
    expect(container.textContent).toContain("保留策略");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const days = container.querySelector('input[aria-label="记忆保留天数"]');
    if (!(days instanceof HTMLInputElement)) throw new Error("missing retention input");
    await act(async () => {
      setValue?.call(days, "90");
      days.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "保存策略");
    });
    expect(calls).toContainEqual({
      method: "memory.retention.set",
      payload: {
        policy: { retentionDays: 90, memoryMaxPerBot: 500, knowledgeMaxPerBot: 100 },
      },
    });
    expect(container.textContent).toContain("已保存保留策略");
  });
});
