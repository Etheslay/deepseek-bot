import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval, PermissionGrant } from "@deepseek-bot/contracts";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { AgentPermissionService } from "./agent-permissions.js";
import { chatSessionIdFor } from "./chat.js";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function setup(root = mkdtempSync(join(tmpdir(), "dsb-d16-"))) {
  if (!roots.includes(root)) roots.push(root);
  const host = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "actor",
    instructions: "actor",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return { host, root, caller: { id: "chat:trusted", botId: bot.id, sessionId: "session-1" } };
}
async function pending(host: DeepSeekBotHost): Promise<AppApproval> {
  let approvals: AppApproval[] = [];
  await vi.waitFor(async () => {
    ({ approvals } = (await host.handleMethod("permission.approval.list", {})) as {
      approvals: AppApproval[];
    });
    expect(approvals).toHaveLength(1);
  });
  return approvals[0]!;
}
async function approve(host: DeepSeekBotHost, approval: AppApproval, scope = "once", extra = {}) {
  return host.handleMethod("permission.approval.decide", {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision: "approved",
    scope,
    ...extra,
  }) as Promise<{ grants: PermissionGrant[] }>;
}
describe("D16 Host tool authorization", () => {
  it("denies anonymous writes and keeps human controls out of model tools", async () => {
    const { host } = await setup();
    await expect(
      host.agentTools.call({ id: "anonymous" }, "create_group", { name: "secret" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await expect(
      host.agentTools.call({ id: "anonymous" }, "permission.policy.set", {
        capability: "app.create_group",
        mode: "allow",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.agentTools.call({ id: "anonymous" }, "list_groups", {})).toEqual({
      groups: [],
    });
  });
  it("waits for exact human approval, consumes once and audits without raw parameters", async () => {
    const { host, caller } = await setup();
    const call = host.agentTools.call(caller, "create_group", { name: "private group text" });
    const approval = await pending(host);
    expect(approval.params).toEqual({ name: "private group text" });
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: "0".repeat(64),
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await approve(host, approval);
    await expect(call).resolves.toMatchObject({ name: "private group text" });
    await expect(approve(host, approval)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const audit = await host.handleMethod("permission.audit.list", {});
    expect(JSON.stringify(audit)).not.toContain("private group text");
    expect(readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8")).not.toContain(
      "private group text",
    );
  });
  it("enforces session use counts, session isolation and revocation", async () => {
    const { host, caller } = await setup();
    const first = host.agentTools.call(caller, "create_group", { name: "first" });
    const { grants } = await approve(host, await pending(host), "session", { maxUses: 2 });
    await first;
    await host.agentTools.call(caller, "create_group", { name: "second" });
    const controller = new AbortController();
    const third = host.agentTools.call(
      caller,
      "create_group",
      { name: "third" },
      { signal: controller.signal },
    );
    const rejection = expect(third).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(host);
    controller.abort();
    await rejection;
    await host.handleMethod("permission.grant.revoke", { grantId: grants[0]!.id });
    const { grants: active } = (await host.handleMethod("permission.grant.list", {})) as {
      grants: PermissionGrant[];
    };
    expect(active).toEqual([]);
  });
  it("cancels pending approvals on shutdown and rejects late decisions", async () => {
    const { host, caller } = await setup();
    const call = host.agentTools.call(caller, "create_group", { name: "never" });
    const rejected = expect(call).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    await pending(host);
    await host.shutdown();
    hosts.splice(hosts.indexOf(host), 1);
    await rejected;
  });
  it("denies a waiting action immediately when policy changes to deny", async () => {
    const { host, caller } = await setup();
    const call = host.agentTools.call(caller, "create_group", { name: "blocked" });
    const rejected = expect(call).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const approval = await pending(host);
    await host.handleMethod("permission.policy.set", {
      capability: "app.create_group",
      mode: "deny",
    });
    await rejected;
    await expect(approve(host, approval)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("expires a pending call after ten minutes and rejects late approval", async () => {
    const { host, caller } = await setup();
    vi.useFakeTimers();
    const call = host.agentTools.call(caller, "create_group", { name: "expired" });
    const rejected = expect(call).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    const { approvals } = (await host.handleMethod("permission.approval.list", {})) as {
      approvals: AppApproval[];
    };
    await vi.advanceTimersByTimeAsync(600_001);
    await rejected;
    await expect(approve(host, approvals[0]!)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("settles the waiter when a late human decision detects expiry before the timer", async () => {
    const { host, caller } = await setup();
    vi.useFakeTimers();
    const call = host.agentTools.call(caller, "create_group", { name: "late" });
    const rejected = expect(call).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    const { approvals } = (await host.handleMethod("permission.approval.list", {})) as {
      approvals: AppApproval[];
    };
    vi.setSystemTime(Date.now() + 600_001);
    await expect(approve(host, approvals[0]!)).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    await rejected;
  });
  it("human denial creates no grant or side effect", async () => {
    const { host, caller } = await setup();
    const call = host.agentTools.call(caller, "create_group", { name: "denied" });
    const rejected = expect(call).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const approval = await pending(host);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "denied",
    });
    await rejected;
    expect(await host.handleMethod("permission.grant.list", {})).toEqual({ grants: [] });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it.each(["session", "permanent"])(
    "preserves only permanent grants on restart: %s",
    async (scope) => {
      const { host, root, caller } = await setup();
      const first = host.agentTools.call(caller, "create_group", { name: "before" });
      await approve(host, await pending(host), scope);
      await first;
      await host.shutdown();
      const { host: restarted } = await setup(root);
      const controller = new AbortController();
      const next = restarted.agentTools.call(
        caller,
        "create_group",
        { name: "after" },
        { signal: controller.signal },
      );
      if (scope === "permanent") await expect(next).resolves.toMatchObject({ name: "after" });
      else {
        const rejected = expect(next).rejects.toMatchObject({ code: "CANCELLED" });
        await pending(restarted);
        controller.abort();
        await rejected;
      }
    },
  );
  it("isolates session grants and atomically reserves the final use under concurrency", async () => {
    const { host, caller } = await setup();
    const first = host.agentTools.call(caller, "create_group", { name: "initial" });
    await approve(host, await pending(host), "session", { maxUses: 2 });
    await first;
    const otherController = new AbortController();
    const other = host.agentTools.call(
      { ...caller, sessionId: "other" },
      "create_group",
      { name: "wrong session" },
      { signal: otherController.signal },
    );
    const otherRejected = expect(other).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(host);
    otherController.abort();
    await otherRejected;
    const controller = new AbortController();
    const second = host.agentTools.call(caller, "create_group", { name: "final use" });
    const third = host.agentTools.call(
      caller,
      "create_group",
      { name: "needs approval" },
      { signal: controller.signal },
    );
    const rejected = expect(third).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(second).resolves.toMatchObject({ name: "final use" });
    await pending(host);
    controller.abort();
    await rejected;
    expect(
      ((await host.handleMethod("group.list", {})) as { groups: unknown[] }).groups,
    ).toHaveLength(2);
  });
  it("requires both capabilities for batch creation with a new group", async () => {
    const { host, caller } = await setup();
    const controller = new AbortController();
    const call = host.agentTools.call(
      caller,
      "create_bots_batch",
      {
        newGroup: { name: "batch group" },
        bots: [{ name: "bot", instructions: "private instructions" }],
        defaults: {
          modelProfileId: "44444444-4444-4444-8444-444444444444",
          workspaceId: "55555555-5555-4555-8555-555555555555",
          toolPolicyId: "66666666-6666-4666-8666-666666666666",
        },
      },
      { signal: controller.signal },
    );
    const rejected = expect(call).rejects.toMatchObject({ code: "CANCELLED" });
    expect((await pending(host)).capabilities).toEqual(["app.create_bot", "app.create_group"]);
    controller.abort();
    await rejected;
  });
  it("revalidates parameters and policy immediately before execution", async () => {
    const { host, caller } = await setup();
    const checkpoint = new AgentPermissionService(host.db, host.bootGeneration);
    const params = { name: "draft" };
    const ticket = await checkpoint.check("create_bot_draft", caller, params, {});
    params.name = "changed";
    expect(() => ticket.revalidate?.()).toThrow("authorized parameters changed");
    const second = await checkpoint.check("list_groups", caller, {}, {});
    await host.handleMethod("permission.policy.set", { capability: "app.read", mode: "deny" });
    expect(() => second.revalidate?.()).toThrow("tool authorization is no longer valid");
    checkpoint.close();
  });

  it("releases pending waits and Host resources even when cancellation cannot persist", async () => {
    const { host, caller } = await setup();
    vi.useFakeTimers();
    const call = host.agentTools.call(caller, "create_group", { name: "readonly database" });
    const result = call.catch((error: unknown) => error);
    const { approvals } = (await host.handleMethod("permission.approval.list", {})) as {
      approvals: AppApproval[];
    };
    expect(approvals).toHaveLength(1);
    host.db.raw.exec("PRAGMA query_only = ON");
    try {
      await expect(host.shutdown()).resolves.toBeUndefined();
      expect(await result).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      // Also clean up a failing red implementation without keeping its server alive.
      vi.clearAllTimers();
      await host.bridge.close();
      try {
        host.db.close();
      } catch {
        /* shutdown already closed it */
      }
      hosts.splice(hosts.indexOf(host), 1);
    }
  });
  it.each(["abort", "timeout"])(
    "fails closed and rejects late decisions when %s cannot persist",
    async (kind) => {
      const { host, caller } = await setup();
      vi.useFakeTimers();
      const controller = new AbortController();
      const call = host.agentTools.call(
        caller,
        "create_group",
        { name: "readonly" },
        { signal: controller.signal },
      );
      const rejected = expect(call).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
      const { approvals } = (await host.handleMethod("permission.approval.list", {})) as {
        approvals: AppApproval[];
      };
      host.db.raw.exec("PRAGMA query_only = ON");
      if (kind === "abort") controller.abort();
      else await vi.advanceTimersByTimeAsync(600_001);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
      host.db.raw.exec("PRAGMA query_only = OFF");
      await expect(approve(host, approvals[0]!)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await host.handleMethod("permission.grant.list", {})).toEqual({ grants: [] });
    },
  );
});

describe("chat capability grant", () => {
  function chatCaller(botId: string) {
    const sessionId = chatSessionIdFor(botId);
    return { id: sessionId, botId, sessionId };
  }

  it("lets the gateway run one granted capability and stops it after revoke", async () => {
    const { host, caller } = await setup();
    const botId = caller.botId ?? "";
    const issued = (await host.handleMethod("permission.grant.issue", {
      botId,
      capability: "app.create_group",
      scope: "session",
    })) as { grant: PermissionGrant };
    expect(issued.grant).toMatchObject({
      botId,
      capability: "app.create_group",
      scope: "session",
      sessionId: chatSessionIdFor(botId),
      maxUses: 5,
      uses: 0,
      approvalId: null,
    });
    const again = (await host.handleMethod("permission.grant.issue", {
      botId,
      capability: "app.create_group",
      scope: "session",
    })) as { grant: PermissionGrant };
    expect(again.grant.id).toBe(issued.grant.id);
    await expect(
      host.handleMethod("permission.grant.issue", {
        botId,
        capability: "app.create_group",
        scope: "session",
        sessionId: "spoofed",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.agentTools.call(chatCaller(botId), "create_group", { name: "granted" }),
    ).resolves.toMatchObject({ name: "granted" });
    const used = (await host.handleMethod("permission.grant.list", { botId })) as {
      grants: PermissionGrant[];
    };
    expect(used.grants).toMatchObject([{ id: issued.grant.id, uses: 1 }]);
    await host.handleMethod("permission.grant.revoke", { grantId: issued.grant.id });
    const controller = new AbortController();
    const blocked = host.agentTools.call(
      chatCaller(botId),
      "create_group",
      { name: "revoked" },
      { signal: controller.signal },
    );
    const rejected = expect(blocked).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(host);
    controller.abort();
    await rejected;
    const groups = (await host.handleMethod("group.list", {})) as { groups: { name: string }[] };
    expect(groups.groups.map((group) => group.name)).toEqual(["granted"]);
  });

  it("does not run a capability the policy denies, even when a chat grant exists", async () => {
    const { host, caller } = await setup();
    const botId = caller.botId ?? "";
    await host.handleMethod("permission.grant.issue", {
      botId,
      capability: "app.create_group",
      scope: "permanent",
    });
    await host.handleMethod("permission.policy.set", {
      capability: "app.create_group",
      mode: "deny",
    });
    await expect(
      host.agentTools.call(chatCaller(botId), "create_group", { name: "denied" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });

  it("refuses session grants for per-action capabilities and leaves them unexecuted", async () => {
    const { host, caller } = await setup();
    const botId = caller.botId ?? "";
    await host.handleMethod("permission.policy.set", { capability: "device.action", mode: "ask" });
    await host.handleMethod("permission.policy.set", { capability: "screen.capture", mode: "ask" });
    for (const capability of [
      "app.start_run",
      "exec.shell",
      "screen.capture",
      "device.action",
      "mcp.call",
    ]) {
      await expect(
        host.handleMethod("permission.grant.issue", { botId, capability, scope: "session" }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(
      host.agentTools.call({ id: "model" }, "permission.grant.issue", {
        botId,
        capability: "app.create_group",
        scope: "permanent",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("permission.grant.list", { botId })).toEqual({ grants: [] });
    expect(await host.handleMethod("device.action.list", { botId })).toEqual({ records: [] });
  });

  it("keeps a chat session grant inside that chat session and drops it on restart", async () => {
    const { host, root, caller } = await setup();
    const botId = caller.botId ?? "";
    await host.handleMethod("permission.grant.issue", {
      botId,
      capability: "app.create_group",
      scope: "session",
    });
    const controller = new AbortController();
    const other = host.agentTools.call(
      { id: "other", botId, sessionId: "other-session" },
      "create_group",
      { name: "other-session" },
      { signal: controller.signal },
    );
    const rejected = expect(other).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(host);
    controller.abort();
    await rejected;
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
    await host.shutdown();
    const { host: restarted } = await setup(root);
    const again = new AbortController();
    const after = restarted.agentTools.call(
      chatCaller(botId),
      "create_group",
      { name: "after-restart" },
      { signal: again.signal },
    );
    const expired = expect(after).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(restarted);
    again.abort();
    await expired;
    expect(await restarted.handleMethod("group.list", {})).toEqual({ groups: [] });
  });

  it("keeps a permanent chat grant across a host restart", async () => {
    const { host, root, caller } = await setup();
    const botId = caller.botId ?? "";
    await host.handleMethod("permission.grant.issue", {
      botId,
      capability: "app.create_group",
      scope: "permanent",
    });
    await host.shutdown();
    const { host: restarted } = await setup(root);
    await expect(
      restarted.agentTools.call(chatCaller(botId), "create_group", { name: "still-granted" }),
    ).resolves.toMatchObject({ name: "still-granted" });
  });
});
