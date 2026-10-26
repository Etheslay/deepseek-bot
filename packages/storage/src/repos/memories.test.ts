import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import { createBot } from "./bots.js";
import { deleteMemory, listMemories, writeMemory } from "./memories.js";

function tempDb(): { db: OpenedDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-memory-"));
  const db = openDatabase(join(root, "app.sqlite"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function seedBot(db: OpenedDatabase, name: string): string {
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
    .run(workspaceId, join(tmpdir(), `dsb-memory-ws-${name}`), now, now);
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(policyId, randomUUID(), "{}", now, now);
  return createBot(db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name,
      instructions: "remember locally",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  }).bot.id;
}

describe("memory repository", () => {
  it("keeps a trimmed note on one bot and hides it from every other bot", () => {
    const { db, cleanup } = tempDb();
    try {
      const owner = seedBot(db, "owner");
      const other = seedBot(db, "other");
      const secret = "Private note Alpha";
      const saved = writeMemory(db, { botId: owner, text: `  ${secret}  ` });
      expect(saved).toMatchObject({ botId: owner, text: secret });
      expect(listMemories(db, { botId: owner, query: "alpha" }).map((row) => row.id)).toEqual([
        saved.id,
      ]);
      expect(listMemories(db, { botId: other, query: "alpha" })).toEqual([]);
      expect(listMemories(db, { botId: other })).toEqual([]);
      expect(() => deleteMemory(db, { botId: other, memoryId: saved.id })).toThrow(/not found/);
      expect(listMemories(db, { botId: owner }).map((row) => row.text)).toEqual([secret]);
      deleteMemory(db, { botId: owner, memoryId: saved.id });
      expect(listMemories(db, { botId: owner })).toEqual([]);
      expect(() => writeMemory(db, { botId: owner, text: "   " })).toThrow(/4000/);
      const older = writeMemory(db, { botId: owner, text: "older note" });
      const newer = writeMemory(db, { botId: owner, text: "newer note" });
      expect(listMemories(db, { botId: owner, limit: 1 }).map((row) => row.id)).toEqual([newer.id]);
      expect(listMemories(db, { botId: owner, query: "" }).map((row) => row.id)).toEqual([
        newer.id,
        older.id,
      ]);
    } finally {
      cleanup();
    }
  });
});
