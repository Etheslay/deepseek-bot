// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsPanel } from "../../src/renderer/src/features/permissions/permissions-panel.js";

const POLICIES = [
  { capability: "app.create_group", mode: "ask" },
  { capability: "app.start_run", mode: "ask" },
  { capability: "exec.shell", mode: "ask" },
  { capability: "screen.capture", mode: "deny" },
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

function selectByLabel(container: ParentNode, capability: string): HTMLSelectElement {
  const select = container.querySelector(`[aria-label="${capability} 策略"]`);
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`missing select for ${capability}`);
  }
  return select;
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("permissions settings panel", () => {
  it("loads policies and issued grants through permission.*", async () => {
    const calls = installHost();
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(selectByLabel(container, "app.create_group").value).toBe("ask");
    });
    expect(calls.map((call) => call.method)).toEqual([
      "permission.policy.list",
      "permission.grant.list",
    ]);
    expect(calls[0]?.payload).toEqual({});
    expect(calls[1]?.payload).toEqual({});
    expect(container.textContent).toContain("本会话");
    expect(container.textContent).toContain("1/5");
    expect(container.textContent).not.toContain("app.read");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("keeps fixed capabilities constrained and saves allow/ask/deny modes", async () => {
    const calls = installHost();
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(selectByLabel(container, "app.start_run").disabled).toBe(true);
    });
    expect(
      [...selectByLabel(container, "screen.capture").options].map((option) => option.value),
    ).toEqual(["ask", "deny"]);
    expect(
      [...selectByLabel(container, "exec.shell").options].map((option) => option.value),
    ).toEqual(["ask", "deny"]);
    expect(
      [...selectByLabel(container, "app.create_group").options].map((option) => option.value),
    ).toEqual(["allow", "ask", "deny"]);

    await choose(selectByLabel(container, "app.create_group"), "allow");
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.policy.set",
        payload: { capability: "app.create_group", mode: "allow" },
      });
    });
    expect(calls.some((call) => call.method === "policy.set")).toBe(false);
  });

  it("revokes an issued grant by grantId", async () => {
    const calls = installHost();
    const container = await renderPanel();
    await vi.waitFor(() => {
      expect(container.querySelector("button")?.textContent).toBe("撤销");
    });
    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
});
