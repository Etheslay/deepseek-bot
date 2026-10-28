/**
 * G3: native harness tool calls inside a chat turn reach the D16 checkpoint.
 * The gate maps the closed D08 action vocabulary onto fs/exec capabilities
 * (policy allow/deny, ask mints a durable AppApproval with the shared card
 * surface and TTL), network stays on the chat D08 network seam, and the turn
 * registers/unregisters the gate with the approval bridge.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { ChatNativeGate } from "./chat-gate.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);
const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(scenario = "ok"): Promise<{ host: DeepSeekBotHost; botId: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-gate-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, FAKE_SCENARIO: scenario }),
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "gate-bot",
    instructions: "x",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return { host, botId: bot.id };
}

function gateFor(host: DeepSeekBotHost, botId: string, signal: AbortSignal): ChatNativeGate {
  return new ChatNativeGate({
    permissions: host.permissions,
    network: async () => ({ approvalId: null, resource: "https://example.test" }),
    botId,
    sessionId: `chat:${botId}:turn`,
    signal,
  });
}

async function pendingApproval(host: DeepSeekBotHost): Promise<AppApproval> {
  let approvals: AppApproval[] = [];
  await vi.waitFor(async () => {
    ({ approvals } = (await host.handleMethod("permission.approval.list", {})) as {
      approvals: AppApproval[];
    });
    expect(approvals).toHaveLength(1);
  });
  return approvals[0]!;
}

describe("ChatNativeGate", () => {
  it("mints a durable approval for a native read and resolves after the decision", async () => {
    const { host, botId } = await setup();
    const controller = new AbortController();
    const gate = gateFor(host, botId, controller.signal);
    const pending = gate.authorize({
      kind: "file.read",
      callId: "call-1",
      toolName: "read",
      path: "C:\\ws\\notes.md",
      arguments: {},
    });
    const approval = await pendingApproval(host);
    expect(approval.tool).toBe("fs_read");
    expect(approval.botId).toBe(botId);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    const authorized = await pending;
    expect(authorized.approvalId).toBe(approval.id);
    expect(authorized.resource).toBe("C:\\ws\\notes.md");
  });

  it("rejects a policy deny with a classified error", async () => {
    const { host, botId } = await setup();
    await host.handleMethod("permission.policy.set", { capability: "fs.write", mode: "deny" });
    const gate = gateFor(host, botId, new AbortController().signal);
    await expect(
      gate.authorize({
        kind: "file.write",
        callId: "call-2",
        toolName: "write",
        path: "C:\\ws\\out.md",
        arguments: {},
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("keeps exec.shell locked to ask: allow is not a settable policy", async () => {
    const { host, botId } = await setup();
    await expect(
      host.handleMethod("permission.policy.set", { capability: "exec.shell", mode: "allow" }),
    ).rejects.toSatisfy((error: unknown) => String((error as Error).message).length > 0);
    const controller = new AbortController();
    const gate = gateFor(host, botId, controller.signal);
    const pending = gate.authorize({
      kind: "shell.exec",
      callId: "call-3",
      toolName: "pwsh",
      command: "Get-ChildItem",
      arguments: {},
    });
    const approval = await pendingApproval(host);
    expect(approval.tool).toBe("exec_shell");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("cancels a pending approval when the turn aborts", async () => {
    const { host, botId } = await setup();
    const controller = new AbortController();
    const gate = gateFor(host, botId, controller.signal);
    const pending = gate.authorize({
      kind: "file.write",
      callId: "call-4",
      toolName: "write",
      path: "C:\\ws\\x.md",
      arguments: {},
    });
    await pendingApproval(host);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("routes network asks through the chat D08 network seam", async () => {
    const { host, botId } = await setup();
    const seen: Array<{ callerId: string; url: string }> = [];
    const gate = new ChatNativeGate({
      permissions: host.permissions,
      network: async (caller, action) => {
        seen.push({ callerId: caller.id, url: action.url ?? "" });
        return { approvalId: null, resource: action.url ?? "" };
      },
      botId,
      sessionId: `chat:${botId}:turn`,
      signal: new AbortController().signal,
    });
    const authorized = await gate.authorize({
      kind: "network.request",
      callId: "call-5",
      toolName: "web_fetch",
      url: "https://example.test/page",
      arguments: {},
    });
    expect(authorized.approvalId).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://example.test/page");
    expect(seen[0]?.callerId).toBe(gate.caller.id);
  });

  it("gates native mcp tools on the mcp.call capability", async () => {
    const { host, botId } = await setup();
    await host.handleMethod("permission.policy.set", { capability: "mcp.call", mode: "deny" });
    const gate = gateFor(host, botId, new AbortController().signal);
    await expect(
      gate.authorize({
        kind: "mcp.call",
        callId: "call-6",
        toolName: "mcp__notes__search",
        arguments: {},
        mcpServerId: "notes",
        mcpToolName: "search",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("survives an authorize rejection without corrupting the next ask", async () => {
    const { host, botId } = await setup();
    const gate = new ChatNativeGate({
      permissions: host.permissions,
      network: async () => {
        throw new NodeExecutionError({
          code: "UNAUTHORIZED_PATH",
          message: "network denied by the chat policy",
          retryable: false,
        });
      },
      botId,
      sessionId: `chat:${botId}:turn`,
      signal: new AbortController().signal,
    });
    await expect(
      gate.authorize({
        kind: "network.request",
        callId: "call-7",
        toolName: "web_fetch",
        url: "https://example.test/denied",
        arguments: {},
      }),
    ).rejects.toBeInstanceOf(NodeExecutionError);
    const next = gate.authorize({
      kind: "file.read",
      callId: "call-8",
      toolName: "read",
      path: "C:\\ws\\ok.md",
      arguments: {},
    });
    const approval = await pendingApproval(host);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    expect((await next).approvalId).toBe(approval.id);
  });
});

describe("chat turn bridge registration", () => {
  it("registers the gate for a hanging turn and unregisters on cancel", async () => {
    const { host, botId } = await setup("hang");
    const sent = host.handleMethod("chat.send", { botId, text: "挂起回合" }) as Promise<unknown>;
    await vi.waitFor(
      () => {
        expect(host.sessions.size).toBe(1);
      },
      { timeout: 10_000 },
    );
    expect((await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` })) as {
      cancelled: boolean;
    }).toMatchObject({ cancelled: true });
    await expect(sent).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => {
      expect(host.sessions.size).toBe(0);
    });
  });

  it("unregisters the gate when a turn finishes normally", async () => {
    const { host, botId } = await setup("ok");
    await host.handleMethod("chat.send", { botId, text: "正常回合" });
    expect(host.sessions.size).toBe(0);
  });
});
