/**
 * D18 knowledge documents (独立知识表 + 本地向量检索) and the retention
 * policy (保留策略): bot-scoped writes, window ranking, and the sweep.
 */
import { describe, expect, it } from "vitest";
import {
  chunkText,
  deleteKnowledgeDoc,
  listKnowledgeDocs,
  rankChunks,
  searchKnowledge,
  tokenize,
  writeKnowledgeDoc,
} from "./knowledge.js";
import {
  readRetentionPolicy,
  writeRetentionPolicy,
  sweepRetention,
  DEFAULT_RETENTION_POLICY,
} from "./retention.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  makeTestClock,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "../test-support.js";
import { createBot } from "./bots.js";
import { writeMemory } from "./memories.js";

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "22222222-2222-4222-8222-222222222222";

describe("knowledge documents", () => {
  it("writes, lists summaries and deletes bot-scoped docs", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    createBot(db, { bot: makeBot(profile, workspaceId, { id: BOT_A }) });
    createBot(db, { bot: makeBot(profile, workspaceId, { id: BOT_B }) });

    const doc = writeKnowledgeDoc(db, {
      botId: BOT_A,
      title: "部署手册",
      text: "部署流程：先构建，再发布。",
    });
    expect(doc).toMatchObject({ botId: BOT_A, title: "部署手册", size: 13 });
    expect(listKnowledgeDocs(db, { botId: BOT_A })).toHaveLength(1);
    expect(listKnowledgeDocs(db, { botId: BOT_B })).toEqual([]);
    // Summaries never carry the text (1 MiB message cap stays safe).
    expect(listKnowledgeDocs(db, { botId: BOT_A })[0]).not.toHaveProperty("text");

    deleteKnowledgeDoc(db, { botId: BOT_A, docId: doc.id });
    expect(listKnowledgeDocs(db, { botId: BOT_A })).toEqual([]);
    expect(() =>
      deleteKnowledgeDoc(db, { botId: BOT_A, docId: doc.id }),
    ).toThrowError(/not found/);
    db.close();
  });

  it("rejects empty or oversized titles and texts", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() =>
      writeKnowledgeDoc(db, { botId: BOT_A, title: "  ", text: "正文" }),
    ).toThrowError(/title/);
    expect(() =>
      writeKnowledgeDoc(db, { botId: BOT_A, title: "t", text: "   " }),
    ).toThrowError(/text/);
    expect(() =>
      writeKnowledgeDoc(db, { botId: BOT_A, title: "t", text: "x".repeat(100_001) }),
    ).toThrowError(/text/);
    db.close();
  });
});

