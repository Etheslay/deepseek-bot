// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventRuleSettings,
  newestFirst,
  ruleStateLabel,
} from "../../src/renderer/src/features/event-rules/event-rule-settings.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const BOT_A = "22222222-2222-4222-8222-222222222222";
const BOT_B = "33333333-3333-4333-8333-333333333333";
const BOT_FOREIGN = "12121212-1212-4212-8212-121212121212";
const RULE_ON = "44444444-4444-4444-8444-444444444444";
const RULE_REVIEW = "55555555-5555-4555-8555-555555555555";
const RULE_OFF = "66666666-6666-4666-8666-666666666666";
const WORKFLOW = "88888888-8888-4888-8888-888888888888";
const REVIEW_A = "99999999-9999-4999-8999-999999999999";
const REVIEW_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STATE_OLD = "d1111111-1111-4111-8111-111111111111";
const STATE_MID = "d2222222-2222-4222-8222-222222222222";
const STATE_NEW = "d3333333-3333-4333-8333-333333333333";
const AT_OLD = "2026-10-27T01:00:01.000Z";
const AT_MID = "2026-10-27T01:00:02.000Z";
const AT_NEW = "2026-10-27T01:00:03.000Z";

interface Call {
  method: string;
  payload: unknown;
}

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
  setLanguagePreference("zh");
});

function bot(id: string, name: string, archivedAt: string | null = null) {
  return {
    id,
    name,
    revision: id,
    instructions: "",
    modelProfileId: id,
    workspaceId: id,
    toolPolicyId: id,
    archivedAt,
  };
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ON,
    botId: BOT_A,
    name: "会启动",
    workflowId: WORKFLOW,
    eventType: "run.failed",
    enabled: true,
    review: false,
    at: AT_OLD,
    updatedAt: AT_OLD,
    ...overrides,
  };
}

function reviewItem(overrides: Record<string, unknown> = {}) {
  return {
    id: REVIEW_A,
    ruleId: RULE_REVIEW,
    eventId: EVENT,
    status: "pending",
    at: AT_NEW,
    ...overrides,
  };
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STATE_OLD,
    ruleId: RULE_ON,
    botId: BOT_A,
    state: "enabled",
    at: AT_OLD,
    ...overrides,
  };
}

function decision(status: "approved" | "denied", reviewId: string) {
  return {
    id: reviewId,
    ruleId: RULE_REVIEW,
    eventId: EVENT,
    status,
    runId: status === "approved" ? RUN : null,
    at: AT_NEW,
    decidedAt: AT_NEW,
  };
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

async function renderPanel(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(EventRuleSettings));
  });
  return container;
}

