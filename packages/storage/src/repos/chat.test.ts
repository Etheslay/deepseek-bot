import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import { createBot } from "./bots.js";
import {
  appendChatMessage,
  listChatMessages,
  listChatMessagesAfter,
  listRecentChatMessages,
} from "./chat.js";

function tempDb(): { db: OpenedDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-"));
  const db = openDatabase(join(root, "app.sqlite"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function seedBot(db: OpenedDatabase): string {
  const now = db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const profileId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  const workspaceId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, join(tmpdir(), "dsb-chat-ws"), now, now);
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(policyId, randomUUID(), "{}", now, now);
  const bot = createBot(db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "chat-bot",
      instructions: "be helpful",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  });
  return bot.bot.id;
}

describe("chat message repository", () => {
  it("appends and lists messages in order", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      const sessionId = `chat:${botId}`;
      const user = appendChatMessage(db, { botId, sessionId, role: "user", text: "你好" });
      const assistant = appendChatMessage(db, {
        botId,
        sessionId,
        role: "assistant",
        text: "你好，我在。",
      });
      const rows = listChatMessages(db, botId);
      expect(rows.map((row) => row.id)).toEqual([user.id, assistant.id]);
      expect(rows[0]).toMatchObject({ role: "user", text: "你好" });
      expect(rows[1]).toMatchObject({ role: "assistant", text: "你好，我在。" });
    } finally {
      cleanup();
    }
  });

  it("respects the limit and isolates bots", () => {
    const { db, cleanup } = tempDb();
    try {
      const a = seedBot(db);
      const b = seedBot(db);
      for (let i = 0; i < 5; i += 1) {
        appendChatMessage(db, { botId: a, sessionId: `chat:${a}`, role: "user", text: `a${i}` });
      }
      appendChatMessage(db, { botId: b, sessionId: `chat:${b}`, role: "user", text: "b0" });
      expect(listChatMessages(db, a, 3)).toHaveLength(3);
      expect(listChatMessages(db, a, 3).map((row) => row.text)).toEqual(["a0", "a1", "a2"]);
      expect(listChatMessages(db, b).map((row) => row.text)).toEqual(["b0"]);
    } finally {
      cleanup();
    }
  });

  it("reads the newest rows and the rows after a watermark", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      const sessionId = `chat:${botId}`;
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(appendChatMessage(db, { botId, sessionId, role: "user", text: `m${i}` }).id);
      }
      expect(listRecentChatMessages(db, botId, 2, sessionId).map((row) => row.text)).toEqual([
        "m3",
        "m4",
      ]);
      expect(listChatMessagesAfter(db, botId, sessionId, ids[1]!, 10)?.map((row) => row.text)).toEqual([
        "m2",
        "m3",
        "m4",
      ]);
      expect(listChatMessagesAfter(db, botId, sessionId, ids[1]!, 1)?.map((row) => row.text)).toEqual([
        "m4",
      ]);
      expect(listChatMessagesAfter(db, botId, sessionId, "missing", 10)).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("lists one session and returns message meta", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      const sessionId = `chat:${botId}`;
      const taskId = randomUUID();
      appendChatMessage(db, {
        botId,
        sessionId,
        role: "assistant",
        text: "交给你了",
        meta: { kind: "dispatch", taskId, fromBotId: botId },
      });
      appendChatMessage(db, {
        botId,
        sessionId: `cs:${randomUUID()}`,
        role: "user",
        text: "另一会话",
      });
      const rows = listChatMessages(db, botId, 10, sessionId);
      expect(rows.map((row) => row.text)).toEqual(["交给你了"]);
      expect(rows[0]?.meta).toEqual({ kind: "dispatch", taskId, fromBotId: botId });
    } finally {
      cleanup();
    }
  });
});
