import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { learnSkillForBot, listSkillsForBot, mergeTurnSkills } from "./skill-library.js";

const BOT = "11111111-1111-4111-8111-111111111111";
const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("learnSkillForBot", () => {
  it("binds the skill and prefers the stored text over a stale send", () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-skill-learn-"));
    const db = openDatabase(join(root, "app.sqlite"));
    try {
      const learned = learnSkillForBot(db, BOT, { name: "周报", instructions: "只写三段。" });
      expect(learned.created).toBe(true);
      expect(listSkillsForBot(db, BOT).map((skill) => skill.name)).toEqual(["周报"]);
      const updated = learnSkillForBot(db, BOT, { name: "周报", instructions: "只写四段。" });
      expect(updated.created).toBe(false);
      expect(updated.skill.version).toBe(2);
      expect(listSkillsForBot(db, BOT)).toHaveLength(1);
      expect(
        mergeTurnSkills(db, BOT, [
          { name: "周报", version: 1, instructions: "旧的。", capabilities: [] },
          { name: "别的", version: 1, instructions: "保留。", capabilities: [] },
        ]).map((skill) => skill.instructions),
      ).toEqual(["只写四段。", "保留。"]);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("learn_skill tool", () => {
  it("saves for the calling bot without a settings write", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-skill-tool-"));
    roots.push(root);
    const host = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
    hosts.push(host);
    const bot = (await host.handleMethod("bot.create", {
      name: "learner",
      instructions: "learn",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    const caller = { id: `chat:${bot.id}`, botId: bot.id };
    const saved = (await host.agentTools.call(caller, "learn_skill", {
      name: "检索",
      instructions: "先搜索，再给出来源。",
    })) as { created: boolean; skill: { name: string; version: number } };
    expect(saved).toMatchObject({ created: true, skill: { name: "检索", version: 1 } });
    expect(await host.agentTools.call(caller, "list_skills", {})).toEqual({
      skills: [expect.objectContaining({ name: "检索", version: 1 })],
    });
    expect(mergeTurnSkills(host.db, bot.id, [])).toEqual([
      expect.objectContaining({ name: "检索", instructions: "先搜索，再给出来源。", capabilities: [] }),
    ]);
  });
});