function selectByLabel(container: ParentNode, label: string): HTMLSelectElement {
  const select = container.querySelector(`[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`missing select ${label}`);
  return select;
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function rowButton(row: ParentNode, label: string): HTMLButtonElement {
  const found = [...row.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${label}`);
  return found;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("event rule ordering", () => {
  it("lists equal timestamps in their previous order and newer rows first", () => {
    expect(
      newestFirst([
        { id: "a", at: AT_OLD },
        { id: "c", at: AT_NEW },
        { id: "b", at: AT_MID },
        { id: "c2", at: AT_NEW },
      ]).map((row) => row.id),
    ).toEqual(["c", "c2", "b", "a"]);
  });

  it("names enabled, disabled, and review from the rule flags", () => {
    expect(ruleStateLabel({ enabled: true, review: false })).toBe("已启用");
    expect(ruleStateLabel({ enabled: false, review: false })).toBe("已停用");
    expect(ruleStateLabel({ enabled: true, review: true })).toBe("已启用 · 评审");
    expect(ruleStateLabel({ enabled: false, review: true })).toBe("已停用 · 评审");
  });
});

describe("event rule settings", () => {
  it("shows one bot's rules, pending review, and newest-first history", async () => {
    const calls = install((method) => {
      if (method === "bot.list") {
        return {
          bots: [bot(BOT_A, "Alpha"), bot(BOT_B, "Beta"), bot(BOT_FOREIGN, "Archived", AT_OLD)],
        };
      }
      if (method === "eventRule.list") {
        return {
          rules: [
            rule(),
            rule({
              id: RULE_REVIEW,
              name: "会等待",
              eventType: "run.completed",
              enabled: true,
              review: true,
            }),
            rule({ id: RULE_OFF, name: "已关闭", enabled: false, review: true }),
            rule({ id: BOT_FOREIGN, botId: BOT_FOREIGN, name: "别的 bot" }),
          ],
        };
      }
      if (method === "eventRule.review.list") {
        return { items: [reviewItem(), reviewItem({ id: REVIEW_B, at: AT_MID })] };
      }
      if (method === "eventRule.state.list") {
        return {
          states: [
            stateRow(),
            stateRow({ id: STATE_NEW, ruleId: RULE_REVIEW, state: "review", at: AT_NEW }),
            stateRow({ id: STATE_MID, ruleId: RULE_OFF, state: "disabled", at: AT_MID }),
            stateRow({ id: BOT_FOREIGN, botId: BOT_FOREIGN, ruleId: BOT_FOREIGN, at: AT_NEW }),
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-rule-id]").length).toBe(3);
    });
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).not.toContain("Archived");
    expect(container.textContent).not.toContain("别的 bot");
    expect(calls.filter((call) => call.method === "eventRule.list")).toEqual([
      { method: "eventRule.list", payload: { botId: BOT_A } },
    ]);

    const enabled = container.querySelector(`[data-rule-id="${RULE_ON}"]`);
    const reviewing = container.querySelector(`[data-rule-id="${RULE_REVIEW}"]`);
    const disabled = container.querySelector(`[data-rule-id="${RULE_OFF}"]`);
    expect(enabled?.textContent).toContain("会启动");
    expect(enabled?.textContent).toContain("运行失败时");
    expect(enabled?.textContent).toContain("已启用");
    expect(enabled?.textContent).not.toContain("评审");
    expect(reviewing?.textContent).toContain("已启用 · 评审");
    expect(disabled?.textContent).toContain("已停用 · 评审");

    const reviews = [...container.querySelectorAll("[data-testid='event-rule-reviews'] [data-review-id]")];
    expect(reviews.map((item) => item.getAttribute("data-review-id"))).toEqual([REVIEW_A, REVIEW_B]);
    expect(reviews[0]?.textContent).toContain("会等待");

    const history = [
      ...container.querySelectorAll("[data-testid='event-rule-history'] [data-state]"),
    ];
    expect(history.map((item) => item.getAttribute("data-state"))).toEqual([
      "review",
      "disabled",
      "enabled",
    ]);
    expect(history.map((item) => item.getAttribute("data-at"))).toEqual([AT_NEW, AT_MID, AT_OLD]);
    expect(history[0]?.textContent).toContain("会等待");
    expect(history[0]?.textContent).toContain("评审");
    expect(container.textContent).not.toContain(BOT_FOREIGN);
  });

  it("approves one pending item and denies another", async () => {
    const pending = [reviewItem(), reviewItem({ id: REVIEW_B, at: AT_MID })];
    const calls = install((method, payload) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "eventRule.list") return { rules: [rule({ id: RULE_REVIEW, name: "会等待", review: true })] };
      if (method === "eventRule.review.list") return { items: pending.slice() };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.approve" || method === "eventRule.review.deny") {
        const id = (payload as { id: string }).id;
        const index = pending.findIndex((item) => item.id === id);
        if (index >= 0) pending.splice(index, 1);
        return decision(method === "eventRule.review.approve" ? "approved" : "denied", id);
      }
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.querySelector(`[data-review-id="${REVIEW_A}"]`)).not.toBeNull();
    });
    const first = container.querySelector(`[data-review-id="${REVIEW_A}"]`);
    if (!(first instanceof HTMLElement)) throw new Error("missing first review");
    await click(rowButton(first, "批准"));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("已批准，并启动一次运行");
    });
    expect(calls).toContainEqual({
      method: "eventRule.review.approve",
      payload: { botId: BOT_A, id: REVIEW_A },
    });
    expect(calls.some((call) => call.method === "eventRule.review.deny")).toBe(false);
    expect(container.querySelector(`[data-review-id="${REVIEW_A}"]`)).toBeNull();
    expect(container.querySelector(`[data-review-id="${REVIEW_B}"]`)).not.toBeNull();

    const second = container.querySelector(`[data-review-id="${REVIEW_B}"]`);
    if (!(second instanceof HTMLElement)) throw new Error("missing second review");
    await click(rowButton(second, "拒绝"));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("已拒绝，并记下一次跳过");
    });
    expect(calls).toContainEqual({
      method: "eventRule.review.deny",
      payload: { botId: BOT_A, id: REVIEW_B },
    });
    expect(container.querySelector("[data-review-id]")).toBeNull();
    expect(container.textContent).toContain("没有待评审项");
    expect(container.textContent).not.toContain(RUN);
  });

  it("does not send a second decision while the first is still running", async () => {
    const gate = deferred<unknown>();
    const calls = install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "eventRule.list") return { rules: [rule({ id: RULE_REVIEW, name: "会等待", review: true })] };
      if (method === "eventRule.review.list") return { items: [reviewItem(), reviewItem({ id: REVIEW_B })] };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.approve") return gate.promise;
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.querySelector(`[data-review-id="${REVIEW_A}"]`)).not.toBeNull();
    });
    const approve = container.querySelector(`[data-review-id="${REVIEW_A}"] button`);
    const deny = container.querySelector(`[data-review-id="${REVIEW_B}"] button:last-child`);
    if (!(approve instanceof HTMLButtonElement) || !(deny instanceof HTMLButtonElement)) {
      throw new Error("missing decision buttons");
    }
    await click(approve);
    await click(deny);
    expect(calls.filter((call) => call.method === "eventRule.review.approve")).toHaveLength(1);
    expect(calls.some((call) => call.method === "eventRule.review.deny")).toBe(false);
    await act(async () => {
      gate.resolve(decision("approved", REVIEW_A));
    });
  });

  it("keeps the host error text out of the page", async () => {
    install((method) => {
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha")] };
      if (method === "eventRule.list") return { rules: [rule({ id: RULE_REVIEW, review: true, name: "会等待" })] };
      if (method === "eventRule.review.list") return { items: [reviewItem()] };
      if (method === "eventRule.state.list") return { states: [] };
      if (method === "eventRule.review.approve") throw new Error("secret-run-id");
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.querySelector(`[data-review-id="${REVIEW_A}"]`)).not.toBeNull();
    });
    const approve = container.querySelector(`[data-review-id="${REVIEW_A}"] button`);
    if (!(approve instanceof HTMLButtonElement)) throw new Error("missing approve");
    await click(approve);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("评审操作失败");
    });
    expect(container.textContent).not.toContain("secret-run-id");
    expect(container.textContent).not.toContain("已批准");
  });

  it("drops a late response after the selected bot changes", async () => {
    const late = deferred<unknown>();
    install((method, payload) => {
      const body = payload as { botId?: string };
      if (method === "bot.list") return { bots: [bot(BOT_A, "Alpha"), bot(BOT_B, "Beta")] };
      if (body.botId === BOT_A && method === "eventRule.list") return late.promise;
      if (body.botId === BOT_A) {
        if (method === "eventRule.review.list") return { items: [] };
        if (method === "eventRule.state.list") return { states: [] };
      }
      if (body.botId === BOT_B && method === "eventRule.list") {
        return { rules: [rule({ botId: BOT_B, name: "Beta 规则" })] };
      }
      if (body.botId === BOT_B && method === "eventRule.review.list") return { items: [] };
      if (body.botId === BOT_B && method === "eventRule.state.list") return { states: [] };
      throw new Error(`unexpected ${method}`);
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(selectByLabel(container, "机器人").disabled).toBe(false);
    });
    await choose(selectByLabel(container, "机器人"), BOT_B);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Beta 规则");
    });
    await act(async () => {
      late.resolve({ rules: [rule({ name: "只有 Alpha" })] });
    });
    expect(container.textContent).not.toContain("只有 Alpha");
    expect(container.textContent).toContain("Beta 规则");
  });

  it("shows an empty bot and a catalogue load failure", async () => {
    install((method) => {
      if (method === "bot.list") return { bots: [] };
      throw new Error("secret-host");
    });
    const empty = await renderPanel();
    await vi.waitFor(() => {
      expect(empty.textContent).toContain("还没有可选择的 bot");
    });
    expect(empty.textContent).not.toContain("secret-host");

    install(() => {
      throw new Error("secret-host");
    });
    const failed = await renderPanel();
    await vi.waitFor(() => {
      expect(failed.textContent).toContain("事件规则读取失败");
    });
    expect(failed.textContent).not.toContain("secret-host");
    await act(async () => {
      setLanguagePreference("en");
    });
    expect(failed.textContent).toContain("Failed to load event rules");
    expect(failed.textContent).not.toContain("事件规则读取失败");
  });
});
