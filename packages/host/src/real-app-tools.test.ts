/** Real pinned Harness + local Messages API; no third-party network or paid API. */
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { createHost, type DeepSeekBotHost } from "./host.js";

const APP_TOOLS = [
  "list_bots",
  "list_groups",
  "get_run",
  "get_run_events",
  "create_bot_draft",
  "create_group",
  "create_bots_batch",
  "revoke_batch",
];
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function streamMessage(
  response: ServerResponse,
  tool: "list_groups" | "create_group" | undefined,
): void {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type: string, body: object) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
  event("message_start", {
    message: {
      id: "msg-local",
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
      content_block: { type: "tool_use", id: `local-${tool}`, name: tool, input: {} },
    });
    event("content_block_delta", {
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(
          tool === "create_group" ? { name: "local controlled group" } : {},
        ),
      },
    });
  } else {
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: "Group created after human approval." },
    });
  }
  event("content_block_stop", { index: 0 });
  event("message_delta", {
    delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: 12 },
  });
  event("message_stop", {});
  response.end();
}

async function localProvider() {
  const bodies: Array<{
    tools?: Array<{ name: string; description?: string }>;
    messages?: unknown[];
  }> = [];
  const server = createServer((request, response) => {
    void (async () => {
      let raw = "";
      for await (const part of request) raw += String(part);
      if (request.url !== "/v1/messages") {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as (typeof bodies)[number];
      bodies.push(body);
      streamMessage(
        response,
        bodies.length === 1 ? "list_groups" : bodies.length === 2 ? "create_group" : undefined,
      );
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("provider did not bind");
  return { endpoint: `http://127.0.0.1:${address.port}`, bodies };
}

describe("real Harness application tools", () => {
  it("loads eight gateway tools, waits for exact approval, writes once and returns the result to the model", async () => {
    const provider = await localProvider();
    const root = mkdtempSync(join(tmpdir(), "dsb-real-app-tools-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const host: DeepSeekBotHost = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "sk-local-controlled-provider-only",
      childEnv: (parent) => ({ ...parent, DEEPSEEK_BASE_URL: provider.endpoint }),
    });
    cleanup.push(() => host.shutdown());
    await host.handleMethod("permission.policy.set", { capability: "app.create_group", mode: "ask" });
    const bot = (await host.handleMethod("bot.create", {
      name: "local integration bot",
      instructions: "Use create_group to create the requested group, then report its result.",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    const call = host.handleMethod("chat.send", {
      botId: bot.id,
      text: "Create local controlled group.",
    });
    // Attach a rejection handler while polling, so startup errors remain useful.
    let failed: unknown;
    void call.catch((error: unknown) => {
      failed = error;
    });
    let approval: AppApproval | undefined;
    await vi.waitFor(
      async () => {
        if (failed !== undefined) throw failed;
        const result = (await host.handleMethod("permission.approval.list", { botId: bot.id })) as {
          approvals: AppApproval[];
        };
        approval = result.approvals.find((item) => item.status === "pending");
        expect(approval).toBeDefined();
      },
      { timeout: 40_000, interval: 100 },
    );
    const names = provider.bodies[0]?.tools?.map((tool) => tool.name) ?? [];
    expect(names.filter((name) => APP_TOOLS.includes(name)).sort()).toEqual([...APP_TOOLS].sort());
    expect(provider.bodies[0]?.tools?.find((tool) => tool.name === "web_search")?.description).toContain(
      "SearXNG",
    );
    expect(names.some((name) => name.startsWith("permission."))).toBe(false);
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
    expect(approval?.params).toEqual({ name: "local controlled group" });
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval!.id,
      expectedActionDigest: approval!.actionDigest,
      decision: "approved",
      scope: "once",
    });
    await expect(call).resolves.toMatchObject({ text: "Group created after human approval." });
    const groups = (await host.handleMethod("group.list", {})) as {
      groups: Array<{ name: string }>;
    };
    expect(groups.groups.map((group) => group.name)).toEqual(["local controlled group"]);
    expect(provider.bodies).toHaveLength(3);
    expect(JSON.stringify(provider.bodies[1]?.messages)).toContain('\\"groups\\":[]');
    expect(JSON.stringify(provider.bodies[2]?.messages)).toContain("local controlled group");
    const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).toContain("create_group");
    expect(audit).not.toContain("local controlled group");
  }, 60_000);
});