describe("local vector scoring", () => {
  it("tokenizes latin words and CJK bigrams", () => {
    expect(tokenize("Deploy the API!")).toEqual(["deploy", "the", "api"]);
    expect(tokenize("部署流程")).toEqual(["部署", "署流", "流程"]);
    expect(tokenize("机")).toEqual(["机"]);
    expect(tokenize("v2 部署")).toEqual(["v2", "部署"]);
  });

  it("chunks long text with overlap and keeps short text whole", () => {
    expect(chunkText("短文")).toEqual(["短文"]);
    const long = "x".repeat(1000);
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toHaveLength(480);
    // Adjacent windows overlap so a match is never cut in half.
    expect(chunks[0]!.slice(380)).toBe(chunks[1]!.slice(0, 100));
  });

  it("ranks the matching section first and skips unrelated docs", () => {
    const docs = [
      {
        docId: "99999999-9999-4999-8999-999999999991",
        title: "部署手册",
        at: "2026-10-26T00:00:00.000Z",
        text: "部署流程：运行 build 命令构建产物，然后把 dist 目录发布到服务器。".repeat(3),
      },
      {
        docId: "99999999-9999-4999-8999-999999999992",
        title: "团队守则",
        at: "2026-10-26T00:00:00.000Z",
        text: "每周例会在周一上午，讨论设计评审与发布计划。",
      },
    ];
    const hits = rankChunks("部署流程 build", docs, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.docId).toBe(docs[0]!.docId);
    expect(hits[0]!.snippet).toContain("部署");
    // The unrelated doc shares no tokens with the query.
    expect(hits.some((hit) => hit.docId === docs[1]!.docId)).toBe(false);

    // Exact phrase inside a window lifts that window to the top.
    const withPhrase = rankChunks("发布到服务器", docs, 5);
    expect(withPhrase[0]!.score).toBeGreaterThan(hits[0]!.score);
  });

  it("searches through the database with bot isolation", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    createBot(db, { bot: makeBot(profile, workspaceId, { id: BOT_A }) });
    createBot(db, { bot: makeBot(profile, workspaceId, { id: BOT_B }) });
    writeKnowledgeDoc(db, {
      botId: BOT_A,
      title: "部署手册",
      text: "部署流程：先构建，再发布到服务器。",
    });
    writeKnowledgeDoc(db, {
      botId: BOT_B,
      title: "别bot手册",
      text: "部署流程属于别的机器人。",
    });

    const hits = searchKnowledge(db, { botId: BOT_A, query: "发布服务器", limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe("部署手册");
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(searchKnowledge(db, { botId: BOT_A, query: "完全不相关的词", limit: 5 })).toEqual([]);
    db.close();
  });
});

describe("retention policy", () => {
  it("defaults to keep-everything and treats corrupt values as zero", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(readRetentionPolicy(db)).toEqual(DEFAULT_RETENTION_POLICY);
    db.raw
      .prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?);")
      .run("memory.retention", '"not-an-object"', "2026-10-26T00:00:00.000Z");
    expect(readRetentionPolicy(db)).toEqual(DEFAULT_RETENTION_POLICY);
    db.raw
      .prepare("UPDATE settings SET value_json = ? WHERE key = ?;")
      .run('{"retentionDays":-5,"memoryMaxPerBot":"many","knowledgeMaxPerBot":null}', "memory.retention");
    expect(readRetentionPolicy(db)).toEqual(DEFAULT_RETENTION_POLICY);
    db.close();
  });

  it("round-trips the policy through the settings key", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const policy = { retentionDays: 30, memoryMaxPerBot: 500, knowledgeMaxPerBot: 100 };
    expect(writeRetentionPolicy(db, policy)).toEqual(policy);
    expect(readRetentionPolicy(db)).toEqual(policy);
    db.close();
  });

  it("sweeps expired memories and per-bot overflows", () => {
    const clock = makeTestClock("2026-10-26T00:00:00.000Z");
    const db = openTestDatabase(makeLayout(makeTempRoot()), clock);
    const { profile, workspaceId } = seedProfileAndWorkspace(db);
    createBot(db, { bot: makeBot(profile, workspaceId, { id: BOT_A }) });
    createBot(db, { bot: makeBot(profile, workspaceId, { id: BOT_B }) });

    // Old note (40 days) and two fresh ones for BOT_A; one fresh for BOT_B.
    clock.setIso("2026-09-16T00:00:00.000Z");
    writeMemory(db, { botId: BOT_A, text: "过期的记忆" });
    clock.setIso("2026-10-25T00:00:00.000Z");
    writeMemory(db, { botId: BOT_A, text: "新的记忆一" });
    writeMemory(db, { botId: BOT_A, text: "新的记忆二" });
    writeMemory(db, { botId: BOT_B, text: "别的机器人的记忆" });

    clock.setIso("2026-10-26T12:00:00.000Z");
    const docA1 = writeKnowledgeDoc(db, { botId: BOT_A, title: "旧知识", text: "a" });
    const docA2 = writeKnowledgeDoc(db, { botId: BOT_A, title: "新知识", text: "b" });
    writeKnowledgeDoc(db, { botId: BOT_B, title: "别的知识", text: "c" });

    const result = sweepRetention(
      db,
      { retentionDays: 30, memoryMaxPerBot: 2, knowledgeMaxPerBot: 1 },
      clock.now(),
    );
    expect(result).toEqual({ expiredMemories: 1, trimmedMemories: 0, trimmedDocs: 1 });
    // The old note is gone; both fresh notes stay (cap 2); BOT_B untouched.
    const aMemories = db.raw
      .prepare("SELECT text FROM memories WHERE bot_id = ? ORDER BY created_at;")
      .all(BOT_A) as unknown as Array<{ text: string }>;
    expect(aMemories.map((row) => row.text)).toEqual(["新的记忆一", "新的记忆二"]);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM memories WHERE bot_id = ?;").get(BOT_B),
    ).toMatchObject({ n: 1 });
    // Knowledge keeps the newest doc only.
    expect(listKnowledgeDocs(db, { botId: BOT_A }).map((d) => d.id)).toEqual([docA2.id]);
    expect(docA1.id).not.toBe(docA2.id);
    expect(listKnowledgeDocs(db, { botId: BOT_B })).toHaveLength(1);
    db.close();
  });
});
