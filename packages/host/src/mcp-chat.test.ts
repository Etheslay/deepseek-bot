import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { getBot, updateToolPolicy } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startApplicationToolServer, type ApplicationToolServer } from "./app-tool-channel.js";

const hosts: DeepSeekBotHost[] = [];
const channels: ApplicationToolServer[] = [];
const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const channel of channels.splice(0)) await channel.close();
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture(modelEndpoint?: string) {
  const calls: unknown[] = [];
  let result: Record<string, unknown> = { content: [{ type: "text", text: "local result" }] };
  let listObserved = false;
  let listGate: Promise<void> | undefined;
  let releaseList: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const rpc = JSON.parse(body) as { id?: string | number; method: string; params?: unknown };
    if (rpc.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let value: unknown;
    if (rpc.method === "tools/list" && listGate) {
      listObserved = true;
      await listGate;
    }
    if (rpc.method === "initialize")
      value = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    else if (rpc.method === "tools/list")
      value = {
        tools: [
          {
            name: "echo",
            description: "Echo local text",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string", maxLength: 100 } },
              required: ["text"],
              additionalProperties: false,
            },
          },
          { name: "unselected", inputSchema: { type: "object" } },
        ],
      };
    else if (rpc.method === "tools/call") {
      calls.push(rpc.params);
      value = result;
    } else {
      res.writeHead(400).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: value }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("not listening");
  const root = mkdtempSync(join(tmpdir(), "dsb-mcp-chat-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => {
      if (modelEndpoint) return "sk-local-controlled-mcp-model";
      throw new Error("must not resolve MCP credentials");
    },
    ...(modelEndpoint
      ? {
          childEnv: (parent: NodeJS.ProcessEnv) => ({
            ...parent,
            DEEPSEEK_BASE_URL: modelEndpoint,
          }),
        }
      : {}),
  });
  hosts.push(host);
  await host.handleMethod("permission.policy.set", { capability: "mcp.call", mode: "ask" });
  async function newBot(name: string) {
    return (await host.handleMethod("bot.create", {
      name,
      instructions: name,
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
  }
  const bot = await newBot("mcp actor");
  const connector = (await host.handleMethod("connector.register", {
    name: "Local MCP",
    kind: "mcp-http",
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
  })) as { id: string };
  await host.handleMethod("connector.enable", { id: connector.id });
  const channel = await startApplicationToolServer(host.agentTools, { mcp: host.mcp });
  channels.push(channel);
  async function open(botId = bot.id) {
    const controller = new AbortController();
    const sessionId = randomUUID();
    const turn = channel.openTurn({
      sessionId,
      caller: { id: `chat:${botId}`, botId, sessionId },
      signal: controller.signal,
    });
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(`${channel.url}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${turn.env.DSB_APP_TOOLS_TOKEN}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return (await response.json()) as Record<string, unknown>;
    };
    const catalog = (await request("/mcp")) as {
      tools: Array<{ name: string; parameters: unknown }>;
    };
    const call = (
      args: unknown,
      callId = randomUUID(),
      tool = catalog.tools[0]?.name ?? "missing",
    ) => request("/mcp/call", { sessionId, callId, tool, params: args });
    return { catalog, call, request, controller, turn };
  }
  const grant = (allowedTools = ["echo"]) =>
    host.handleMethod("connector.mcp.grants.set", {
      botId: bot.id,
      id: connector.id,
      allowedTools,
    });
  return {
    host,
    bot,
    connector,
    calls,
    root,
    newBot,
    open,
    grant,
    setResult: (value: Record<string, unknown>) => {
      result = value;
    },
    holdLists: () => {
      listGate = new Promise<void>((resolve) => {
        releaseList = resolve;
      });
    },
    listObserved: () => listObserved,
    releaseLists: () => releaseList?.(),
  };
}

async function pending(host: DeepSeekBotHost): Promise<AppApproval> {
  return await vi.waitFor(
    async () => {
      const list = (await host.handleMethod("permission.approval.list", { status: "pending" })) as {
        approvals: AppApproval[];
      };
      expect(list.approvals).toHaveLength(1);
      return list.approvals[0]!;
    },
    // Approvals and tool discovery surface after async work; the 1s default
    // poll budget starves while LibreOffice conversions share the workers.
    { timeout: 20_000, interval: 100 },
  );
}
const decide = (
  host: DeepSeekBotHost,
  approval: AppApproval,
  decision = "approved",
  scope = "once",
) =>
  host.handleMethod("permission.approval.decide", {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision,
    scope,
  });

describe("custom MCP chat", () => {
  it("returns explicit MCP tool failures and records an error without the response body", async () => {
    const f = await fixture();
    await f.grant();
    f.setResult({ isError: true, content: [{ type: "text", text: "private server failure" }] });
    const turn = await f.open();
    const call = turn.call({ text: "failure" });
    await decide(f.host, await pending(f.host));
    expect(await call).toMatchObject({ ok: true, result: { isError: true } });
    const audit = readFileSync(join(f.root, "logs", "agent-tools-audit.jsonl"), "utf8");
    const record = audit
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { tool: string; outcome: string })
      .find((item) => item.tool === "mcp_call");
    expect(record?.outcome).toBe("error");
    expect(audit).not.toContain("private server failure");
  });
  it.each(["bot-policy", "archive", "global-deny", "direct-policy"])(
    "revalidates %s changes after async discovery before side effects",
    async (change) => {
      const f = await fixture();
      await f.grant();
      const turn = await f.open();
      f.holdLists();
      const call = turn.call({ text: "must not execute after revocation" });
      await decide(f.host, await pending(f.host));
      await vi.waitFor(() => expect(f.listObserved()).toBe(true), {
        timeout: 20_000,
        interval: 100,
      });
      const bot = getBot(f.host.db, f.bot.id)!;
      if (change === "bot-policy")
        await f.host.handleMethod("bot.update", {
          id: bot.id,
          expectedRevision: bot.revision,
          patch: { toolPolicyId: "66666666-6666-4666-8666-666666666666" },
        });
      if (change === "archive")
        await f.host.handleMethod("bot.archive", { id: bot.id, expectedRevision: bot.revision });
      if (change === "global-deny")
        await f.host.handleMethod("permission.policy.set", {
          capability: "mcp.call",
          mode: "deny",
        });
      if (change === "direct-policy")
        updateToolPolicy(f.host.db, {
          id: bot.toolPolicyId,
          patch: { mcp: { enabled: false, requireApproval: true, servers: [] } },
        });
      f.releaseLists();
      expect(await call).toMatchObject({ ok: false });
      expect(f.calls).toEqual([]);
    },
  );
  it("runs the pinned Harness with the authorized schema and continues the model after approval", async () => {
    const bodies: Array<{ tools?: Array<{ name: string }>; messages?: unknown[] }> = [];
    const provider = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw) as (typeof bodies)[number];
      bodies.push(body);
      const tool =
        bodies.length === 1
          ? body.tools?.find((item) => item.name.startsWith("mcp__"))?.name
          : undefined;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const event = (type: string, data: object) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event("message_start", {
        message: {
          id: "local-mcp",
          type: "message",
          role: "assistant",
          model: "deepseek-chat",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      });
      if (tool) {
        event("content_block_start", {
          index: 0,
          content_block: { type: "tool_use", id: "mcp-local-call", name: tool, input: {} },
        });
        event("content_block_delta", {
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify({ text: "through real Harness" }),
          },
        });
      } else {
        event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        event("content_block_delta", {
          index: 0,
          delta: { type: "text_delta", text: "MCP completed after approval." },
        });
      }
      event("content_block_stop", { index: 0 });
      event("message_delta", {
        delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
        usage: { output_tokens: 8 },
      });
      event("message_stop", {});
      res.end();
    });
    servers.push(provider);
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("not listening");
    const f = await fixture(`http://127.0.0.1:${address.port}`);
    await f.grant();
    const call = f.host.handleMethod("chat.send", {
      botId: f.bot.id,
      text: "Call the authorized echo tool.",
    });
    let error: unknown;
    void call.catch((value: unknown) => {
      error = value;
    });
    const approval = await vi.waitFor(
      async () => {
        if (error) throw error;
        const list = (await f.host.handleMethod("permission.approval.list", {
          status: "pending",
        })) as { approvals: AppApproval[] };
        expect(list.approvals).toHaveLength(1);
        return list.approvals[0]!;
      },
      { timeout: 40_000, interval: 100 },
    );
    expect(f.calls).toEqual([]);
    expect(approval.params).toMatchObject({
      toolName: "echo",
      arguments: { text: "through real Harness" },
    });
    await decide(f.host, approval);
    await expect(call).resolves.toMatchObject({ text: "MCP completed after approval." });
    expect(f.calls).toHaveLength(1);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]?.messages)).toContain("local result");
    expect(bodies[0]?.tools?.filter((item) => item.name.startsWith("mcp__"))).toHaveLength(1);
  }, 60_000);
  it("discovers and exposes only the current bot's selected tools, then approves each exact call", async () => {
    const f = await fixture();
    expect((await f.open()).catalog.tools).toEqual([]);
    const discovery = (await f.host.handleMethod("connector.mcp.discover", {
      id: f.connector.id,
    })) as { tools: unknown[] };
    expect(discovery.tools).toHaveLength(2);
    await f.grant();
    const turn = await f.open();
    expect(turn.catalog.tools).toHaveLength(1);
    expect(turn.catalog.tools[0]?.parameters).toMatchObject({ required: ["text"] });
    const other = await f.newBot("other");
    expect((await f.open(other.id)).catalog.tools).toEqual([]);
    const callId = randomUUID();
    const first = turn.call({ text: "private argument" }, callId);
    const approval = await pending(f.host);
    expect(approval.capabilities).toEqual(["mcp.call"]);
    expect(approval.params).toMatchObject({
      connectorName: "Local MCP",
      toolName: "echo",
      arguments: { text: "private argument" },
    });
    expect(f.calls).toEqual([]);
    await expect(decide(f.host, approval, "approved", "permanent")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await decide(f.host, approval);
    expect(await first).toMatchObject({
      ok: true,
      result: { content: [{ type: "text", text: "local result" }] },
    });
    expect(await turn.call({ text: "private argument" }, callId)).toEqual(await first);
    expect(f.calls).toHaveLength(1);
    const again = turn.call({ text: "next" });
    const second = await pending(f.host);
    await decide(f.host, second, "denied");
    expect(await again).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED_PATH" } });
    const audit = readFileSync(join(f.root, "logs", "agent-tools-audit.jsonl"), "utf8");
    expect(audit).toContain("mcp_call");
    expect(audit).not.toContain("private argument");
    expect(audit).not.toContain("local result");
  });

  it("rejects malformed arguments before asking and cancels pending calls on disable/revoke", async () => {
    const f = await fixture();
    await f.grant();
    const turn = await f.open();
    expect(await turn.call({ text: 5 })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(await f.host.handleMethod("permission.approval.list", {})).toMatchObject({
      approvals: [],
    });
    const call = turn.call({ text: "waiting" });
    await pending(f.host);
    await f.host.handleMethod("connector.disable", { id: f.connector.id });
    expect(await call).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
    await f.host.handleMethod("connector.enable", { id: f.connector.id });
    const next = await f.open();
    const revoked = next.call({ text: "revoke" });
    await pending(f.host);
    await f.grant([]);
    expect(await revoked).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
  });

  it("cancels with the turn and stores MCP images locally without fetching resource links", async () => {
    const f = await fixture();
    await f.grant();
    const turn = await f.open();
    const cancelled = turn.call({ text: "cancel" });
    await pending(f.host);
    turn.controller.abort();
    expect(await cancelled).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
    f.setResult({
      content: [
        {
          type: "image",
          mimeType: "image/png",
          data: Buffer.from("local image bytes").toString("base64"),
        },
        { type: "resource_link", name: "remote", uri: "https://example.org/never-fetch" },
      ],
    });
    const next = await f.open();
    const result = next.call({ text: "image" });
    await decide(f.host, await pending(f.host));
    const value = (await result) as {
      result: { content: Array<{ savedPath?: string; type: string }> };
    };
    const image = value.result.content.find((block) => block.type === "image");
    expect(image?.savedPath).toBeTruthy();
    expect(readFileSync(image!.savedPath!, "utf8")).toBe("local image bytes");
    expect(value.result.content).toContainEqual({
      type: "resource_link",
      name: "remote",
      uri: "https://example.org/never-fetch",
    });
  });
});
