/**
 * Context meter storage (TASK_CONTEXT_METER.md): one summary row per bot
 * session, replace-on-write, and the delete-that-restores-replay path.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ModelProfile } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "./index.js";
import { makeLayout, makeTempRoot, openTestDatabase, seedProfileAndWorkspace } from "./test-support.js";
import { createBot } from "./repos/bots.js";
import { deleteChatSummary, getChatSummary, upsertChatSummary } from "./repos/chat-summaries.js";

const BOT_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_BOT_ID = "20000000-0000-4000-8000-000000000002";
const SESSION_ID = "chat:20000000-0000-4000-8000-000000000001";

let db: OpenedDatabase;
let profile: ModelProfile;
let workspaceId: string;

beforeEach(() => {
  db = openTestDatabase(makeLayout(makeTempRoot()));
  const seeded = seedProfileAndWorkspace(db);
  profile = seeded.profile;
  workspaceId = seeded.workspaceId;
  createBot(db, {
    bot: {
      id: BOT_ID,
      revision: "20000000-0000-4000-8000-000000000009",
      name: "meter-bot",
      instructions: "be brief",
      modelProfileId: profile.id,
      workspaceId,
      toolPolicyId: "60000000-0000-4000-8000-000000000001",
      role: "standard",
      archivedAt: null,
    },
  });
});

describe("chat summaries", () => {
  it("starts empty and upserts a readable summary", () => {
    expect(getChatSummary(db, BOT_ID, SESSION_ID)).toBeUndefined();
    const saved = upsertChatSummary(db, {
      botId: BOT_ID,
      sessionId: SESSION_ID,
      summary: "早期对话要点：任务 A 已完成",
      coversMessageId: "90000000-0000-4000-8000-000000000001",
    });
    expect(saved.summary).toContain("任务 A");
    const read = getChatSummary(db, BOT_ID, SESSION_ID);
    expect(read?.coversMessageId).toBe("90000000-0000-4000-8000-000000000001");
    expect(read?.createdAt).not.toBeNull();
  });

  it("replaces the row on the second fold (watermark and digest move)", () => {
    upsertChatSummary(db, {
      botId: BOT_ID,
      sessionId: SESSION_ID,
      summary: "第一段摘要",
      coversMessageId: "90000000-0000-4000-8000-000000000001",
    });
    const second = upsertChatSummary(db, {
      botId: BOT_ID,
      sessionId: SESSION_ID,
      summary: "合并后的完整摘要",
      coversMessageId: "90000000-0000-4000-8000-000000000002",
    });
    expect(second.summary).toBe("合并后的完整摘要");
    const read = getChatSummary(db, BOT_ID, SESSION_ID);
    expect(read?.summary).toBe("合并后的完整摘要");
    expect(read?.coversMessageId).toBe("90000000-0000-4000-8000-000000000002");
    expect(read?.createdAt).not.toBeNull();
  });

  it("deleting the summary restores the no-summary state", () => {
    upsertChatSummary(db, {
      botId: BOT_ID,
      sessionId: SESSION_ID,
      summary: "会被删掉",
      coversMessageId: "90000000-0000-4000-8000-000000000001",
    });
    deleteChatSummary(db, BOT_ID, SESSION_ID);
    expect(getChatSummary(db, BOT_ID, SESSION_ID)).toBeUndefined();
  });

  it("keeps sessions isolated per bot", () => {
    createBot(db, {
      bot: {
        id: OTHER_BOT_ID,
        revision: "20000000-0000-4000-8000-000000000008",
        name: "other",
        instructions: "",
        modelProfileId: profile.id,
        workspaceId,
        toolPolicyId: "60000000-0000-4000-8000-000000000001",
        role: "standard",
        archivedAt: null,
      },
    });
    upsertChatSummary(db, {
      botId: BOT_ID,
      sessionId: SESSION_ID,
      summary: "只有 meter-bot 的摘要",
      coversMessageId: "90000000-0000-4000-8000-000000000001",
    });
    expect(getChatSummary(db, OTHER_BOT_ID, SESSION_ID)).toBeUndefined();
  });
});
