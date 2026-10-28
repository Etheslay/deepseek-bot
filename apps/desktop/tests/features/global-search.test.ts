// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "../../src/renderer/src/features/search/global-search.js";
import type { SearchItem } from "../../src/renderer/src/features/search/search-core.js";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function typeQuery(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderOverlay(props: {
  items?: SearchItem[];
  queryHost?: (query: string) => Promise<SearchItem[]>;
  onSelect?: (item: SearchItem) => void;
}): { container: HTMLDivElement; input: HTMLInputElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const localItems: SearchItem[] = props.items ?? [
    { id: "bot-1", kind: "bot", title: "note-summarizer", botKey: 1, botId: "11111111-1111-4111-8111-111111111111" },
    { id: "action-settings", kind: "action", title: "打开设置", action: "settings" },
  ];
  act(() => {
    root.render(
      createElement(GlobalSearch, {
        open: true,
        items: localItems,
        onSelect: props.onSelect ?? (() => undefined),
        onClose: () => undefined,
        ...(props.queryHost !== undefined ? { queryHost: props.queryHost } : {}),
      }),
    );
  });
  const input = container.querySelector("input");
  if (input === null) throw new Error("missing search input");
  return { container, input };
}

function flushMicrotasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
  });
}

describe("GlobalSearch host retrieval (D25 second half)", () => {
  it("appends host hits under the host section and selects them with Enter", async () => {
    const hostHit: SearchItem = {
      id: "host-message-1",
      kind: "message",
      title: "research-bot",
      subtitle: "…Electron 安全公告…",
      botId: "22222222-2222-4222-8222-222222222222",
    };
    const queryHost = vi.fn(() => Promise.resolve([hostHit]));
    const selected: SearchItem[] = [];
    const { container, input } = renderOverlay({ queryHost, onSelect: (item) => selected.push(item) });

    typeQuery(input, "公告");
    expect(queryHost).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flushMicrotasks();
    expect(queryHost).toHaveBeenCalledTimes(1);
    expect(queryHost).toHaveBeenCalledWith("公告");
    expect(container.textContent).toContain("来自本机数据库");
    expect(container.textContent).toContain("Electron 安全公告");

    // "公告" matches nothing locally, so the host message row is the only row.
    const rows = [...container.querySelectorAll("button[role='option']")];
    expect(rows).toHaveLength(1);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(selected.map((item) => item.id)).toEqual(["host-message-1"]);
  });

  it("navigates the combined local+host list as one keyboard sequence", async () => {
    const hostHit: SearchItem = {
      id: "host-message-1",
      kind: "message",
      title: "research-bot",
      subtitle: "…Electron 安全公告…",
      botId: "22222222-2222-4222-8222-222222222222",
    };
    const queryHost = vi.fn(() => Promise.resolve([hostHit]));
    const selected: SearchItem[] = [];
    const { container, input } = renderOverlay({ queryHost, onSelect: (item) => selected.push(item) });

    // "note" matches the local bot row, and the host row renders unfiltered.
    typeQuery(input, "note");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flushMicrotasks();
    const rows = [...container.querySelectorAll("button[role='option']")];
    expect(rows).toHaveLength(2);
    // Two separate act blocks: the first lets the ArrowDown update commit so
    // Enter reads the moved selection instead of the pre-move props.
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(selected.map((item) => item.id)).toEqual(["host-message-1"]);
  });

  it("debounces: typing in bursts fires one query for the last value", async () => {
    const queryHost = vi.fn(() => Promise.resolve([]));
    const { input } = renderOverlay({ queryHost });

    typeQuery(input, "检");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    typeQuery(input, "检索");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(queryHost).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flushMicrotasks();
    expect(queryHost).toHaveBeenCalledTimes(1);
    expect(queryHost).toHaveBeenCalledWith("检索");
  });

  it("does not query for an empty trimmed input", async () => {
    const queryHost = vi.fn(() => Promise.resolve([]));
    const { input } = renderOverlay({ queryHost });
    typeQuery(input, "   ");
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flushMicrotasks();
    expect(queryHost).not.toHaveBeenCalled();
  });

  it("drops a stale response and keeps the newest results", async () => {
    const pending = new Map<number, (items: SearchItem[]) => void>();
    let call = 0;
    const queryHost = (_query: string) =>
      new Promise<SearchItem[]>((resolve) => {
        call += 1;
        pending.set(call, resolve);
      });
    const { container, input } = renderOverlay({ queryHost });

    typeQuery(input, "第一条");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    typeQuery(input, "第二条更完整");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(call).toBe(2);

    // The newer request resolves first, then the stale one arrives late.
    pending.get(2)?.([
      { id: "host-message-new", kind: "message", title: "new-hit", botId: "22222222-2222-4222-8222-222222222222" },
    ]);
    await flushMicrotasks();
    pending.get(1)?.([
      { id: "host-message-stale", kind: "message", title: "stale-hit", botId: "22222222-2222-4222-8222-222222222222" },
    ]);
    await flushMicrotasks();

    expect(container.textContent).toContain("new-hit");
    expect(container.textContent).not.toContain("stale-hit");
  });

  it("degrades honestly on host failure: local results stay selectable", async () => {
    const queryHost = vi.fn(() => Promise.reject(new Error("host gone")));
    const selected: SearchItem[] = [];
    const { container, input } = renderOverlay({
      queryHost,
      items: [{ id: "bot-1", kind: "bot", title: "note-summarizer", botKey: 1, botId: "11111111-1111-4111-8111-111111111111" }],
      onSelect: (item) => selected.push(item),
    });

    typeQuery(input, "summarizer");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("本机检索不可用");
    const row = container.querySelector("button[role='option']");
    if (row === null) throw new Error("missing local result row");
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(selected.map((item) => item.id)).toEqual(["bot-1"]);
  });

  it("dedupes a host bot hit that repeats the local bot uuid", async () => {
    const queryHost = vi.fn(() =>
      Promise.resolve([
        { id: "host-bot-1", kind: "bot", title: "note-summarizer", botId: "11111111-1111-4111-8111-111111111111" },
        { id: "host-message-9", kind: "message", title: "note-summarizer", subtitle: "历史内容", botId: "11111111-1111-4111-8111-111111111111" },
      ] as SearchItem[]),
    );
    const { container, input } = renderOverlay({ queryHost });

    typeQuery(input, "summarizer");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await flushMicrotasks();

    const rows = [...container.querySelectorAll("button[role='option']")];
    // Local bot row + host message row; the duplicate host bot row is gone.
    expect(rows).toHaveLength(2);
    expect(container.textContent).not.toContain("来自本机数据库\nBot\nnote-summarizer\nnote-summarizer");
    expect(container.textContent).toContain("历史内容");
  });

  it("stays local-only when no host bridge is provided", async () => {
    const { container, input } = renderOverlay({});
    typeQuery(input, "summarizer");
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flushMicrotasks();
    expect(container.textContent).toContain("note-summarizer");
    expect(container.textContent).not.toContain("正在检索本机数据");
    expect(container.textContent).not.toContain("来自本机数据库");
  });
});
