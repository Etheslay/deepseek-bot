/**
 * Workspace artifact co-edit service tests (D28): real temp workspace, real
 * SQLite — the same layout the desktop Host uses.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_ARTIFACT_CONTENT_BYTES } from "@deepseek-bot/contracts";
import { ensureDataLayout, openDatabase, type OpenedDatabase } from "@deepseek-bot/storage";
import { EngineError } from "@deepseek-bot/runtime";
import { createWorkspaceArtifacts, type WorkspaceArtifacts } from "./artifacts.js";

const roots: string[] = [];
const dbs: OpenedDatabase[] = [];
afterAll(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function seedWorkspaceBot(
  db: OpenedDatabase,
  workspacePath: string,
): string {
  const now = db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  const profileId = randomUUID();
  const workspaceId = randomUUID();
  const toolPolicyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'test', ?, ?);",
    )
    .run(ref, now, now);
  db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com/v1', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, workspacePath, now, now);
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) " +
        "VALUES (?, ?, 'artifacts test policy', ?, ?, ?);",
    )
    .run(
      toolPolicyId,
      randomUUID(),
      JSON.stringify({
        filesystem: { enabled: true, operations: ["read", "write"] },
        shell: { mode: "disabled" },
        network: { mode: "disabled" },
        mcp: { enabled: false, requireApproval: false, servers: [] },
      }),
      now,
      now,
    );
  const botId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO bots (id, revision, name, instructions, model_profile_id, workspace_id, " +
        "tool_policy_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);",
    )
    .run(
      botId,
      randomUUID(),
      "共编测试机器人",
      "测试指令。",
      profileId,
      workspaceId,
      toolPolicyId,
      now,
      now,
    );
  return botId;
}

describe("workspace artifacts (D28)", () => {
  let root: string;
  let workspace: string;
  let artifacts: WorkspaceArtifacts;
  let botId: string;
  let dbRef: OpenedDatabase;

  beforeEach(() => {
    root = makeLocalTempRoot();
    roots.push(root);
    const layout = ensureDataLayout(root);
    workspace = join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const database = openDatabase(layout.dbFile);
    dbs.push(database);
    dbRef = database;
    botId = seedWorkspaceBot(database, workspace);
    artifacts = createWorkspaceArtifacts({
      db: database,
      artifactsRoot: layout.artifacts,
      now: () => new Date(),
    });
  });

  it("lists workspace files and captures pre-existing content as a bot version", () => {
    fs.writeFileSync(join(workspace, "notes.md"), "# 由 bot 先写入\n");
    const listed = artifacts.list(botId);
    expect(listed.artifacts.map((a) => a.relativePath)).toEqual(["notes.md"]);
    expect(listed.artifacts[0]?.mediaType).toBe("text/markdown");

    const versions = artifacts.versions(botId, "notes.md");
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0]?.author).toBe("bot");
    expect(versions.versions[0]?.revision).toBe(1);

    // A stable file is not re-captured on the next look.
    expect(artifacts.list(botId).artifacts).toHaveLength(1);
    expect(artifacts.versions(botId, "notes.md").versions).toHaveLength(1);
  });

  it("saves text, appends a user version and reads it back", () => {
    const saved = artifacts.save(botId, "draft/todo.md", "# 待办\n", undefined);
    expect(saved.version.author).toBe("user");
    expect(saved.version.revision).toBe(1);
    expect(fs.readFileSync(join(workspace, "draft", "todo.md"), "utf8")).toBe("# 待办\n");

    const read = artifacts.read(botId, "draft/todo.md");
    expect(read).toMatchObject({ kind: "text", mediaType: "text/markdown", content: "# 待办\n" });

    const second = artifacts.save(
      botId,
      "draft/todo.md",
      "# 待办（改）\n",
      saved.artifact.checksum.value,
    );
    expect(second.version.revision).toBe(2);
    expect(artifacts.versions(botId, "draft/todo.md").versions.map((v) => v.author)).toEqual([
      "user",
      "user",
    ]);
  });

  it("a no-op save does not append a duplicate version", () => {
    const first = artifacts.save(botId, "noop.md", "same\n", undefined);
    const again = artifacts.save(botId, "noop.md", "same\n", first.artifact.checksum.value);
    expect(again.version.id).toBe(first.version.id);
    expect(artifacts.versions(botId, "noop.md").versions).toHaveLength(1);
  });

  it("captures a concurrent bot write as its own version, then enforces the checksum", () => {
    const base = artifacts.save(botId, "shared.md", "v1\n", undefined);
    // The "bot" rewrites the file outside any method call.
    fs.writeFileSync(join(workspace, "shared.md"), "bot rewrote this\n");
    expect(() =>
      artifacts.save(botId, "shared.md", "user edit\n", base.artifact.checksum.value),
    ).toThrow(/被修改/);
    // The reconciled bot write is recoverable from the version trail.
    const versions = artifacts.versions(botId, "shared.md");
    expect(versions.versions.map((v) => v.author)).toEqual(["bot", "user"]);
    const botSnapshot = artifacts.versionContent(botId, "shared.md", versions.versions[0]!.id);
    expect(botSnapshot).toMatchObject({ kind: "text", content: "bot rewrote this\n" });
  });

  it("reverts to an earlier version by appending a new one", () => {
    const v1 = artifacts.save(botId, "hist.md", "first\n", undefined);
    artifacts.save(botId, "hist.md", "second\n", v1.artifact.checksum.value);
    const reverted = artifacts.revert(botId, "hist.md", v1.version.id);
    expect(reverted.version.revision).toBe(3);
    expect(reverted.version.author).toBe("user");
    expect(fs.readFileSync(join(workspace, "hist.md"), "utf8")).toBe("first\n");
    const versions = artifacts.versions(botId, "hist.md").versions;
    expect(versions.map((v) => v.revision)).toEqual([3, 2, 1]);
  });

  it("blocks HTML and binary media from inline content (QA-14)", () => {
    fs.writeFileSync(join(workspace, "page.html"), "<script>1</script>");
    fs.writeFileSync(join(workspace, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    const html = artifacts.read(botId, "page.html");
    expect(html.kind).toBe("blocked");
    if (html.kind === "blocked") {
      expect(html.mediaType).toBe("text/html");
    }
    const binary = artifacts.read(botId, "blob.bin");
    expect(binary.kind).toBe("blocked");
    // HTML saves are rejected outright too.
    expect(() => artifacts.save(botId, "page2.html", "<b>x</b>", undefined)).toThrow(/HTML/);
  });

  it("refuses oversized inline content without writing or truncating", () => {
    const big = "x".repeat(MAX_ARTIFACT_CONTENT_BYTES + 1);
    expect(() => artifacts.save(botId, "big.txt", big, undefined)).toThrow(/上限/);
    expect(fs.existsSync(join(workspace, "big.txt"))).toBe(false);
    // Oversized on-disk files stay listed but read as blocked.
    fs.writeFileSync(join(workspace, "huge.txt"), "y".repeat(MAX_ARTIFACT_CONTENT_BYTES + 1));
    const read = artifacts.read(botId, "huge.txt");
    expect(read.kind).toBe("blocked");
  });

  it("rejects traversal and keeps writes inside the workspace", () => {
    expect(() => artifacts.read(botId, "../escape.md")).toThrow(EngineError);
    expect(() => artifacts.save(botId, "..\\escape.md", "nope", undefined)).toThrow(EngineError);
    expect(() => artifacts.read(botId, "a/../../b.md")).toThrow(EngineError);
    expect(fs.existsSync(join(root, "escape.md"))).toBe(false);
  });

  it("never lists hidden entries", () => {
    fs.writeFileSync(join(workspace, ".hidden.md"), "secret\n");
    fs.mkdirSync(join(workspace, ".dsh"));
    fs.writeFileSync(join(workspace, ".dsh", "state.json"), "{}");
    expect(artifacts.list(botId).artifacts).toEqual([]);
  });

  it("rejects artifact calls for unknown bots", () => {
    expect(() => artifacts.list(randomUUID())).toThrow(/was not found/);
    expect(() => artifacts.list("00000000-0000-4000-8000-000000000000")).toThrow(EngineError);
  });

  it("refuses artifact calls for an archived bot", () => {
    dbRef.raw
      .prepare("UPDATE bots SET archived_at = ? WHERE id = ?;")
      .run(new Date().toISOString(), botId);
    expect(() => artifacts.list(botId)).toThrow(/archived/);
    expect(() => artifacts.save(botId, "x.md", "nope", undefined)).toThrow(/archived/);
  });
});

/** Host package tests keep their own temp root helper (mirrors storage's). */
function makeLocalTempRoot(): string {
  return fs.mkdtempSync(join(tmpdir(), "dsb-host-artifacts-"));
}
