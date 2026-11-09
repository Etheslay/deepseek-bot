// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsPanel } from "../../src/renderer/src/features/permissions/permissions-panel.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const POLICIES = [
  { capability: "app.create_group", mode: "allow" },
  { capability: "app.start_run", mode: "allow" },
  { capability: "fs.read", mode: "allow" },
  { capability: "exec.shell", mode: "ask" },
  { capability: "connector.invoke", mode: "ask" },
  { capability: "mcp.call", mode: "ask" },
  { capability: "app.dispatch_task", mode: "allow" },
  { capability: "screen.capture", mode: "deny" },
  { capability: "device.action", mode: "deny" },
];

const GRANT = {
  id: "11111111-1111-4111-8111-111111111111",
  capability: "app.create_bot",
  botId: "22222222-2222-4222-8222-222222222222",
  mode: "allow",
  scope: "session",
  sessionId: "session-1",
  generation: 3,
  approvalId: null,
  maxUses: 5,
  uses: 1,
  expiresAt: "2026-10-26T08:00:00.000Z",
  createdAt: "2026-10-26T06:00:00.000Z",
  revokedAt: null,
};

const POLICY_ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  capability: "app.read",
  botId: null,
  mode: "allow",
  scope: "policy",
  sessionId: null,
  generation: null,
  approvalId: null,
  maxUses: null,
  uses: 0,
  expiresAt: null,
  createdAt: "2026-10-26T06:00:00.000Z",
  revokedAt: null,
};

interface Call {
  method: string;
  payload: unknown;
}

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

function installHost(responder?: (method: string, payload: unknown) => unknown): Call[] {
  const calls: Call[] = [];
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        const overridden = responder?.(method, payload);
        if (overridden !== undefined) return overridden;
        if (method === "permission.policy.list") return { policies: POLICIES };
        if (method === "permission.grant.list") return { grants: [POLICY_ROW, GRANT] };
        if (method === "permission.policy.set") return payload;
        if (method === "permission.grant.revoke") {
          return { grant: { ...GRANT, revokedAt: "2026-10-26T09:00:00.000Z" } };
        }
        throw new Error(`unexpected method ${method}`);
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
    root.render(createElement(PermissionsPanel));
  });
  return container;
}

/** The policy control is a CustomSelect trigger (a button), not a native select. */
function controlByLabel(container: ParentNode, capability: string): HTMLButtonElement {
  const trigger = container.querySelector(`button[aria-label="${capability} 策略"]`);
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error(`missing policy control for ${capability}`);
  }
  return trigger;
}

const MODE_LABELS: Record<string, string> = {
  allow: "始终允许",
  ask: "每次询问",
  deny: "从不允许",
};

function modeOfLabel(label: string): string {
  const entry = Object.entries(MODE_LABELS).find(([, text]) => text === label);
  return entry ? entry[0] : label;
}

function menuOf(): HTMLElement | null {
  // The menu is portaled to document.body (viewport-flip fix); only one
  // select menu is open at a time, so a document-level lookup is unambiguous.
  return document.querySelector<HTMLElement>(".custom-select-menu");
}

async function openMenu(trigger: HTMLButtonElement): Promise<HTMLElement> {
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const menu = menuOf();
  if (menu === null) {
    throw new Error("the policy dropdown did not open");
  }
  return menu;
}

/** The mode the closed control currently displays. */
function shownMode(trigger: HTMLButtonElement): string {
  const label = (trigger.textContent ?? "").replace("▾", "").trim();
  return modeOfLabel(label);
}

