import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { createBot } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);
const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function hostWithBot(
  scenario = "ok",
  resolveApiKey: () => Promise<string> = async () => "sk-test-only",
  extraEnv: Record<string, string> = {},
): Promise<{ host: DeepSeekBotHost; botId: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-runtime-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey,
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, ...extraEnv, FAKE_SCENARIO: scenario }),
  });
  hosts.push(host);
  const now = host.db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  host.db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const profileId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  const workspaceId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, join(root, "ws"), now, now);
  mkdirSync(join(root, "ws"), { recursive: true });
  const policyId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(
      policyId,
      randomUUID(),
      JSON.stringify({
        filesystem: { enabled: false, operations: [] },
        shell: { mode: "disabled" },
        network: { mode: "disabled" },
        mcp: { enabled: false, requireApproval: false, servers: [] },
      }),
      now,
      now,
    );
  const bot = createBot(host.db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "chat-bot",
      instructions: "be brief",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  });
  return { host, botId: bot.bot.id };
}

describe("chat runtime", () => {
  it("prepares MCP discovery before starting Harness and cancels preparation with the turn", async () => {
    const records = mkdtempSync(join(tmpdir(), "dsb-mcp-preparation-"));
    roots.push(records);
    let listing = false;
    const server = createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const rpc = JSON.parse(body) as { id?: number; method: string };
      if (rpc.method === "tools/list") {
        listing = true;
        return;
      }
      if (rpc.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "slow", version: "1" },
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("not listening");
      const { host, botId } = await hostWithBot("ok", async () => "unused", {
        FAKE_RECORD_DIR: records,
      });
      const connector = (await host.handleMethod("connector.register", {
        name: "slow",
        kind: "mcp-http",
        endpoint: `http://127.0.0.1:${address.port}/mcp`,
      })) as { id: string };
      await host.handleMethod("connector.enable", { id: connector.id });
      await host.handleMethod("connector.mcp.grants.set", {
        botId,
        id: connector.id,
        allowedTools: ["echo"],
      });
      const sent = host.handleMethod("chat.send", { botId, text: "prepare" });
      let settled = false;
      void sent.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.waitFor(() => expect(listing || settled).toBe(true));
      expect(listing).toBe(true);
      expect(existsSync(join(records, "fake-harness.jsonl"))).toBe(false);
      const cancelled = expect(sent).rejects.toMatchObject({ code: "CANCELLED" });
      await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` });
      await cancelled;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("keeps an application tool call waiting for approval and returns its actual result to Harness", async () => {
    const { host, botId } = await hostWithBot("app-tool");
    const sent = host.handleMethod("chat.send", { botId, text: "create group" });
    let approvals: AppApproval[] = [];
    await vi.waitFor(async () => {
      ({ approvals } = (await host.handleMethod("permission.approval.list", { botId })) as {
        approvals: AppApproval[];
      });
      expect(approvals).toHaveLength(1);
    });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
    const approval = approvals[0]!;
    expect(approval.sessionId).toBe(`chat:${botId}`);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    expect(await sent).toMatchObject({ text: expect.stringContaining('"name":"from Harness"') });
    expect(
      ((await host.handleMethod("group.list", {})) as { groups: unknown[] }).groups,
    ).toHaveLength(1);
  });
  it("cancels a pending application tool without leaving an approval or write", async () => {
    const { host, botId } = await hostWithBot("app-tool");
    const sent = host.handleMethod("chat.send", { botId, text: "cancel this write" });
    const cancelled = expect(sent).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(async () =>
      expect(
        (
          (await host.handleMethod("permission.approval.list", { botId })) as {
            approvals: unknown[];
          }
        ).approvals,
      ).toHaveLength(1),
    );
    expect(await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` })).toEqual({
      cancelled: true,
    });
    await cancelled;
    expect(await host.handleMethod("permission.approval.list", { botId })).toEqual({
      approvals: [],
    });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("can cancel while credential resolution is still pending", async () => {
    let release!: (value: string) => void;
    const credential = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { host, botId } = await hostWithBot("ok", () => credential);
    let failure: unknown;
    const sent = host
      .handleMethod("chat.send", { botId, text: "cancel before start" })
      .catch((error) => {
        failure = error;
      });
    await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` });
    try {
      await vi.waitFor(() => expect(failure).toMatchObject({ code: "CANCELLED" }));
    } finally {
      release("unused");
      await sent;
    }
  });
  it("sends a turn through the harness and persists both sides", async () => {
    const { host, botId } = await hostWithBot();
    const sent = (await host.handleMethod("chat.send", {
      botId,
      text: "你好",
    })) as { sessionId: string; text: string; messageId: string; at: string };
    expect(sent.sessionId.startsWith(`chat:${botId}`)).toBe(true);
    expect(sent.text).toBe("fake final response");
    const history = (await host.handleMethod("chat.history", { botId })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history.messages[1]?.text).toBe("fake final response");
  });

  it("replays history as context because each turn opens a fresh session", async () => {
    const { host, botId } = await hostWithBot();
    const first = (await host.handleMethod("chat.send", { botId, text: "one" })) as {
      sessionId: string;
    };
    const second = (await host.handleMethod("chat.send", { botId, text: "two" })) as {
      sessionId: string;
    };
    expect(second.sessionId).not.toBe(first.sessionId);
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("rejects unknown bots and reports cancel state", async () => {
    const { host } = await hostWithBot();
    await expect(
      host.handleMethod("chat.send", { botId: randomUUID(), text: "hi" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const cancelled = (await host.handleMethod("chat.cancel", {
      sessionId: "chat:nope",
    })) as { cancelled: boolean };
    expect(cancelled.cancelled).toBe(false);
  });
});
