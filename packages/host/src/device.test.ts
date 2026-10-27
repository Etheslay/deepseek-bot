import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval, DeviceActionResult } from "@deepseek-bot/contracts";
import { createHost, type DeepSeekBotHost } from "./host.js";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(now?: () => Date) {
  const root = mkdtempSync(join(tmpdir(), "dsb-device-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "unused",
    ...(now !== undefined ? { now } : {}),
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "device",
    instructions: "device",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return { host, bot };
}

async function pending(host: DeepSeekBotHost, botId: string): Promise<AppApproval> {
  let found: AppApproval | undefined;
  await vi.waitFor(
    async () => {
      const listed = (await host.handleMethod("permission.approval.list", { botId })) as {
        approvals: AppApproval[];
      };
      found = listed.approvals.find((item) => item.status === "pending");
      expect(found).toBeDefined();
    },
    { timeout: 5_000 },
  );
  return found!;
}

async function enable(host: DeepSeekBotHost): Promise<void> {
  await host.handleMethod("permission.policy.set", { capability: "device.action", mode: "ask" });
}

async function records(host: DeepSeekBotHost, botId: string) {
  const listed = (await host.handleMethod("device.action.list", { botId })) as {
    records: Array<{ id: string; botId: string; action: string; at: string }>;
  };
  return listed.records;
}

async function decide(
  host: DeepSeekBotHost,
  approval: AppApproval,
  decision: "approved" | "denied",
): Promise<void> {
  await host.handleMethod("permission.approval.decide", {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision,
    scope: "once",
  });
}

describe("device action approval gate", () => {
  it("denies a device action before ask, and a denial or disabled policy accepts nothing", async () => {
    const { host, bot } = await setup();
    const policies = (await host.handleMethod("permission.policy.list", {})) as {
      policies: Array<{ capability: string; mode: string }>;
    };
    expect(policies.policies.find((policy) => policy.capability === "device.action")).toEqual({
      capability: "device.action",
      mode: "deny",
    });
    await expect(
      host.handleMethod("permission.policy.set", { capability: "device.action", mode: "allow" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await expect(
      host.handleMethod("tool.invoke", {
        callerBotId: bot.id,
        tool: "device_action",
        params: { kind: "pointer" },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const before = (await host.handleMethod("permission.approval.list", { botId: bot.id })) as {
      approvals: AppApproval[];
    };
    expect(before.approvals.filter((item) => item.tool === "device_action")).toEqual([]);

    await enable(host);
    const denied = host.handleMethod("device.action.request", { botId: bot.id, kind: "key" });
    const denial = await pending(host, bot.id);
    await host.handleMethod("permission.approval.decide", {
      approvalId: denial.id,
      expectedActionDigest: denial.actionDigest,
      decision: "denied",
      scope: "once",
    });
    await expect(denied).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });

    const waiting = host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" });
    await pending(host, bot.id);
    await host.handleMethod("permission.policy.set", { capability: "device.action", mode: "deny" });
    await expect(waiting).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await expect(
      host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const after = (await host.handleMethod("permission.approval.list", {
      botId: bot.id,
      status: "pending",
    })) as { approvals: AppApproval[] };
    expect(after.approvals).toEqual([]);
  });

  it("accepts one request after one exact approval and returns only an id and a timestamp", async () => {
    const { host, bot } = await setup();
    await enable(host);
    await expect(
      host.handleMethod("device.action.request", {
        botId: bot.id,
        kind: "pointer",
        x: 10,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const call = host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" });
    const approval = await pending(host, bot.id);
    expect(approval.tool).toBe("device_action");
    expect(approval.capabilities).toEqual(["device.action"]);
    expect(approval.params).toEqual({ kind: "pointer" });
    await expect(
      host.handleMethod("device.action.request", { botId: bot.id, kind: "key" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: "0".repeat(64),
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "session",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    const result = (await call) as DeviceActionResult;
    expect(Object.keys(result).sort()).toEqual(["at", "id"]);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(JSON.stringify(result)).not.toContain("pointer");

    const toolCall = host.agentTools.call(
      { id: `chat:${bot.id}`, botId: bot.id },
      "device_action",
      { kind: "key" },
    );
    const toolApproval = await pending(host, bot.id);
    expect(toolApproval.id).not.toBe(approval.id);
    expect(toolApproval.params).toEqual({ kind: "key" });
    await host.handleMethod("permission.approval.decide", {
      approvalId: toolApproval.id,
      expectedActionDigest: toolApproval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    const toolResult = (await toolCall) as DeviceActionResult;
    expect(Object.keys(toolResult).sort()).toEqual(["at", "id"]);
    expect(toolResult.id).not.toBe(result.id);
    await expect(
      host.agentTools.call({ id: `chat:${bot.id}`, botId: bot.id }, "device_action", {
        kind: "pointer",
        x: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does nothing when that approval is used a second time", async () => {
    const { host, bot } = await setup();
    await enable(host);
    const firstCall = host.handleMethod("device.action.request", {
      botId: bot.id,
      kind: "key",
    });
    const approval = await pending(host, bot.id);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    const first = (await firstCall) as DeviceActionResult;
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const secondCall = host.handleMethod("device.action.request", {
      botId: bot.id,
      kind: "key",
    });
    const second = await pending(host, bot.id);
    expect(second.id).not.toBe(approval.id);
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: second.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const still = (await host.handleMethod("permission.approval.list", { botId: bot.id })) as {
      approvals: AppApproval[];
    };
    expect(still.approvals.find((item) => item.id === second.id)?.status).toBe("pending");
    await host.handleMethod("permission.approval.decide", {
      approvalId: second.id,
      expectedActionDigest: second.actionDigest,
      decision: "denied",
      scope: "once",
    });
    await expect(secondCall).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(first.id).not.toBe(second.id);
  });

  it("persists one local record after one exact approval", async () => {
    const { host, bot } = await setup();
    await enable(host);
    const call = host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" });
    const approval = await pending(host, bot.id);
    await decide(host, approval, "approved");
    const result = (await call) as DeviceActionResult;
    expect(Object.keys(result).sort()).toEqual(["at", "id"]);

    const stored = await records(host, bot.id);
    expect(stored).toEqual([
      { id: result.id, botId: bot.id, action: "pointer", at: result.at },
    ]);
    expect(await records(host, bot.id)).toEqual(stored);
  });

  it("writes nothing when an approval is denied, disabled, reused, or the name is unknown", async () => {
    const { host, bot } = await setup();
    await enable(host);
    await expect(
      host.handleMethod("device.action.request", { botId: bot.id, kind: "click" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.agentTools.call({ id: `chat:${bot.id}`, botId: bot.id }, "device_action", {
        kind: "mouse",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const untouched = (await host.handleMethod("permission.approval.list", { botId: bot.id })) as {
      approvals: AppApproval[];
    };
    expect(untouched.approvals.filter((item) => item.tool === "device_action")).toEqual([]);
    expect(await records(host, bot.id)).toEqual([]);

    const denied = host.handleMethod("device.action.request", { botId: bot.id, kind: "key" });
    const denial = await pending(host, bot.id);
    await decide(host, denial, "denied");
    await expect(denied).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(await records(host, bot.id)).toEqual([]);

    const waiting = host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" });
    await pending(host, bot.id);
    await host.handleMethod("permission.policy.set", { capability: "device.action", mode: "deny" });
    await expect(waiting).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(await records(host, bot.id)).toEqual([]);

    await enable(host);
    const accepted = host.handleMethod("device.action.request", { botId: bot.id, kind: "key" });
    const approval = await pending(host, bot.id);
    await decide(host, approval, "approved");
    const first = (await accepted) as DeviceActionResult;
    await expect(decide(host, approval, "approved")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const again = host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" });
    const second = await pending(host, bot.id);
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await decide(host, second, "denied");
    await expect(again).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(await records(host, bot.id)).toEqual([
      { id: first.id, botId: bot.id, action: "key", at: first.at },
    ]);
  });

  it("lists one bot's records newest first", async () => {
    let current = Date.parse("2026-10-27T03:00:00.000Z");
    const { host, bot } = await setup(() => new Date(current));
    const other = (await host.handleMethod("bot.create", {
      name: "other",
      instructions: "device",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    await enable(host);

    const firstCall = host.handleMethod("device.action.request", {
      botId: bot.id,
      kind: "pointer",
    });
    await decide(host, await pending(host, bot.id), "approved");
    const first = (await firstCall) as DeviceActionResult;

    current += 1000;
    const secondCall = host.handleMethod("device.action.request", { botId: bot.id, kind: "key" });
    await decide(host, await pending(host, bot.id), "approved");
    const second = (await secondCall) as DeviceActionResult;

    current += 1000;
    const otherCall = host.handleMethod("device.action.request", {
      botId: other.id,
      kind: "pointer",
    });
    await decide(host, await pending(host, other.id), "approved");
    const hidden = (await otherCall) as DeviceActionResult;

    expect(await records(host, bot.id)).toEqual([
      { id: second.id, botId: bot.id, action: "key", at: "2026-10-27T03:00:01.000Z" },
      { id: first.id, botId: bot.id, action: "pointer", at: "2026-10-27T03:00:00.000Z" },
    ]);
    expect(await records(host, other.id)).toEqual([
      { id: hidden.id, botId: other.id, action: "pointer", at: "2026-10-27T03:00:02.000Z" },
    ]);
  });
});
