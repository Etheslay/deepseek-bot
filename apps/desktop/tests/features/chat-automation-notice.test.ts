// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatAutomationNotice,
  noticeReasonText,
} from "../../src/renderer/src/features/automation/chat-automation-notice.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const BOT_A = "22222222-2222-4222-8222-222222222222";
const BOT_B = "33333333-3333-4333-8333-333333333333";
const RULE_A = "44444444-4444-4444-8444-444444444444";
const RULE_B = "45454545-4545-4545-8545-454545454545";
const REVIEW = "99999999-9999-4999-8999-999999999999";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECORD_1 = "d1111111-1111-4111-8111-111111111111";
const RECORD_2 = "d2222222-2222-4222-8222-222222222222";
const RECORD_3 = "d3333333-3333-4333-8333-333333333333";
const STATE_1 = "e1111111-1111-4111-8111-111111111111";
const AT_OLD = "2026-10-28T01:00:01.000Z";
const AT_NEW = "2026-10-28T02:00:03.000Z";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  delete (window as unknown as { deepseekBot?: unknown }).deepseekBot;
  setLanguagePreference("zh");
});

function rule(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    botId: id === RULE_B ? BOT_B : BOT_A,
    name,
    workflowId: id,
    eventType: "run.failed",
    enabled: true,
    review: false,
    at: AT_OLD,
    updatedAt: AT_OLD,
    ...overrides,
  };
}

function skippedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_1,
    ruleId: RULE_A,
    eventId: EVENT,
    outcome: "skipped",
    runId: null,
    reason: "rule disabled",
    at: AT_OLD,
    ...overrides,
  };
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STATE_1,
    ruleId: RULE_A,
    botId: BOT_A,
    state: "enabled",
    at: AT_NEW,
    ...overrides,
  };
}

function reviewItem(overrides: Record<string, unknown> = {}) {
  return {
    id: REVIEW,
    ruleId: RULE_A,
    eventId: EVENT,
    status: "pending",
    at: AT_NEW,
    ...overrides,
  };
}

interface Call {
  method: string;
  payload: unknown;
}

function install(handler: (method: string, payload: unknown) => unknown): Call[] {
  const calls: Call[] = [];
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        return handler(method, payload);
      },
    },
  } as unknown as Window["deepseekBot"];
  return calls;
}

let opened = 0;

async function renderNotice(botId: string = BOT_A): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(ChatAutomationNotice, {
        botId,
        onOpenAutomation: () => {
          opened += 1;
        },
      }),
    );
  });
  return container;
}

async function rerender(container: HTMLDivElement, botId: string): Promise<void> {
  const root = roots[roots.length - 1];
  if (root === undefined) throw new Error("no root");
  await act(async () => {
    root.render(
      createElement(ChatAutomationNotice, {
        botId,
        onOpenAutomation: () => {
          opened += 1;
        },
      }),
    );
  });
}

function toggleButton(container: ParentNode): HTMLButtonElement {
  const toggle = container.querySelector(".automation-notice-toggle");
  if (!(toggle instanceof HTMLButtonElement)) throw new Error("missing notice toggle");
  return toggle;
}

