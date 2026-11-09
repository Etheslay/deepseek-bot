import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { updateToolPolicy } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startApplicationToolServer, type ApplicationToolServer } from "./app-tool-channel.js";

const hosts: DeepSeekBotHost[] = [];
const toolServers: ApplicationToolServer[] = [];
const searches: Server[] = [];
const roots: string[] = [];
const query = "private research question";

afterEach(async () => {
  for (const server of toolServers.splice(0)) await server.close();
  for (const server of searches.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function searchEndpoint() {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    requests.push(body);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        results: [
          {
            title: "<img src=x onerror=alert(1)>Private title",
            url: "https://example.org/report",
            content: "Private snippet",
          },
        ],
      }),
    );
  });
  searches.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server not listening");
  return { endpoint: `http://127.0.0.1:${address.port}/search`, requests };
}

async function setup(endpoint?: string) {
  const root = mkdtempSync(join(tmpdir(), "dsb-web-search-chat-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "unused",
    ...(endpoint !== undefined ? { webSearch: { endpoint } } : {}),
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "researcher",
    instructions: "research",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  const server = await startApplicationToolServer(host.agentTools, {
    networkPermissions: host.chatNetworkPermissions,
  });
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

async function allowSearch(host: DeepSeekBotHost) {
  await host.handleMethod("permission.policy.set", { capability: "network.search", mode: "allow" });
}

describe("chat web_search", () => {
  it("keeps web_search off the eight-tool route and shows a configured result", async () => {
    const { endpoint, requests } = await searchEndpoint();
    const { host, request, bot, sessionId } = await setup();
    const catalog = (await (await request("/app-tools")).json()) as { tools: Array<{ name: string }> };
    expect(catalog.tools).toHaveLength(17); // chat schedules, learned skills, and read_workspace_file
    expect(catalog.tools.map((tool) => tool.name)).not.toContain("web_search");
    expect(
      await (
        await request("/app-tools/call", {
          sessionId,
          callId: randomUUID(),
          tool: "web_search",
          params: { query },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(requests).toHaveLength(0);

    await expect(
      host.handleMethod("search.config.set", { endpoint: "http://example.com/search" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await host.handleMethod("search.config.set", { endpoint });
    expect(await host.handleMethod("search.config.get", {})).toEqual({ endpoint });

    expect(
      await (
        await request("/web-search/call", {
          sessionId,
          callId: randomUUID(),
          tool: "web_search",
          params: { query, endpoint, networkPermissions: { authorize: true } },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(requests).toHaveLength(0);

    await allowSearch(host);
    const response = await (
      await request("/web-search/call", {
        sessionId,
        callId: randomUUID(),
        tool: "web_search",
        params: { query },
      })
    ).json();
    expect(response).toMatchObject({
      ok: true,
      result: {
        provider: "searxng",
        query,
        results: [{ title: "Private title", url: "https://example.org/report", snippet: "Private snippet" }],
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toContain("networkPermissions");
    expect(await host.handleMethod("search.results.list", { botId: bot.id })).toMatchObject({
      searches: [{ query, results: [{ title: "Private title" }] }],
    });
    const other = (await host.handleMethod("bot.create", {
      name: "other",
      instructions: "other",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    expect(await host.handleMethod("search.results.list", { botId: other.id })).toEqual({ searches: [] });
    expect(await host.handleMethod("chat.history", { botId: bot.id })).toMatchObject({
      messages: [{ role: "assistant", text: expect.stringContaining("Private title") }],
    });
    const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).not.toContain(query);
    expect(audit).not.toContain("Private snippet");
  });

  it("blocks the request when the bot network policy is disabled or approval-only", async () => {
    const { endpoint, requests } = await searchEndpoint();
    const { host, request, sessionId } = await setup(endpoint);
    await allowSearch(host);
    updateToolPolicy(host.db, {
      id: "66666666-6666-4666-8666-666666666666",
      patch: { network: { mode: "disabled" } },
    });
    expect(
      await (
        await request("/web-search/call", {
          sessionId,
          callId: randomUUID(),
          tool: "web_search",
          params: { query },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED_PATH" } });
    updateToolPolicy(host.db, {
      id: "66666666-6666-4666-8666-666666666666",
      patch: { network: { mode: "approval-required" } },
    });
    expect(
      await (
        await request("/web-search/call", {
          sessionId,
          callId: randomUUID(),
          tool: "web_search",
          params: { query },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
    expect(requests).toHaveLength(0);
  });

  it("waits for the D16 search grant before contacting SearXNG", async () => {
    const { endpoint, requests } = await searchEndpoint();
    const { host, request, sessionId } = await setup(endpoint);
    await host.handleMethod("permission.policy.set", { capability: "network.search", mode: "ask" });
    const pending = request("/web-search/call", {
      sessionId,
      callId: randomUUID(),
      tool: "web_search",
      params: { query },
    });
    const approval = await vi.waitFor(async () => {
      const listed = (await host.handleMethod("permission.approval.list", {})) as {
        approvals: AppApproval[];
      };
      expect(listed.approvals).toHaveLength(1);
      return listed.approvals[0]!;
    });
    expect(requests).toHaveLength(0);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    expect(await (await pending).json()).toMatchObject({ ok: true, result: { query } });
    expect(requests).toHaveLength(1);
  });

  it("keeps a saved endpoint across restart and lets a clear beat the startup value", async () => {
    const { endpoint } = await searchEndpoint();
    const root = mkdtempSync(join(tmpdir(), "dsb-web-search-chat-"));
    roots.push(root);
    const first = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "unused",
    });
    hosts.push(first);
    await first.handleMethod("search.config.set", { endpoint });
    await first.shutdown();
    const second = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "unused",
    });
    hosts.push(second);
    expect(await second.handleMethod("search.config.get", {})).toEqual({ endpoint });
    await second.handleMethod("search.config.set", { endpoint: null });
    await second.shutdown();
    const third = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "unused",
      webSearch: { endpoint },
    });
    hosts.push(third);
    expect(await third.handleMethod("search.config.get", {})).toEqual({ endpoint: null });
  });
});
