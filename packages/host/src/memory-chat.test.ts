import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startApplicationToolServer, type ApplicationToolServer } from "./app-tool-channel.js";

const hosts: DeepSeekBotHost[] = [];
const toolServers: ApplicationToolServer[] = [];
const roots: string[] = [];
const secret = "Private note Alpha";

afterEach(async () => {
  for (const server of toolServers.splice(0)) await server.close();
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "dsb-memory-chat-"));
  roots.push(root);
  const host = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
  hosts.push(host);
  await host.handleMethod("permission.policy.set", { capability: "memory.write", mode: "ask" });
  const bot = (await host.handleMethod("bot.create", {
    name: "rememberer",
    instructions: "remember",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  const server = await startApplicationToolServer(host.agentTools);
  toolServers.push(server);
  const sessionId = `physical:${randomUUID()}`;
  const turn = server.openTurn({
    sessionId,
    caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
    signal: new AbortController().signal,
  });
  const request = (path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${turn.env.DSB_APP_TOOLS_TOKEN}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { host, request, bot, sessionId, root };
}

async function otherBot(host: DeepSeekBotHost): Promise<string> {
  const created = (await host.handleMethod("bot.create", {
    name: "other",
    instructions: "other",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return created.id;
}

describe("chat memory", () => {
  it("keeps notes on the calling bot and leaves the eight-tool catalog unchanged", async () => {
    const { host, request, bot, sessionId } = await setup();
    const names = host.agentTools.capabilities.list().map((tool) => tool.name);
    expect(names).toContain("memory_write");
    expect(names).toContain("memory_search");
    expect(names).not.toContain("memory_delete");
    const catalog = (await (await request("/app-tools")).json()) as { tools: Array<{ name: string }> };
    expect(catalog.tools).toHaveLength(20); // schedules, skills, read_workspace_file, write_document, edit_document, write_presentation
    for (const name of ["memory_write", "memory_search", "web_search", "ask_user"]) {
      expect(catalog.tools.map((tool) => tool.name)).not.toContain(name);
    }
    expect(
      await (
        await request("/app-tools/call", {
          sessionId,
          callId: randomUUID(),
          tool: "memory_write",
          params: { text: secret },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await host.handleMethod("memory.list", { botId: bot.id })).toEqual({ memories: [] });

    const advertised = (await (await request("/memory")).json()) as { tools: Array<{ name: string }> };
    expect(advertised.tools.map((tool) => tool.name)).toEqual([
      "memory_write",
      "memory_search",
      "knowledge_search",
    ]);
    expect(
      await (
        await request("/memory/call", {
          sessionId,
          callId: randomUUID(),
          tool: "memory_write",
          params: { text: secret, botId: "22222222-2222-4222-8222-222222222222" },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const pending = request("/memory/call", {
      sessionId,
      callId: randomUUID(),
      tool: "memory_write",
      params: { text: `  ${secret}  ` },
    });
    const approval = await vi.waitFor(async () => {
      const listed = (await host.handleMethod("permission.approval.list", {})) as {
        approvals: AppApproval[];
      };
      expect(listed.approvals).toHaveLength(1);
      return listed.approvals[0]!;
    });
    expect(approval.tool).toBe("memory_write");
    expect(approval.capabilities).toEqual(["memory.write"]);
    expect(await host.handleMethod("memory.list", { botId: bot.id })).toEqual({ memories: [] });
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    const written = (await (await pending).json()) as {
      ok: boolean;
      result: { id: string; text: string };
    };
    expect(written).toMatchObject({ ok: true, result: { text: secret } });
    expect(
      await (
        await request("/memory/call", {
          sessionId,
          callId: randomUUID(),
          tool: "memory_search",
          params: { query: "ALPHA" },
        })
      ).json(),
    ).toMatchObject({ ok: true, result: { memories: [{ id: written.result.id, text: secret }] } });

    const stranger = await otherBot(host);
    expect(await host.handleMethod("memory.list", { botId: stranger })).toEqual({ memories: [] });
    await expect(
      host.handleMethod("memory.delete", { botId: stranger, memoryId: written.result.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("memory.list", { botId: bot.id })).toMatchObject({
      memories: [{ id: written.result.id, text: secret }],
    });
    await expect(
      host.agentTools.call({ id: `chat:${bot.id}` }, "memory_search", { query: secret }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(
      await (
        await request("/memory/call", {
          sessionId,
          callId: randomUUID(),
          tool: "memory_delete",
          params: { memoryId: written.result.id },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    await host.handleMethod("memory.delete", { botId: bot.id, memoryId: written.result.id });
    expect(await host.handleMethod("memory.list", { botId: bot.id })).toEqual({ memories: [] });
    const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).not.toContain(secret);
    expect(audit).toContain("memory_write");
  });

  it("lets the desktop write and search without a model grant, and keeps the note after restart", async () => {
    const { host, bot, root } = await setup();
    const saved = (await host.handleMethod("memory.write", {
      botId: bot.id,
      text: `  ${secret}  `,
    })) as { id: string; text: string };
    expect(saved.text).toBe(secret);
    expect(await host.handleMethod("memory.list", { botId: bot.id, query: "alpha" })).toMatchObject({
      memories: [{ id: saved.id, text: secret }],
    });
    await host.shutdown();
    const reopened = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
    hosts.push(reopened);
    expect(await reopened.handleMethod("memory.list", { botId: bot.id })).toMatchObject({
      memories: [{ id: saved.id, text: secret }],
    });
    const stranger = await otherBot(reopened);
    expect(await reopened.handleMethod("memory.list", { botId: stranger, query: "alpha" })).toEqual({
      memories: [],
    });
  });
});