async function choose(container: ParentNode, capability: string, mode: string): Promise<void> {
  const trigger = controlByLabel(container, capability);
  const menu = await openMenu(trigger);
  const option = [...menu.querySelectorAll<HTMLButtonElement>(".custom-select-item")].find(
    (item) => (item.textContent ?? "").replace("✓", "").trim() === MODE_LABELS[mode],
  );
  if (option === undefined) {
    throw new Error(`no option for ${mode} on ${capability}`);
  }
  await act(async () => {
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The mode ids the control offers, read from its open menu. */
async function optionIds(container: ParentNode, capability: string): Promise<string[]> {
  const trigger = controlByLabel(container, capability);
  const menu = await openMenu(trigger);
  const ids = [...menu.querySelectorAll<HTMLElement>(".custom-select-item")].map((item) =>
    modeOfLabel((item.textContent ?? "").replace("✓", "").trim()),
  );
  // Close it again so later assertions read the trigger, not an open list.
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return ids;
}

describe("permissions settings panel", () => {
  it("loads policies and issued grants through permission.*", async () => {
    const calls = installHost();
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(shownMode(controlByLabel(container, "app.dispatch_task"))).toBe("allow");
    });
    expect(calls.map((call) => call.method)).toEqual([
      "permission.policy.list",
      "permission.grant.list",
    ]);
    expect(calls[0]?.payload).toEqual({});
    expect(calls[1]?.payload).toEqual({});
    expect(container.textContent).toContain("机器人之间发消息默认直接进行");
    expect(shownMode(controlByLabel(container, "exec.shell"))).toBe("ask");
    expect(shownMode(controlByLabel(container, "connector.invoke"))).toBe("ask");
    expect(shownMode(controlByLabel(container, "mcp.call"))).toBe("ask");
    expect(() => controlByLabel(container, "app.create_group")).toThrow(/missing policy control/);
    expect(() => controlByLabel(container, "app.start_run")).toThrow(/missing policy control/);
    expect(() => controlByLabel(container, "fs.read")).toThrow(/missing policy control/);
    expect(container.textContent).toContain("本会话");
    expect(container.textContent).toContain("1/5");
    expect(container.textContent).not.toContain("app.read");
    // One issued grant, so exactly one revoke action — the dropdown triggers are
    // buttons too now, so count by what they do rather than by tag.
    expect(
      [...container.querySelectorAll("button")].filter((b) => b.textContent?.includes("撤销")),
    ).toHaveLength(1);
  });

  it("offers always-allow for dispatch and keeps device and screen on ask or off", async () => {
    const calls = installHost();
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(shownMode(controlByLabel(container, "device.action"))).toBe("deny");
    });
    expect(await optionIds(container, "app.dispatch_task")).toEqual(["allow", "ask", "deny"]);
    expect(await optionIds(container, "exec.shell")).toEqual(["allow", "ask", "deny"]);
    expect(await optionIds(container, "screen.capture")).toEqual(["ask", "deny"]);
    expect(await optionIds(container, "device.action")).toEqual(["ask", "deny"]);

    await choose(container, "app.dispatch_task", "allow");
    await choose(container, "device.action", "ask");
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.policy.set",
        payload: { capability: "app.dispatch_task", mode: "allow" },
      });
      expect(calls).toContainEqual({
        method: "permission.policy.set",
        payload: { capability: "device.action", mode: "ask" },
      });
    });
    expect(calls.some((call) => call.method === "policy.set")).toBe(false);
  });

  it("revokes an issued grant by grantId", async () => {
    const calls = installHost();
    const container = await renderPanel();
    // The revoke button is no longer the first button in the panel: each policy
    // row now renders a dropdown trigger, so find it by what it does.
    const revokeButton = (): HTMLButtonElement | undefined =>
      [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("撤销"));
    await vi.waitFor(() => {
      expect(revokeButton()?.textContent).toBe("撤销");
    });
    await act(async () => {
      revokeButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.grant.revoke",
        payload: { grantId: GRANT.id },
      });
    });
    expect(calls.some((call) => call.method === "grant.revoke")).toBe(false);
  });

  it("shows a readable error when the permission backend cannot be read", async () => {
    installHost(() => {
      throw new Error("host down");
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("权限数据读取失败");
    });
  });

  it("re-translates a stored notice after the interface language changes (D22)", async () => {
    installHost(() => {
      throw new Error("host down");
    });
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("权限数据读取失败");
    });
    // The notice is kept as a factory, so switching language re-renders it —
    // a rendered string in state would have stayed Chinese.
    setLanguagePreference("en");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Failed to load permission data");
    });
    expect(container.textContent).not.toContain("权限数据读取失败");
    setLanguagePreference("zh");
  });
});
