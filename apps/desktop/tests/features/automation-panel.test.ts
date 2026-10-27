// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutomationPanel } from "../../src/renderer/src/features/automation/automation-panel.js";

const RULE = "55555555-5555-4555-8555-555555555555";
const WORKFLOW = "66666666-6666-4666-8666-666666666666";
const FIRING = "77777777-7777-4777-8777-777777777777";

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
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const LOADS = {
  "workflow.list": { workflows: [{ id: WORKFLOW, name: "修复流程", revision: "12121212-1212-4212-8212-121212121212" }] },
  "trigger.list": {
    rules: [
      {
        id: RULE,
        name: "失败即修复",
        workflowId: WORKFLOW,
        eventType: "run.failed",
        filterWorkflowId: null,
        enabled: false,
        at: "2026-10-27T00:00:00.000Z",
        updatedAt: "2026-10-27T00:00:00.000Z",
      },
    ],
  },
  "trigger.firing.list": {
    firings: [
      {
        id: FIRING,
        ruleId: RULE,
        ruleName: "失败即修复",
        workflowId: WORKFLOW,
        eventType: "run.failed",
        sourceRunId: null,
        reason: "missed",
        status: "pending",
        at: "2026-10-27T00:00:00.000Z",
        decidedAt: null,
      },
    ],
  },
};

describe("automation panel", () => {
  it("lists rules and the review queue, saves a rule and decides a firing", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method in LOADS) return LOADS[method as keyof typeof LOADS];
          if (method === "trigger.save") {
            return {
              id: RULE,
              name: (payload as { rule: { name: string } }).rule.name,
              workflowId: WORKFLOW,
              eventType: "run.failed",
              filterWorkflowId: null,
              enabled: false,
              at: "2026-10-27T00:01:00.000Z",
              updatedAt: "2026-10-27T00:01:00.000Z",
            };
          }
          if (method === "trigger.firing.decide") {
            const body = payload as { decision: string };
            return {
              firing: { id: FIRING, status: body.decision === "start" ? "approved" : "dismissed", decidedAt: "2026-10-27T00:02:00.000Z" },
              runId: body.decision === "start" ? "88888888-8888-4888-8888-888888888888" : null,
            };
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
      root.render(createElement(AutomationPanel));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toContainEqual({ method: "trigger.list", payload: {} });
    // Wait for the async load to finish re-rendering before interacting —
    // otherwise the later render resets the values typed into the form.
    await act(async () => {
      for (let i = 0; i < 100 && !container.textContent.includes("错过补记"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    expect(container.textContent).toContain("失败即修复");
    expect(container.textContent).toContain("错过补记");
    expect(container.textContent).toContain("评审队列");

    // Save a rule through the form.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const nameInput = container.querySelector('input[aria-label="规则名称"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error("missing rule name");
    await act(async () => {
      setValue?.call(nameInput, "完成即通知");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The workflow picker is the app's own dropdown now; open it and pick by value.
    const workflowSelect = container.querySelector('button[aria-label="目标工作流"]');
    if (!(workflowSelect instanceof HTMLButtonElement)) throw new Error("missing workflow select");
    await act(async () => {
      workflowSelect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const workflowOption = workflowSelect
      .closest(".custom-select")
      ?.querySelector<HTMLButtonElement>(`.custom-select-item[data-value="${WORKFLOW}"]`);
    if (!(workflowOption instanceof HTMLButtonElement)) throw new Error("missing workflow option");
    await act(async () => {
      workflowOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(nameInput.value).toBe("完成即通知");
    expect(container.textContent).toContain("修复流程");
    expect(workflowSelect.dataset.value).toBe(WORKFLOW);
    await act(async () => {
      click(container, "保存规则");
    });
    expect(calls.map((call) => [call.method, JSON.stringify(call.payload)])).toContainEqual([
      "trigger.save",
      JSON.stringify({ rule: { name: "完成即通知", workflowId: WORKFLOW, eventType: "run.failed" } }),
    ]);
    expect(container.textContent).toContain("已保存规则（默认关闭）");

    // Approve the pending firing.
    await act(async () => {
      click(container, "启动");
    });
    expect(calls).toContainEqual({
      method: "trigger.firing.decide",
      payload: { firingId: FIRING, decision: "start" },
    });
    expect(container.textContent).toContain("已批准并启动工作流");
  });
});
