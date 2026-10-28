// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionChatCards } from "../../src/renderer/src/features/permissions/permission-chat.js";

const BOT = "22222222-2222-4222-8222-222222222222";

const APPROVAL = {
  id: "11111111-1111-4111-8111-111111111111",
  invocationId: "44444444-4444-4444-8444-444444444444",
  callerId: "caller",
  botId: BOT,
  sessionId: "session-1",
  tool: "create_bots_batch",
  capabilities: ["app.create_group", "app.create_bot"],
  params: { name: "research" },
  actionDigest: "a".repeat(64),
  generation: 2,
  status: "pending",
  createdAt: "2026-10-26T06:00:00.000Z",
  expiresAt: "2026-10-26T06:10:00.000Z",
  decidedAt: null,
};

const SHELL = {
  ...APPROVAL,
  id: "55555555-5555-4555-8555-555555555555",
  tool: "shell",
  capabilities: ["exec.shell"],
  sessionId: "session-1",
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

function installHost(approvals: unknown[]): Call[] {
  const calls: Call[] = [];
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        if (method === "permission.approval.list") return { approvals };
        if (method === "permission.approval.decide") {
          return {
            approval: { ...APPROVAL, status: "consumed", decidedAt: "2026-10-26T06:01:00.000Z" },
            grants: [],
          };
        }
        throw new Error(`unexpected method ${method}`);
      },
    },
  } as unknown as Window["deepseekBot"];
  return calls;
}

async function renderCards(botId = BOT): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(PermissionChatCards, { botId }));
  });
  return container;
}

function labels(container: ParentNode): string[] {
  return [...container.querySelectorAll('[role="group"] button')].map(
    (button) => button.textContent ?? "",
  );
}

describe("chat permission cards", () => {
  it("renders nothing without pending approvals and never polls grants or policies", async () => {
    const calls = installHost([]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(calls.every((call) => call.method === "permission.approval.list")).toBe(true);
    expect(container.querySelector(".permission-chat-grant")).toBeNull();
    expect(container.textContent).not.toContain("给这个 bot 授予一项能力");
  });

  it("previews the MCP service, tool and exact arguments with only single-use approval", async () => {
    const params = {
      definitionId: "internal-definition",
      connectorId: "internal-connector",
      connectorName: "Local Echo",
      endpoint: "http://127.0.0.1:8080/mcp",
      toolName: "echo",
      arguments: { text: "<private>" },
    };
    installHost([{ ...APPROVAL, tool: "mcp_call", capabilities: ["mcp.call"], params }]);
    const container = await renderCards();
    const preview = JSON.parse(container.querySelector("pre")!.textContent!) as Record<
      string,
      unknown
    >;
    expect(preview).toEqual({
      connectorName: params.connectorName,
      endpoint: params.endpoint,
      toolName: params.toolName,
      arguments: params.arguments,
    });
    expect(labels(container)).toEqual(["仅本次", "拒绝"]);
    expect(container.querySelector("private")).toBeNull();
  });
  it("shows the exact validated parameters as escaped text before a decision", async () => {
    installHost([
      {
        ...APPROVAL,
        params: { name: "<img src=x onerror=alert(1)>", bots: [{ name: "research" }] },
      },
    ]);
    const container = await renderCards();
    const preview = container.querySelector("pre");
    expect(preview?.textContent).toBe(
      JSON.stringify(
        { name: "<img src=x onerror=alert(1)>", bots: [{ name: "research" }] },
        null,
        2,
      ),
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("ignores a previous bot's late approval response after switching chats", async () => {
    let resolvePrevious!: (value: unknown) => void;
    const previous = new Promise<unknown>((resolve) => {
      resolvePrevious = resolve;
    });
    const otherBot = "33333333-3333-4333-8333-333333333333";
    const otherApproval = {
      ...APPROVAL,
      botId: otherBot,
      tool: "create_group",
      params: { name: "other" },
    };
    window.deepseekBot = {
      host: {
        call: async (_method: string, payload: { botId: string }) =>
          payload.botId === BOT ? previous : { approvals: [otherApproval] },
      },
    } as unknown as Window["deepseekBot"];
    const container = await renderCards();
    await act(async () => {
      roots.at(-1)!.render(createElement(PermissionChatCards, { botId: otherBot }));
    });
    expect(container.textContent).toContain("create_group");
    await act(async () => {
      resolvePrevious({ approvals: [APPROVAL] });
    });
    expect(container.textContent).not.toContain("create_bots_batch");
    expect(container.textContent).toContain("create_group");
  });

  it("lists pending approvals for the open bot and offers once, session, and permanent", async () => {
    const calls = installHost([APPROVAL]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("创建分组");
    });
    expect(calls[0]).toEqual({ method: "permission.approval.list", payload: { botId: BOT } });
    expect(container.textContent).toContain("创建 bot");
    expect(container.textContent).toContain("create_bots_batch");
    expect(container.textContent).toContain("5 次");
    expect(container.textContent).toContain("2 小时");
    expect(labels(container)).toEqual(["仅本次", "本会话", "永久允许", "拒绝"]);
    expect(
      calls.some((call) => call.method === "grant.create" || call.method === "policy.set"),
    ).toBe(false);
  });

  it("hides session and permanent when a capability can only be approved once", async () => {
    installHost([SHELL]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(labels(container)).toEqual(["仅本次", "拒绝"]);
    });
  });

  it("hides session when the approval has no session", async () => {
    installHost([{ ...APPROVAL, sessionId: null }]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(labels(container)).toEqual(["仅本次", "永久允许", "拒绝"]);
    });
  });

  it("sends a session decision with the default use count and two-hour TTL", async () => {
    const calls = installHost([APPROVAL]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(labels(container)).toContain("本会话");
    });
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "本会话",
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.approval.decide",
        payload: {
          approvalId: APPROVAL.id,
          expectedActionDigest: APPROVAL.actionDigest,
          decision: "approved",
          scope: "session",
          maxUses: 5,
          ttlMinutes: 120,
        },
      });
    });
  });

  it("denies without a use count or TTL", async () => {
    const calls = installHost([APPROVAL]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(labels(container)).toContain("拒绝");
    });
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "拒绝",
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
    expect(calls).toContainEqual({
      method: "permission.approval.decide",
      payload: {
        approvalId: APPROVAL.id,
        expectedActionDigest: APPROVAL.actionDigest,
        decision: "denied",
        scope: "once",
      },
    });
    });
  });
});
