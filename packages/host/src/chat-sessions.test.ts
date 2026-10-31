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
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-sessions-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, FAKE_SCENARIO: "ok" }),
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
      name: "sessions-bot",
      instructions: "be helpful",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  });
  return { host, botId: bot.bot.id };
}

type ChatSessionWire = {
  sessionId: string;
  botId: string;
  title: string;
  archived: boolean;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
};

async function listSessions(
  host: DeepSeekBotHost,
  botId: string,
): Promise<ChatSessionWire[]> {
  const response = (await host.handleMethod("chat.session.list", { botId })) as {
    sessions: ChatSessionWire[];
  };
  return response.sessions;
}

describe("chat sessions (G12 多会话)", () => {
  it("keeps the default-thread behavior byte-identical and materializes its metadata", async () => {
    const { host, botId } = await hostWithBot();
    // A default send (no sessionId) — the pre-sessions wire shape.
    const sent = (await host.handleMethod("chat.send", { botId, text: "记住这条" })) as {
      sessionId: string;
      messageId: string;
      text: string;
      at: string;
    };
    expect(sent.text.length).toBeGreaterThan(0);
    // The stored rows carry the historical default id chat:<botId>.
    const defaultId = `chat:${botId}`;
    const history = (await host.handleMethod("chat.history", { botId, limit: 200 })) as {
      messages: Array<{ sessionId: string; role: string }>;
    };
    expect(history.messages.map((row) => row.sessionId)).toEqual([defaultId, defaultId]);
    // The first list materializes the default session, titled by its first
    // plain user line.
    const sessions = await listSessions(host, botId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: defaultId,
      botId,
      title: "记住这条",
      archived: false,
      messageCount: 2,
    });
  });

  it("isolates extra sessions from the default thread and orders by activity", async () => {
    const { host, botId } = await hostWithBot();
    await host.handleMethod("chat.send", { botId, text: "默认线程" });
    const created = (await host.handleMethod("chat.session.create", {
      botId,
    })) as { session: ChatSessionWire };
    expect(created.session.sessionId.startsWith("cs:")).toBe(true);
    expect(created.session.archived).toBe(false);
    await host.handleMethod("chat.send", {
      botId,
      text: "另一条线",
      sessionId: created.session.sessionId,
    });
    // The extra session's history only shows its own rows.
    const extra = (await host.handleMethod("chat.history", {
      botId,
      sessionId: created.session.sessionId,
      limit: 200,
    })) as { messages: Array<{ sessionId: string; text: string }> };
    expect(extra.messages.map((row) => row.text)).toEqual(["另一条线", expect.any(String)]);
    // The default read never leaks the extra thread.
    const fallback = (await host.handleMethod("chat.history", { botId, limit: 200 })) as {
      messages: Array<{ sessionId: string; text: string }>;
    };
    expect(fallback.messages.some((row) => row.text === "另一条线")).toBe(false);
    const sessions = await listSessions(host, botId);
    expect(sessions.map((row) => row.sessionId)).toEqual([
      created.session.sessionId,
      `chat:${botId}`,
    ]);
    expect(sessions[1]).toMatchObject({ messageCount: 2, title: "默认线程" });
    expect(sessions[0]).toMatchObject({ messageCount: 2 });
  });

  it("rejects unknown, foreign, archived and rename-after-archive writes", async () => {
    const { host, botId } = await hostWithBot();
    const created = (await host.handleMethod("chat.session.create", {
      botId,
    })) as { session: ChatSessionWire };
    // Unknown session id.
    await expect(
      host.handleMethod("chat.send", { botId, text: "x", sessionId: "cs:nope" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Archive, then every write path refuses.
    await host.handleMethod("chat.session.archive", { botId, sessionId: created.session.sessionId });
    await expect(
      host.handleMethod("chat.send", { botId, text: "x", sessionId: created.session.sessionId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("chat.session.rename", {
        botId,
        sessionId: created.session.sessionId,
        title: "again",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("chat.session.archive", { botId, sessionId: created.session.sessionId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The default session is the one thread that can never be archived.
    await expect(
      host.handleMethod("chat.session.archive", { botId, sessionId: `chat:${botId}` }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Renaming addresses an existing row: list first so the default session
    // materializes, then retitle it.
    await listSessions(host, botId);
    const renamed = (await host.handleMethod("chat.session.rename", {
      botId,
      sessionId: `chat:${botId}`,
      title: "主线",
    })) as { session: ChatSessionWire };
    expect(renamed.session.title).toBe("主线");
    expect(renamed.session.archived).toBe(false);
  });
});
