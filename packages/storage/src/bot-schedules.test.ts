import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "./database.js";
import {
  BOT_MESSAGE_SCHEDULE_LIMIT,
  cancelBotMessageSchedule,
  listBotMessageSchedules,
  saveBotMessageSchedule,
} from "./repos/bot-schedules.js";

function tempDb(): { db: OpenedDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-bot-schedule-"));
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
    .run(workspaceId, join(tmpdir(), "dsb-bot-schedule-ws"), now, now);
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) " +
        "VALUES (?, ?, 'p', '{}', ?, ?);",
    )
    .run(policyId, randomUUID(), now, now);
  const botId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO bots (id, revision, name, instructions, model_profile_id, workspace_id, tool_policy_id, " +
        "role, archived_at, created_at, updated_at) VALUES (?, ?, 'bot', 'hi', ?, ?, ?, 'standard', NULL, ?, ?);",
    )
    .run(botId, randomUUID(), profileId, workspaceId, policyId, now, now);
  return botId;
}

const draft = {
  message: "你好",
  timezone: "UTC",
  recurrence: "0 17 * * *",
  hour: 17,
  minute: 0,
  days: "every" as const,
  nextRunAt: "2026-11-09T17:00:00.000Z",
};

describe("bot message schedules", () => {
  it("keeps one row for the same clock and refuses another bot's cancel", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      const other = seedBot(db);
      const first = saveBotMessageSchedule(db, { botId, ...draft });
      const again = saveBotMessageSchedule(db, { botId, ...draft });
      expect(again.created).toBe(false);
      expect(again.schedule.id).toBe(first.schedule.id);
      expect(listBotMessageSchedules(db, botId, { enabledOnly: true })).toHaveLength(1);
      expect(cancelBotMessageSchedule(db, other, first.schedule.id)).toBe(false);
      expect(cancelBotMessageSchedule(db, botId, first.schedule.id)).toBe(true);
      expect(listBotMessageSchedules(db, botId, { enabledOnly: true })).toHaveLength(0);
      const restored = saveBotMessageSchedule(db, { botId, ...draft });
      expect(restored.created).toBe(false);
      expect(restored.schedule.enabled).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("stops at the per-bot limit", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db);
      for (let hour = 0; hour < BOT_MESSAGE_SCHEDULE_LIMIT; hour += 1) {
        saveBotMessageSchedule(db, { botId, ...draft, hour, message: `m${hour}` });
      }
      expect(() => saveBotMessageSchedule(db, { botId, ...draft, message: "extra" })).toThrow(
        /maximum/,
      );
    } finally {
      cleanup();
    }
  });
});
