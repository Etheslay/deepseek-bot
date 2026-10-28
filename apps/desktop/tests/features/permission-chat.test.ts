// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPABILITY_IDS, defaultPermissionMode } from "@deepseek-bot/contracts";
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

const GRANT = {
  id: "66666666-6666-4666-8666-666666666666",
  capability: "app.create_group",
  botId: BOT,
  mode: "allow",
  scope: "session",
  sessionId: `chat:${BOT}`,
  generation: 1,
  approvalId: null,
  maxUses: 5,
  uses: 0,
  expiresAt: "2026-10-26T08:00:00.000Z",
  createdAt: "2026-10-26T06:00:00.000Z",
  revokedAt: null,
};

function issuedGrant(payload: { botId?: string; capability?: string; scope?: string }) {
  const permanent = payload.scope === "permanent";
  return {
    ...GRANT,
    botId: payload.botId ?? BOT,
    capability: payload.capability ?? GRANT.capability,
    scope: payload.scope ?? "session",
    sessionId: permanent ? null : `chat:${payload.botId ?? BOT}`,
    generation: permanent ? null : 1,
    maxUses: permanent ? null : 5,
    expiresAt: permanent ? null : GRANT.expiresAt,
  };
}

function installHost(approvals: unknown[], grants: unknown[] = []): Call[] {
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
        if (method === "permission.policy.list") {
          return {
            policies: CAPABILITY_IDS.map((capability) => ({
              capability,
              mode: defaultPermissionMode(capability),
            })),
          };
        }
        if (method === "permission.grant.list") return { grants };
        if (method === "permission.grant.issue") return { grant: issuedGrant(payload as never) };
        if (method === "permission.grant.revoke") {
          return { grant: { ...GRANT, revokedAt: "2026-10-26T07:00:00.000Z" } };
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

  it("grants one ask capability for this bot and hides per-action capabilities", async () => {
    const calls = installHost([]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-scope='session']")).not.toBeNull();
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      ".permission-chat-grant .custom-select-trigger",
    );
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const values = [...container.querySelectorAll(".custom-select-item")].map((item) =>
      item.getAttribute("data-value"),
    );
    expect(values).toContain("app.create_group");
    expect(values).toContain("memory.write");
    for (const blocked of ["app.read", "app.start_run", "exec.shell", "screen.capture", "device.action", "mcp.call"]) {
      expect(values).not.toContain(blocked);
    }
    const button = container.querySelector<HTMLButtonElement>("[data-scope='session']");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.grant.issue",
        payload: { botId: BOT, capability: "app.create_group", scope: "session" },
      });
    });
    expect(calls.some((call) => call.method === "grant.create" || call.method === "policy.set")).toBe(
      false,
    );
  });

  it("revokes one grant for the open bot and ignores another bot's grant", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const calls = installHost(
      [],
      [
        GRANT,
        {
          ...GRANT,
          id: "77777777-7777-4777-8777-777777777777",
          botId: other,
          capability: "app.update_bot",
        },
      ],
    );
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(container.querySelector(`[data-grant-id="${GRANT.id}"]`)).not.toBeNull();
    });
    expect(container.textContent).not.toContain("修改 bot");
    expect(calls).toContainEqual({ method: "permission.grant.list", payload: { botId: BOT } });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-grant-id="${GRANT.id}"]`)
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(calls).toContainEqual({
        method: "permission.grant.revoke",
        payload: { grantId: GRANT.id },
      });
    });
  });
});
