import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import { createBot } from "./bots.js";
import { appendChatMessage } from "./chat.js";
import { insertArtifactVersion } from "./artifact-versions.js";
import {
  escapeLikePattern,
  searchArtifactPaths,
  searchBotNames,
  searchChatMessages,
  searchWorkflowNames,
} from "./global-search.js";

function tempDb(): { db: OpenedDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-gsearch-"));
  const db = openDatabase(join(root, "app.sqlite"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function seedBot(db: OpenedDatabase, name: string, archived = false): string {
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
    .run(workspaceId, join(tmpdir(), "dsb-gsearch-ws"), now, now);
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', '{}', ?, ?);",
    )
    .run(policyId, randomUUID(), now, now);
  const bot = createBot(db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name,
      instructions: "be helpful",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: archived ? now : null,
    },
  });
  return bot.bot.id;
}

function insertWorkflow(db: OpenedDatabase, name: string): string {
  const id = randomUUID();
  const now = db.now().toISOString();
  db.raw
    .prepare(
      "INSERT INTO workflows (id, revision, name, schema_version, nodes_json, edges_json, limits_json, created_at, updated_at) " +
        "VALUES (?, ?, ?, '0.1', '[]', '[]', '{}', ?, ?);",
    )
    .run(id, randomUUID(), name, now, now);
  return id;
}

describe("escapeLikePattern", () => {
  it("escapes the three LIKE wildcards", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});

describe("global search repositories", () => {
  it("finds bots by name including archived ones, newest first", () => {
    const { db, cleanup } = tempDb();
    try {
      const first = seedBot(db, "alpha-writer");
      const second = seedBot(db, "beta-writer");
      seedBot(db, "gamma-reader", true);
      const hits = searchBotNames(db, "writer", 10);
      expect(hits.map((hit) => hit.id)).toEqual([second, first]);
      expect(hits[1]?.archivedAt).toBeNull();
      const archived = searchBotNames(db, "gamma", 10);
      expect(archived).toHaveLength(1);
      expect(archived[0]?.archivedAt).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("matches message substrings across bots and joins the bot name", () => {
    const { db, cleanup } = tempDb();
    try {
      const alpha = seedBot(db, "alpha");
      const beta = seedBot(db, "beta");
      appendChatMessage(db, { botId: alpha, sessionId: `chat:${alpha}`, role: "user", text: "请总结季度报告" });
      appendChatMessage(db, { botId: beta, sessionId: `chat:${beta}`, role: "assistant", text: "季度报告已完成" });
      const hits = searchChatMessages(db, "季度报告", 10);
      expect(hits).toHaveLength(2);
      expect(hits[0]?.botName).toBe("beta");
      expect(hits[0]?.role).toBe("assistant");
      expect(hits[1]?.botName).toBe("alpha");
      expect(searchChatMessages(db, "不存在的句子", 10)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("treats LIKE wildcards in the query as literal text", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db, "esc");
      appendChatMessage(db, { botId, sessionId: `chat:${botId}`, role: "user", text: "进度 100% 完成" });
      appendChatMessage(db, { botId, sessionId: `chat:${botId}`, role: "user", text: "a_b 测试" });
      expect(searchChatMessages(db, "100%", 10)).toHaveLength(1);
      // "_" as a literal substring matches the message that contains one.
      expect(searchChatMessages(db, "_", 10)).toHaveLength(1);
      expect(searchChatMessages(db, "a_b", 10)).toHaveLength(1);
      // No message contains a literal percent sign besides the one above.
      expect(searchChatMessages(db, "%", 10)).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("keeps one artifact hit per file at its latest revision", () => {
    const { db, cleanup } = tempDb();
    try {
      const botId = seedBot(db, "artifact-bot");
      const old = insertArtifactVersion(db, {
        id: randomUUID(),
        botId,
        relativePath: "reports/draft.md",
        revision: 1,
        author: "bot",
        mediaType: "text/markdown",
        size: 12,
        checksumValue: "a".repeat(64),
        contentPath: join(tmpdir(), "dsb-gsearch-v1"),
      });
      const latest = insertArtifactVersion(db, {
        id: randomUUID(),
        botId,
        relativePath: "reports/draft.md",
        revision: 2,
        author: "user",
        mediaType: "text/markdown",
        size: 20,
        checksumValue: "b".repeat(64),
        contentPath: join(tmpdir(), "dsb-gsearch-v2"),
      });
      insertArtifactVersion(db, {
        id: randomUUID(),
        botId,
        relativePath: "notes/todo.md",
        revision: 1,
        author: "user",
        mediaType: "text/markdown",
        size: 4,
        checksumValue: "c".repeat(64),
        contentPath: join(tmpdir(), "dsb-gsearch-v3"),
      });
      const hits = searchArtifactPaths(db, "draft", 10);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.id).toBe(latest.id);
      expect(hits[0]?.id).not.toBe(old.id);
      expect(hits[0]?.relativePath).toBe("reports/draft.md");
      expect(searchArtifactPaths(db, ".md", 10)).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it("finds workflows by name and respects the limit", () => {
    const { db, cleanup } = tempDb();
    try {
      insertWorkflow(db, "每周周报");
      insertWorkflow(db, "周会记录");
      insertWorkflow(db, "季度总结");
      const hits = searchWorkflowNames(db, "周", 10).map((hit) => hit.name).sort();
      expect(hits).toEqual(["周会记录", "每周周报"]);
      expect(searchWorkflowNames(db, "周", 1)).toHaveLength(1);
      expect(searchWorkflowNames(db, "季度", 10)).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});
