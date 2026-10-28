/**
 * Local device-action records: one accepted action, newest first, one bot.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendDeviceActionRecord,
  createBot,
  listDeviceActionRecords,
  type OpenedDatabase,
} from "../index.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "../test-support.js";

function setup(): { db: OpenedDatabase; botId: string; otherBotId: string } {
  const db = openTestDatabase(makeLayout(makeTempRoot()));
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  const now = db.now().toISOString();
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', '{}', ?, ?);",
    )
    .run(policyId, randomUUID(), now, now);
  const bot = makeBot(profile, workspaceId, { toolPolicyId: policyId });
  const other = makeBot(profile, workspaceId, { toolPolicyId: policyId, name: "另一个" });
  createBot(db, { bot });
  createBot(db, { bot: other });
  return { db, botId: bot.id, otherBotId: other.id };
}

describe("device action records", () => {
  it("stores one accepted action with its id, bot, name, and time", () => {
    const { db, botId } = setup();
    const id = randomUUID();
    const stored = appendDeviceActionRecord(db, {
      id,
      botId,
      action: "pointer",
      at: "2026-10-27T03:00:00.000Z",
    });
    expect(stored).toEqual({
      id,
      botId,
      action: "pointer",
      createdAt: "2026-10-27T03:00:00.000Z",
    });
    expect(listDeviceActionRecords(db, { botId, limit: 20 })).toEqual([stored]);
    db.close();
  });

  it("rejects an unknown action name and a missing bot before a row exists", () => {
    const { db, botId } = setup();
    expect(() =>
      appendDeviceActionRecord(db, {
        id: randomUUID(),
        botId,
        action: "click",
        at: "2026-10-27T03:00:00.000Z",
      }),
    ).toThrow(/unknown/);
    expect(() =>
      appendDeviceActionRecord(db, {
        id: randomUUID(),
        botId: randomUUID(),
        action: "key",
        at: "2026-10-27T03:00:00.000Z",
      }),
    ).toThrow(/referenced entity does not exist/);
    expect(listDeviceActionRecords(db, { botId, limit: 20 })).toEqual([]);
    db.close();
  });

  it("lists one bot's records newest first", () => {
    const { db, botId, otherBotId } = setup();
    const older = appendDeviceActionRecord(db, {
      id: randomUUID(),
      botId,
      action: "pointer",
      at: "2026-10-27T03:00:00.000Z",
    });
    const newer = appendDeviceActionRecord(db, {
      id: randomUUID(),
      botId,
      action: "key",
      at: "2026-10-27T03:00:01.000Z",
    });
    const hidden = appendDeviceActionRecord(db, {
      id: randomUUID(),
      botId: otherBotId,
      action: "pointer",
      at: "2026-10-27T03:00:02.000Z",
    });
    expect(listDeviceActionRecords(db, { botId, limit: 20 }).map((row) => row.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(listDeviceActionRecords(db, { botId: otherBotId, limit: 20 })).toEqual([hidden]);
    expect(listDeviceActionRecords(db, { botId, limit: 1 })).toEqual([newer]);
    db.close();
  });
});