import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
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

async function hostWithBot(): Promise<{ host: DeepSeekBotHost; botId: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-runtime-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
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
      archivedAt: null,
    },
  });
  return { host, botId: bot.bot.id };
}

describe("chat runtime", () => {
  it("sends a turn through the harness and persists both sides", async () => {
    const { host, botId } = await hostWithBot();
    const sent = (await host.handleMethod("chat.send", {
      botId,
      text: "你好",
    })) as { sessionId: string; text: string; messageId: string; at: string };
    expect(sent.sessionId).toBe(`chat:${botId}`);
    expect(sent.text).toBe("fake final response");
    const history = (await host.handleMethod("chat.history", { botId })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history.messages[1]?.text).toBe("fake final response");
  });

  it("keeps one session per bot across turns", async () => {
    const { host, botId } = await hostWithBot();
    await host.handleMethod("chat.send", { botId, text: "one" });
    await host.handleMethod("chat.send", { botId, text: "two" });
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: Array<{ sessionId: string }>;
    };
    expect(history.messages).toHaveLength(4);
    expect(new Set(history.messages.map((m) => m.sessionId)).size).toBe(1);
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

