import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowEngine } from "@deepseek-bot/runtime";
import {
  getRun,
  getToolPolicy,
  listApprovals,
  listEvents,
  updateToolPolicy,
} from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
const servers: Server[] = [];
const query = "private research question";

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
          { title: "Private title", url: "https://example.org/report", content: "Private result" },
        ],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server not listening");
  return { endpoint: `http://127.0.0.1:${address.port}/search`, requests };
}

async function makeHost(endpoint?: string, resolveApiKey?: (credentialRef: string) => Promise<string>) {
  const root = mkdtempSync(join(tmpdir(), "dsb-web-search-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: resolveApiKey ?? (async () => "unused"),
    ...(endpoint !== undefined ? { webSearch: { endpoint } } : {}),
  });
  hosts.push(host);
  // These tests exercise the independent D08 network boundary. Supply the
  // trusted D16 actor and explicit human policy before reaching that boundary.
  await host.handleMethod("permission.policy.set", { capability: "network.search", mode: "allow" });
  await host.handleMethod("bot.create", {
    name: "search actor", instructions: "Research",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  });
  return host;
}

function searchCaller(host: DeepSeekBotHost) {
  const bot = host.db.raw.prepare("SELECT id FROM bots LIMIT 1").get() as { id: string };
  return { id: "chat:one", botId: bot.id, sessionId: "search-session" };
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Host web_search", () => {
  it("registers web_search and still requires a permission handle when no address is set", async () => {
    const host = await makeHost();
    expect(host.agentTools.capabilities.list().map((tool) => tool.name)).toContain("web_search");
    await expect(
      host.agentTools.call(searchCaller(host), "web_search", { query }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("does not call the network when the saved API key cannot be read", async () => {
    const host = await makeHost(undefined, async () => {
      throw new Error("ENOENT: /secret/credentials/key.blob");
    });
    const authorize = vi.fn(async () => undefined);
    await expect(
      host.agentTools.call(searchCaller(host), "web_search", { query }, {
        networkPermissions: { authorize },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE", message: "API key is not configured" });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("requires a trusted permission handle even with an endpoint configured", async () => {
    const { endpoint, requests } = await searchEndpoint();
    const host = await makeHost(endpoint);
    await expect(
      host.agentTools.call(searchCaller(host), "web_search", { query }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(requests).toHaveLength(0);
  });

  it.each(["allowed", "disabled", "approval-required"] as const)(
    "honors the real D08 network policy: %s",
    async (mode) => {
      const { endpoint, requests } = await searchEndpoint();
      const host = await makeHost(endpoint);
      const refs = host.db.raw.prepare("SELECT id FROM model_profiles LIMIT 1").get() as {
        id: string;
      };
      const workspace = host.db.raw.prepare("SELECT id FROM workspaces LIMIT 1").get() as {
        id: string;
      };
      const policy = host.db.raw.prepare("SELECT id FROM tool_policies LIMIT 1").get() as {
        id: string;
      };
      updateToolPolicy(host.db, { id: policy.id, patch: { network: { mode } } });
      const bot = (await host.handleMethod("bot.create", {
        name: "search bot",
        instructions: "Research",
        modelProfileId: refs.id,
        workspaceId: workspace.id,
        toolPolicyId: policy.id,
      })) as { id: string };
      const workflow = (await host.handleMethod("workflow.save", {
        workflow: {
          id: randomUUID(),
          revision: randomUUID(),
          name: "search",
          schemaVersion: "0.1",
          nodes: [
            {
              id: "search",
              type: "bot",
              botId: bot.id,
              instructionTemplate: "Research",
              inputBindings: [],
              retryPolicy: { maxRetries: 0 },
            },
          ],
          edges: [],
          limits: { maxConcurrentNodes: 1 },
        },
      })) as { id: string };
      const engine = new WorkflowEngine({
        db: host.db,
        bootGeneration: host.bootGeneration,
        executor: {
          async executeBotNode(context) {
            const result = await host.agentTools.call(
              { id: `run:${context.run.id}`, botId: bot.id, sessionId: context.run.id },
              "web_search",
              { query },
              {
                signal: context.signal,
                networkPermissions: context.permissions,
              },
            );
            return { outputs: { result } };
          },
        },
      });
      const { run } = engine.startRun({
        workflowId: workflow.id,
        trigger: { kind: "manual", idempotencyKey: randomUUID() },
      });
      if (mode === "approval-required") {
        await vi.waitFor(() => expect(getRun(host.db, run.id)?.status).toBe("waiting_approval"));
        expect(requests).toHaveLength(0);
        const approval = listApprovals(host.db, { runId: run.id, status: "pending" })[0]!;
        expect(approval.resource).toBe(endpoint);
        const requested = listEvents(host.db, run.id).find(
          (event) => event.type === "tool.requested",
        );
        expect(requested?.payload).toMatchObject({
          toolName: "web_search",
          arguments: { method: "POST", query, maxResults: 5 },
        });
        engine.decideApproval(approval.id, "approved", approval.actionDigest);
      }
      await vi.waitFor(() =>
        expect(getRun(host.db, run.id)?.status).toBe(mode === "disabled" ? "failed" : "succeeded"),
      );
      expect(requests).toHaveLength(mode === "disabled" ? 0 : 1);
      const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
      expect(audit).not.toContain(query);
      expect(audit).not.toContain("Private result");
      expect(JSON.parse(audit.trim())).toMatchObject({
        tool: "web_search",
        outcome: mode === "disabled" ? "error" : "ok",
      });
    },
  );

  it("rejects calls after Host shutdown", async () => {
    const { endpoint, requests } = await searchEndpoint();
    const host = await makeHost(endpoint);
    await host.shutdown();
    await expect(
      host.agentTools.call(
        { id: "chat:one" },
        "web_search",
        { query },
        {
          networkPermissions: { authorize: async () => undefined },
        },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect(requests).toHaveLength(0);
  });

  it("repairs only the legacy default network literal and preserves a valid user setting on restart", async () => {
    const host = await makeHost();
    const policy = host.db.raw
      .prepare("SELECT id FROM tool_policies WHERE name = 'default'")
      .get() as { id: string };
    expect(getToolPolicy(host.db, policy.id)?.network.mode).toBe("allowed");
    host.db.raw
      .prepare(
        "UPDATE tool_policies SET policy_json = json_set(policy_json, '$.network.mode', 'allow', '$.shell.mode', 'approval') WHERE id = ?",
      )
      .run(policy.id);
    await host.shutdown();
    const reopened = await createHost({ dataRoot: roots[0]!, resolveApiKey: async () => "unused" });
    hosts.push(reopened);
    expect(getToolPolicy(reopened.db, policy.id)?.network.mode).toBe("allowed");
    expect(getToolPolicy(reopened.db, policy.id)?.shell.mode).toBe("approval-required");
    updateToolPolicy(reopened.db, {
      id: policy.id,
      patch: { network: { mode: "disabled" }, shell: { mode: "disabled" } },
    });
    await reopened.shutdown();
    const again = await createHost({ dataRoot: roots[0]!, resolveApiKey: async () => "unused" });
    hosts.push(again);
    expect(getToolPolicy(again.db, policy.id)?.network.mode).toBe("disabled");
    expect(getToolPolicy(again.db, policy.id)?.shell.mode).toBe("disabled");
  });
});
