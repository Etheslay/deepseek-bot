import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startApplicationToolServer, type ApplicationToolServer } from "./app-tool-channel.js";

const hosts: DeepSeekBotHost[] = [];
const servers: ApplicationToolServer[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function setup(now?: () => Date) {
  const root = mkdtempSync(join(tmpdir(), "dsb-app-channel-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "unused",
    ...(now === undefined ? {} : { now }),
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "actor",
    instructions: "actor",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  const server = await startApplicationToolServer(host.agentTools);
  servers.push(server);
  const controller = new AbortController();
  const sessionId = `physical:${randomUUID()}`;
  const turn = server.openTurn({
    sessionId,
    caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
    signal: controller.signal,
  });
  const request = (path: string, body?: unknown, token = turn.env.DSB_APP_TOOLS_TOKEN) =>
    fetch(`${server.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const call = (tool: string, params: unknown = {}, callId: string = randomUUID(), physicalId = sessionId) =>
    request("/app-tools/call", { sessionId: physicalId, callId, tool, params });
  return { host, server, turn, controller, request, call, bot, sessionId };
}
async function pending(host: DeepSeekBotHost): Promise<AppApproval> {
  let result: AppApproval[] = [];
  await vi.waitFor(async () => {
    result = (
      (await host.handleMethod("permission.approval.list", {})) as { approvals: AppApproval[] }
    ).approvals;
    expect(result).toHaveLength(1);
  });
  return result[0]!;
}
async function approve(host: DeepSeekBotHost, approval: AppApproval, scope = "once") {
  return host.handleMethod("permission.approval.decide", {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision: "approved",
    scope,
    ...(scope === "session" ? { maxUses: 2 } : {}),
  });
}
describe("authenticated chat application tool channel", () => {
  it("exports precisely the eleven application schemas and proves plugin readiness", async () => {
    const { request, turn } = await setup();
    const response = await request("/app-tools");
    const { tools } = (await response.json()) as {
      tools: Array<{ name: string; parameters: unknown }>;
    };
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_bot_draft",
      "create_bots_batch",
      "create_group",
      "dispatch_task",
      "get_run",
      "get_run_events",
      "list_bots",
      "list_groups",
      "list_tasks",
      "revoke_batch",
      "save_workflow",
    ]);
    expect(tools.find((t) => t.name === "create_group")?.parameters).toMatchObject({
      type: "object",
      required: ["name"],
      additionalProperties: false,
    });
    await request("/app-tools/ready", { tools: tools.map((t) => t.name) });
    await expect(turn.waitReady(100)).resolves.toBeUndefined();
  });
  it("rejects wrong tokens, foreign sessions, control methods and invalid parameters", async () => {
    const { request, call, host } = await setup();
    expect((await request("/app-tools", undefined, "bad-token")).status).toBe(401);
    expect((await call("list_bots", {}, randomUUID(), "foreign")).status).toBe(403);
    expect(await (await call("permission.policy.set")).json()).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(
      await (await call("create_group", { name: "secret", actor: "fake" } as never)).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("waits before writes, resumes the same call, and does not replay duplicate call IDs", async () => {
    const { call, host, turn } = await setup();
    const id = randomUUID();
    const params = { name: "private group contents" };
    const first = call("create_group", params, id);
    const second = call("create_group", params, id);
    const approval = await pending(host);
    expect(approval.params).toEqual(params);
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
    await approve(host, approval);
    const a = await (await first).json();
    const b = await (await second).json();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, result: { name: params.name } });
    expect(await (await call("create_group", params, id)).json()).toEqual(a);
    expect(await (await call("create_group", { name: "altered" }, id)).json()).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    const { groups } = (await host.handleMethod("group.list", {})) as { groups: unknown[] };
    expect(groups).toHaveLength(1);
    expect(readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8")).not.toContain(
      params.name,
    );
    await turn.close();
    expect((await call("list_bots")).status).toBe(401);
  });
  it("cancels pending authorization when the transport disconnects", async () => {
    const { server, turn, host, sessionId } = await setup();
    const requestAbort = new AbortController();
    const response = fetch(`${server.url}/app-tools/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${turn.env.DSB_APP_TOOLS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        callId: randomUUID(),
        tool: "create_group",
        params: { name: "cancelled" },
      }),
      signal: requestAbort.signal,
    });
    const rejected = expect(response).rejects.toThrow();
    const approval = await pending(host);
    requestAbort.abort();
    await rejected;
    await vi.waitFor(async () =>
      expect(
        ((await host.handleMethod("permission.approval.list", {})) as { approvals: unknown[] })
          .approvals,
      ).toEqual([]),
    );
    await expect(approve(host, approval)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("cleans pending calls on turn abort and server shutdown", async () => {
    const { call, host, controller, server } = await setup();
    const response = call("create_group", { name: "never" });
    await pending(host);
    controller.abort();
    expect(await (await response).json()).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    await server.close();
    expect(await host.handleMethod("permission.approval.list", {})).toEqual({ approvals: [] });
  });
  it("server shutdown releases upstream abort listeners without requiring turn.close", async () => {
    const { server, controller } = await setup();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    await server.close();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it("reuses a session grant across physical turns without sharing it with another logical session", async () => {
    const { host, server, call, turn, bot, sessionId } = await setup();
    const first = call("create_group", { name: "first turn" });
    await approve(host, await pending(host), "session");
    await first;
    await turn.close();
    const controller = new AbortController();
    const physical = `${sessionId}:next`;
    const next = server.openTurn({
      sessionId: physical,
      caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
      signal: controller.signal,
    });
    const invoke = (tool: string, params: unknown) =>
      fetch(`${server.url}/app-tools/call`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${next.env.DSB_APP_TOOLS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionId: physical, callId: randomUUID(), tool, params }),
      });
    expect(await (await invoke("create_group", { name: "second turn" })).json()).toMatchObject({
      ok: true,
    });
    const exhausted = invoke("create_group", { name: "no quota" });
    await pending(host);
    controller.abort();
    await exhausted;
    await next.close();
    const foreignController = new AbortController();
    const foreign = server.openTurn({
      sessionId: "foreign:physical",
      caller: { id: "different", botId: bot.id, sessionId: "different:logical" },
      signal: foreignController.signal,
    });
    const response = fetch(`${server.url}/app-tools/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${foreign.env.DSB_APP_TOOLS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "foreign:physical",
        callId: randomUUID(),
        tool: "create_group",
        params: { name: "isolated" },
      }),
    });
    await pending(host);
    foreignController.abort();
    expect(await (await response).json()).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    await foreign.close();
  });
  it("returns human denial and rejects duplicate or late decisions", async () => {
    const { call, host } = await setup();
    const response = call("create_group", { name: "denied" });
    const approval = await pending(host);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "denied",
      scope: "once",
    });
    expect(await (await response).json()).toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED_PATH" },
    });
    await expect(approve(host, approval)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("fails readiness when the plugin is missing or reports an incomplete catalog", async () => {
    const { turn, request } = await setup();
    expect((await request("/app-tools/ready", { tools: ["list_bots"] })).status).toBe(400);
    await expect(turn.waitReady(5)).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    await turn.close();
  });
  it("returns approval expiry over the original HTTP call without writing", async () => {
    let clock = Date.now();
    const { host, call } = await setup(() => new Date(clock));
    const response = call("create_group", { name: "expired" });
    const approval = await pending(host);
    clock += 600_000;
    await expect(approve(host, approval)).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect(await (await response).json()).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_EXPIRED" },
    });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("releases a pending HTTP call when its Host is shut down", async () => {
    const { host, call } = await setup();
    const response = call("create_group", { name: "never on shutdown" });
    await pending(host);
    await host.shutdown();
    expect(await (await response).json()).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_UNAVAILABLE" },
    });
  });
  it("isolates concurrent bot turns even when both use the same call ID", async () => {
    const { host, server, bot, call } = await setup();
    const otherBot = (await host.handleMethod("bot.create", {
      name: "other",
      instructions: "other",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    const controller = new AbortController();
    const other = server.openTurn({
      sessionId: "other:physical",
      caller: { id: `chat:${otherBot.id}`, botId: otherBot.id, sessionId: `chat:${otherBot.id}` },
      signal: controller.signal,
    });
    const first = call("create_group", { name: "first actor" }, "same-call-id");
    const second = fetch(`${server.url}/app-tools/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${other.env.DSB_APP_TOOLS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "other:physical",
        callId: "same-call-id",
        tool: "create_group",
        params: { name: "second actor" },
      }),
    });
    let approvals: AppApproval[] = [];
    await vi.waitFor(async () => {
      approvals = (
        (await host.handleMethod("permission.approval.list", {})) as { approvals: AppApproval[] }
      ).approvals;
      expect(approvals).toHaveLength(2);
    });
    await approve(host, approvals.find((approval) => approval.botId === bot.id)!);
    expect(await (await first).json()).toMatchObject({ ok: true, result: { name: "first actor" } });
    const remaining = (await host.handleMethod("permission.approval.list", {})) as {
      approvals: AppApproval[];
    };
    expect(remaining.approvals.map((approval) => approval.botId)).toEqual([otherBot.id]);
    await approve(host, remaining.approvals[0]!);
    expect(await (await second).json()).toMatchObject({
      ok: true,
      result: { name: "second actor" },
    });
    await other.close();
  });
});
