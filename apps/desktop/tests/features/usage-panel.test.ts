// @vitest-environment jsdom
/**
 * The usage page: totals cards, model table, daily trend and share ring, plus
 * the estimate label that keeps a guessed count from looking like billing.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsagePanel } from "../../src/renderer/src/features/usage/usage-panel.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const roots: Root[] = [];

function summary(overrides: Record<string, unknown> = {}) {
  return {
    windowDays: 30,
    totals: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 0, turns: 4, estimated: false },
    byModel: [
      { model: "deepseek-chat", inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0, turns: 3 },
      { model: "deepseek-reasoner", inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, turns: 1 },
    ],
    byDay: [
      { day: "2026-10-26", inputTokens: 700, outputTokens: 100 },
      { day: "2026-10-27", inputTokens: 500, outputTokens: 200 },
    ],
    byBot: [{ botId: null, botName: null, inputTokens: 1200, outputTokens: 300, turns: 4 }],
    ...overrides,
  };
}

function installBridge(payload: unknown, fail = false) {
  const call = vi.fn(async () => {
    if (fail) throw new Error("boom");
    return payload;
  });
  (window as unknown as { deepseekBot: unknown }).deepseekBot = { host: { call } };
  return call;
}

async function mount(botId: string | null): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(UsagePanel, { botId }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

beforeEach(() => {
  document.body.textContent = "";
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (window as unknown as { deepseekBot?: unknown }).deepseekBot;
});

describe("UsagePanel", () => {
  it("asks for the selected bot over 30 days by default", async () => {
    const call = installBridge(summary());
    await mount("bot-1");
    expect(call).toHaveBeenCalledWith("usage.summary", { days: 30, botId: "bot-1" });
  });

  it("shows the four totals and the model table", async () => {
    installBridge(summary());
    const host = await mount("bot-1");
    const cards = [...host.querySelectorAll(".usage-card")];
    expect(cards).toHaveLength(4);
    expect(host.textContent).toContain("deepseek-chat");
    expect(host.textContent).toContain("deepseek-reasoner");
    expect(host.querySelectorAll(".usage-table tbody tr")).toHaveLength(2);
  });

  it("draws both series and the share ring", async () => {
    installBridge(summary());
    const host = await mount("bot-1");
    expect(host.querySelectorAll(".usage-line")).toHaveLength(2);
    expect(host.querySelector(".usage-ring")).not.toBeNull();
    expect(host.querySelector(".usage-trend")).not.toBeNull();
  });

  it("labels an estimate instead of presenting it as billed usage", async () => {
    installBridge(summary({ totals: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, turns: 1, estimated: true } }));
    const host = await mount("bot-1");
    expect(host.querySelector(".usage-note")).not.toBeNull();
    expect(host.textContent).toContain("含估算值");
  });

  it("hides the estimate note when every turn reported usage", async () => {
    installBridge(summary());
    const host = await mount("bot-1");
    expect(host.querySelector(".usage-note")).toBeNull();
  });

  it("explains the empty state instead of drawing an empty chart", async () => {
    installBridge(
      summary({
        totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, turns: 0, estimated: false },
        byModel: [],
        byDay: [],
        byBot: [],
      }),
    );
    const host = await mount("bot-1");
    expect(host.querySelector(".usage-empty")?.textContent).toContain("还没有用量记录");
    expect(host.querySelector(".usage-trend")).toBeNull();
  });

  it("reports a failed read without leaving a stale number on screen", async () => {
    installBridge(null, true);
    const host = await mount("bot-1");
    expect(host.querySelector(".usage-error")).not.toBeNull();
    expect(host.querySelectorAll(".usage-card")).toHaveLength(0);
  });

  it("switches the window and the scope through new requests", async () => {
    const call = installBridge(summary());
    const host = await mount("bot-1");
    const chips = [...host.querySelectorAll<HTMLButtonElement>(".usage-chip")];
    await act(async () => {
      chips.find((chip) => chip.textContent === "7d")?.click();
    });
    expect(call).toHaveBeenLastCalledWith("usage.summary", { days: 7, botId: "bot-1" });

    await act(async () => {
      chips.find((chip) => chip.textContent === "全部 bot")?.click();
    });
    expect(call).toHaveBeenLastCalledWith("usage.summary", { days: 7 });
  });

  it("disables the this-bot scope when no bot is selected", async () => {
    installBridge(summary());
    const host = await mount(null);
    const chips = [...host.querySelectorAll<HTMLButtonElement>(".usage-chip")];
    expect(chips.find((chip) => chip.textContent === "当前 bot")?.disabled).toBe(true);
  });

  it("keeps the chart and share sections on screen when there is no data", async () => {
    installBridge(
      summary({
        totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, turns: 0, estimated: false },
        byModel: [],
        byDay: [],
        byBot: [],
      }),
    );
    const host = await mount("bot-1");
    /* a page whose sections vanish reads as "the feature is missing" */
    expect(host.querySelector(".usage-chart-card")).not.toBeNull();
    expect(host.querySelector(".usage-pie-card")).not.toBeNull();
    expect(host.querySelector(".usage-table-card")).not.toBeNull();
    expect(host.querySelectorAll(".usage-chart-empty").length).toBe(2);
  });

  it("draws a date axis and a grid once there is a series", async () => {
    installBridge(summary());
    const host = await mount("bot-1");
    expect(host.querySelectorAll(".usage-grid").length).toBeGreaterThanOrEqual(4);
    expect(host.querySelectorAll(".usage-axis-label").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector(".usage-legend-list li")).not.toBeNull();
  });
});