async function expand(container: HTMLDivElement): Promise<void> {
  await act(async () => {
    toggleButton(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("chat automation notice reason mapping", () => {
  it("maps stable host reasons and keeps unknown ones verbatim", () => {
    expect(noticeReasonText("rule disabled")).toBe("规则已停用");
    expect(noticeReasonText("review denied")).toBe("评审已拒绝");
    expect(noticeReasonText("duplicate event")).toBe("重复事件");
    expect(noticeReasonText("source run was started by an event rule")).toBe(
      "来源运行由事件规则启动",
    );
    expect(noticeReasonText("event rule trigger failed: boom")).toBe("触发失败：boom");
    expect(noticeReasonText("mystery reason")).toBe("mystery reason");
  });
});

describe("chat automation notice", () => {
  it("renders nothing for a bot without rules", async () => {
    install((method) => {
      if (method === "eventRule.list") return { rules: [] };
      if (method === "eventRule.record.list") return { records: [] };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.list") return { items: [] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    expect(container.querySelector("[data-testid='chat-automation-notice']")).toBeNull();
  });

  it("shows missed triggers, state changes and pending review after expanding", async () => {
    install((method) => {
      if (method === "eventRule.list") {
        return { rules: [rule(RULE_A, "会启动")] };
      }
      if (method === "eventRule.record.list") {
        return {
          records: [
            skippedRecord({ id: RECORD_1 }),
            skippedRecord({
              id: RECORD_2,
              outcome: "duplicate",
              reason: "duplicate event",
              at: AT_NEW,
            }),
            skippedRecord({ id: RECORD_3, outcome: "started", reason: "matching local event" }),
          ],
        };
      }
      if (method === "eventRule.state.list") {
        return { states: [stateRow()] };
      }
      if (method === "eventRule.review.list") {
        return { items: [reviewItem()] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    const bar = await vi.waitFor(() => {
      const found = container.querySelector("[data-testid='chat-automation-notice']");
      if (!(found instanceof HTMLElement)) throw new Error("notice not rendered");
      return found;
    });
    expect(bar.textContent).toContain("错过 2");
    expect(bar.textContent).toContain("待评审 1");
    expect(bar.textContent).toContain("状态变更 1");
    expect(bar.querySelector(".automation-notice-body")).toBeNull();

    await expand(container);
    const body = bar.querySelector(".automation-notice-body");
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain("1 条匹配事件待评审");
    expect(body?.textContent).toContain("会启动 → 已启用");
    expect(body?.textContent).toContain("已跳过 · 会启动 · 规则已停用");
    expect(body?.textContent).toContain("重复已去重 · 会启动 · 重复事件");
    expect(body?.textContent).not.toContain("matching local event");
    expect(bar.querySelectorAll("[data-outcome]")).toHaveLength(2);
    expect(toggleButton(container).getAttribute("aria-expanded")).toBe("true");
  });

  it("maps the trigger-failed prefix and keeps an unknown reason verbatim", async () => {
    install((method) => {
      if (method === "eventRule.list") return { rules: [rule(RULE_A, "会启动")] };
      if (method === "eventRule.record.list") {
        return {
          records: [
            skippedRecord({ id: RECORD_1, reason: "event rule trigger failed: boom" }),
            skippedRecord({
              id: RECORD_2,
              outcome: "duplicate",
              reason: "mystery reason",
              at: AT_NEW,
            }),
          ],
        };
      }
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.list") return { items: [] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='chat-automation-notice']")).not.toBeNull();
    });
    await expand(container);
    const body = container.querySelector(".automation-notice-body");
    expect(body?.textContent).toContain("触发失败：boom");
    expect(body?.textContent).toContain("mystery reason");
  });

  it("jumps to settings from the pending review row", async () => {
    opened = 0;
    install((method) => {
      if (method === "eventRule.list") return { rules: [rule(RULE_A, "会启动")] };
      if (method === "eventRule.record.list") return { records: [] };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.list") return { items: [reviewItem()] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    await vi.waitFor(() => {
      expect(container.querySelector(".automation-notice-toggle")).not.toBeNull();
    });
    await expand(container);
    const jump = container.querySelector("button.automation-notice-jump");
    if (!(jump instanceof HTMLButtonElement)) throw new Error("missing jump button");
    await act(async () => {
      jump.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(opened).toBe(1);
  });

  it("only ever calls the four trusted read methods", async () => {
    const calls = install((method) => {
      if (method === "eventRule.list") return { rules: [rule(RULE_A, "会启动")] };
      if (method === "eventRule.record.list") return { records: [skippedRecord()] };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.list") return { items: [] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='chat-automation-notice']")).not.toBeNull();
    });
    const methods = new Set(calls.map((call) => call.method));
    expect([...methods].sort()).toEqual([
      "eventRule.list",
      "eventRule.record.list",
      "eventRule.review.list",
      "eventRule.state.list",
    ]);
  });

  it("stays hidden when loading fails without data", async () => {
    install(() => {
      throw new Error("host unavailable");
    });
    const container = await renderNotice();
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='chat-automation-notice']")).toBeNull();
  });

  it("keeps the last good data when a later load for another bot fails", async () => {
    install((method, payload) => {
      const body = payload as { botId?: string };
      if (body.botId === BOT_B) throw new Error("later failure");
      if (method === "eventRule.list") return { rules: [rule(RULE_A, "会启动")] };
      if (method === "eventRule.record.list") return { records: [skippedRecord()] };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.list") return { items: [] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='chat-automation-notice']")).not.toBeNull();
    });
    await rerender(container, BOT_B);
    expect(container.querySelector("[data-testid='chat-automation-notice']")).not.toBeNull();
    // The collapsed summary still reflects the last good snapshot (错过 1);
    // rule names live in the body, so the summary text is the stale marker.
    expect(container.textContent).toContain("错过 1");
  });

  it("drops a late response after the bot changes", async () => {
    let resolveLate: (value: unknown) => void = () => undefined;
    const late = new Promise<unknown>((resolve) => {
      resolveLate = resolve;
    });
    install((method, payload) => {
      const body = payload as { botId?: string };
      if (body.botId === BOT_A && method === "eventRule.list") return late;
      if (body.botId === BOT_A) {
        if (method === "eventRule.record.list") return { records: [] };
        if (method === "eventRule.state.list") return { states: [] };
        if (method === "eventRule.review.list") return { items: [] };
      }
      if (body.botId === BOT_B && method === "eventRule.list") {
        return { rules: [rule(RULE_B, "Beta 规则")] };
      }
      if (body.botId === BOT_B) {
        if (method === "eventRule.record.list") {
          return { records: [skippedRecord({ id: RECORD_1, ruleId: RULE_B, reason: "review denied" })] };
        }
        if (method === "eventRule.state.list") return { states: [] };
        if (method === "eventRule.review.list") return { items: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderNotice();
    expect(container.querySelector("[data-testid='chat-automation-notice']")).toBeNull();
    await rerender(container, BOT_B);
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='chat-automation-notice']")).not.toBeNull();
    });
    expect(container.textContent).toContain("错过 1");
    await act(async () => {
      resolveLate({ rules: [rule(RULE_A, "迟到的 Alpha 规则")] });
    });
    expect(container.textContent).not.toContain("迟到的 Alpha 规则");
    // The BOT_B snapshot (错过 1) survives the late BOT_A response.
    expect(container.textContent).toContain("错过 1");
  });
});
