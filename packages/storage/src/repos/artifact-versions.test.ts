/**
 * Artifact version repository tests (D28, migration 0010).
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  countArtifactVersions,
  getArtifactVersion,
  getArtifactVersionContentPath,
  insertArtifactVersion,
  latestArtifactVersion,
  listArtifactVersions,
  nextArtifactRevision,
  pruneArtifactVersions,
} from "./artifact-versions.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "../test-support.js";
import type { OpenedDatabase } from "../database.js";

const roots: string[] = [];
const opened: OpenedDatabase[] = [];
afterAll(() => {
  for (const db of opened.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function setup(): { db: OpenedDatabase; botId: string } {
  const root = makeTempRoot();
  roots.push(root);
  const db = openTestDatabase(makeLayout(root));
  opened.push(db);
  expect(db.appliedMigrations.some((m) => m.name === "0010-artifact-versions")).toBe(true);
  const { profile, workspaceId } = seedProfileAndWorkspace(db, {
    workspaceId: join(root, "workspace"),
  });
  // seedProfileAndWorkspace registers the workspace row with the given path.
  const bot = makeBot(profile, workspaceId);
  db.raw
    .prepare(
      "INSERT INTO bots (id, revision, name, instructions, model_profile_id, workspace_id, " +
        "tool_policy_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);",
    )
    .run(
      bot.id,
      bot.revision,
      bot.name,
      bot.instructions,
      bot.modelProfileId,
      bot.workspaceId,
      bot.toolPolicyId,
      db.now().toISOString(),
      db.now().toISOString(),
    );
  return { db, botId: bot.id };
}

describe("artifact versions repository (0010)", () => {
  it("round-trips a version row and exposes its snapshot path", () => {
    const { db, botId } = setup();
    const stored = insertArtifactVersion(db, {
      id: randomUUID(),
      botId,
      relativePath: "notes/todo.md",
      revision: 1,
      author: "user",
      mediaType: "text/markdown",
      size: 12,
      checksumValue: "a".repeat(64),
      contentPath: join("C:", "snapshots", "v1.bin"),
    });
    expect(stored.revision).toBe(1);
    expect(stored.author).toBe("user");
    expect(getArtifactVersion(db, stored.id)?.relativePath).toBe("notes/todo.md");
    expect(getArtifactVersionContentPath(db, stored.id)).toBe(join("C:", "snapshots", "v1.bin"));
  });

  it("rejects a version for an unknown bot and a duplicate revision", () => {
    const { db, botId } = setup();
    expect(() =>
      insertArtifactVersion(db, {
        id: randomUUID(),
        botId: randomUUID(),
        relativePath: "x.md",
        revision: 1,
        author: "bot",
        mediaType: "text/plain",
        size: 1,
        checksumValue: "a".repeat(64),
        contentPath: "C:\\nowhere.bin",
      }),
    ).toThrow(/bot does not exist/);

    const base = {
      botId,
      relativePath: "dup.md",
      author: "user" as const,
      mediaType: "text/plain",
      size: 1,
      checksumValue: "a".repeat(64),
      contentPath: "C:\\a.bin",
    };
    insertArtifactVersion(db, { id: randomUUID(), ...base, revision: 1 });
    expect(() =>
      insertArtifactVersion(db, { id: randomUUID(), ...base, revision: 1 }),
    ).toThrow(/already exists/);
  });

  it("lists newest-first, computes the next revision and prunes beyond the cap", () => {
    const { db, botId } = setup();
    for (let revision = 1; revision <= 4; revision++) {
      insertArtifactVersion(db, {
        id: randomUUID(),
        botId,
        relativePath: "hist.md",
        revision,
        author: revision % 2 === 0 ? "bot" : "user",
        mediaType: "text/markdown",
        size: revision,
        checksumValue: "b".repeat(64),
        contentPath: join("C:", "snap", `v${revision}.bin`),
      });
    }
    const listed = listArtifactVersions(db, botId, "hist.md");
    expect(listed.map((row) => row.revision)).toEqual([4, 3, 2, 1]);
    expect(latestArtifactVersion(db, botId, "hist.md")?.revision).toBe(4);
    expect(nextArtifactRevision(db, botId, "hist.md")).toBe(5);

    const pruned = pruneArtifactVersions(db, botId, "hist.md", 2);
    // Rows beyond the cap, newest first (the query orders by revision DESC).
    expect(pruned).toEqual([join("C:", "snap", "v2.bin"), join("C:", "snap", "v1.bin")]);
    expect(listArtifactVersions(db, botId, "hist.md").map((row) => row.revision)).toEqual([4, 3]);
    expect(countArtifactVersions(db)).toBe(2);
  });

  it("keeps versions of different files separate", () => {
    const { db, botId } = setup();
    insertArtifactVersion(db, {
      id: randomUUID(),
      botId,
      relativePath: "a.md",
      revision: 1,
      author: "user",
      mediaType: "text/markdown",
      size: 1,
      checksumValue: "c".repeat(64),
      contentPath: "C:\\a1.bin",
    });
    insertArtifactVersion(db, {
      id: randomUUID(),
      botId,
      relativePath: "b.md",
      revision: 1,
      author: "bot",
      mediaType: "text/markdown",
      size: 2,
      checksumValue: "d".repeat(64),
      contentPath: "C:\\b1.bin",
    });
    expect(listArtifactVersions(db, botId, "a.md")).toHaveLength(1);
    expect(listArtifactVersions(db, botId, "b.md")[0]?.author).toBe("bot");
  });
});
