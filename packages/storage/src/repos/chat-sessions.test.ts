import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import { createBot } from "./bots.js";
import { appendChatMessage } from "./chat.js";
import {
  archiveChatSession,
  chatSessionMessageCount,
  createChatSession,
  defaultChatSessionId,
  ensureDefaultChatSession,
  getChatSession,
  listChatSessions,
  newChatSessionId,
  renameChatSession,
  touchChatSession,
} from "./chat-sessions.js";

function tempDb(now?: () => Date): { db: OpenedDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-sessions-"));
  const db = openDatabase(join(root, "app.sqlite"), now ? { now } : undefined);
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
    .run(workspaceId, join(tmpdir(), "dsb-chat-sessions-ws"), now, now);
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
      name: "sessions-bot",
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

describe("chat session repository (G12)", () => {
  it("materializes the default session under the historical chat:<botId> id", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      // Rows written the pre-sessions way already carry the default id.
      appendChatMessage(db, { botId, sessionId: defaultChatSessionId(botId), role: "user", text: "你好" });
      const session = ensureDefaultChatSession(db, botId);
      expect(session.id).toBe(defaultChatSessionId(botId));
      // The default row materializes untitled; display titles derive at read
      // time and a rename writes the definitive one.
      expect(session.title).toBe("");
      // Idempotent: the second ensure returns the same row untouched.
      expect(ensureDefaultChatSession(db, botId).id).toBe(session.id);
      expect(chatSessionMessageCount(db, botId, session.id)).toBe(1);
      expect(listChatSessions(db, botId).map((row) => row.id)).toEqual([session.id]);
    } finally {
      cleanup();
    }
  });

  it("lists extra sessions newest-activity-first and keeps them per bot", () => {
    // Stamps are ISO at millisecond precision; a fast host runs this whole
    // scenario inside one millisecond, so the closing touch tied with the
    // extra session's creation stamp and the rowid tiebreak reordered the
    // list (first seen on CI 2026-11-01). A stepped clock gives every write
    // its own second, so the assertion below tests the ORDER BY rather than
    // the host's timer resolution.
    let step = 0;
    const { db, cleanup } = tempDb(() => new Date(Date.UTC(2026, 0, 1, 0, 0, step++)));
    try {
      const a = seedBot(db);
      const b = seedBot(db);
      const aDefault = ensureDefaultChatSession(db, a);
      const extra = createChatSession(db, { botId: a, title: "extra" });
      expect(extra.id.startsWith("cs:")).toBe(true);
      expect(newChatSessionId()).not.toBe(extra.id);
      createChatSession(db, { botId: b, title: "b-only" });
      touchChatSession(db, a, aDefault.id);
      const aSessions = listChatSessions(db, a);
      expect(aSessions.map((row) => row.id)).toEqual([aDefault.id, extra.id]);
      // The tiebreak is load-bearing when two stamps do collide: equal
      // last_message_at falls back to the rowid order (newer row first)
      // deterministically, never to scan luck.
      db.raw
        .prepare("UPDATE chat_sessions SET last_message_at = ? WHERE bot_id = ?;")
        .run("2026-01-01T00:09:00.000Z", a);
      expect(listChatSessions(db, a).map((row) => row.id)).toEqual([extra.id, aDefault.id]);
      // The other bot's session never leaks in.
      expect(listChatSessions(db, b)).toHaveLength(1);
      expect(getChatSession(db, b, extra.id)).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("rename retitles, archive stamps archived_at as read-only", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      const session = createChatSession(db, { botId, title: "新的会话" });
      expect(renameChatSession(db, botId, session.id, "周报").title).toBe("周报");
      const archived = archiveChatSession(db, botId, session.id);
      expect(archived.archivedAt).not.toBeNull();
      expect(getChatSession(db, botId, session.id)?.archivedAt).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
