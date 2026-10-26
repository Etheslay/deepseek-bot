import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SKILLS,
  MAX_SKILL_CONTEXT_CHARS,
  buildSkillContext,
  deleteSkill,
  emptyLibrary,
  loadSkills,
  saveSkill,
  setBotSkills,
  skillsForBot,
} from "../../src/renderer/src/features/skills/skills.js";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

describe("skill library", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T21:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a skill at version 1 and persists it", () => {
    const storage = makeStorage();
    const created = saveSkill(storage, emptyLibrary(), {
      name: "  周报助手  ",
      instructions: "输出三段式周报。",
      capabilities: ["read"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.skill.name).toBe("周报助手");
    expect(created.skill.version).toBe(1);
    expect(created.skill.createdAt).toBe(created.skill.updatedAt);
    const reloaded = loadSkills(storage);
    expect(reloaded.skills).toHaveLength(1);
    expect(reloaded.skills[0]?.id).toBe(created.skill.id);
  });

  it("bumps the version on edit and keeps createdAt", () => {
    const storage = makeStorage();
    const first = saveSkill(storage, emptyLibrary(), {
      name: "代码评审",
      instructions: "按团队清单评审。",
    });
    if (!first.ok) throw new Error("create failed");
    vi.setSystemTime(new Date("2026-10-25T22:00:00.000Z"));
    const edited = saveSkill(storage, first.library, {
      id: first.skill.id,
      name: "代码评审",
      instructions: "按团队清单评审，并给出 diff 建议。",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.skill.version).toBe(2);
    expect(edited.skill.createdAt).toBe(first.skill.createdAt);
    expect(edited.skill.updatedAt).toBeGreaterThan(first.skill.updatedAt);
  });

  it("rejects duplicate names but lets a skill keep its own name", () => {
    const storage = makeStorage();
    const first = saveSkill(storage, emptyLibrary(), {
      name: "调研",
      instructions: "先列来源。",
    });
    if (!first.ok) throw new Error("create failed");
    const clash = saveSkill(storage, first.library, {
      name: " 调研 ",
      instructions: "另一份。",
    });
    expect(clash).toEqual({ ok: false, reason: "duplicate" });
    const selfEdit = saveSkill(storage, first.library, {
      id: first.skill.id,
      name: "调研",
      instructions: "先列来源，再给结论。",
    });
    expect(selfEdit.ok).toBe(true);
  });

  it("rejects the create past the cap and unknown ids", () => {
    const storage = makeStorage();
    let library = emptyLibrary();
    for (let index = 0; index < MAX_SKILLS; index += 1) {
      const created = saveSkill(storage, library, {
        name: `技能 ${index}`,
        instructions: "做点什么。",
      });
      if (!created.ok) throw new Error("create failed early");
      library = created.library;
    }
    expect(saveSkill(storage, library, { name: "多一个", instructions: "x" })).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(
      saveSkill(storage, library, {
        id: "does-not-exist",
        name: "幽灵",
        instructions: "x",
      }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(saveSkill(storage, library, { name: "   ", instructions: "x" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("degrades to an empty library on corrupt payloads", () => {
    const storage = makeStorage();
    storage.setItem("deepseek-bot.skills.v1", "{not json");
    expect(loadSkills(storage)).toEqual(emptyLibrary());
    storage.setItem("deepseek-bot.skills.v1", JSON.stringify({ skills: [1, 2] }));
    expect(loadSkills(storage).skills).toEqual([]);
  });

  it("prunes bindings for missing bots and unknown skills", () => {
    const storage = makeStorage();
    const created = saveSkill(storage, emptyLibrary(), {
      name: "写作",
      instructions: "口语化。",
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(storage, created.library, "bot-1", [created.skill.id]);
    const withGhost = {
      ...bound,
      bindings: {
        ...bound.bindings,
        "bot-gone": [created.skill.id],
        "bot-2": ["missing-skill"],
      },
    };
    storage.setItem("deepseek-bot.skills.v1", JSON.stringify(withGhost));
    const pruned = loadSkills(storage, ["bot-1"]);
    expect(Object.keys(pruned.bindings)).toEqual(["bot-1"]);
    storage.setItem(
      "deepseek-bot.skills.v1",
      JSON.stringify({ ...withGhost, bindings: { "bot-1": ["missing-skill"] } }),
    );
    expect(loadSkills(storage, ["bot-1"]).bindings).toEqual({});
  });

  it("removes bindings when a skill is deleted", () => {
    const storage = makeStorage();
    const created = saveSkill(storage, emptyLibrary(), {
      name: "翻译",
      instructions: "保持术语一致。",
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(storage, created.library, "bot-1", [created.skill.id]);
    const after = deleteSkill(storage, bound, created.skill.id);
    expect(after.skills).toEqual([]);
    expect(after.bindings).toEqual({});
    expect(skillsForBot(after, "bot-1")).toEqual([]);
  });

  it("dedupes bindings and clears them with an empty list", () => {
    const storage = makeStorage();
    const first = saveSkill(storage, emptyLibrary(), { name: "A", instructions: "a" });
    if (!first.ok) throw new Error("create failed");
    const second = saveSkill(storage, first.library, { name: "B", instructions: "b" });
    if (!second.ok) throw new Error("create failed");
    const bound = setBotSkills(storage, second.library, "bot-1", [
      second.skill.id,
      first.skill.id,
      second.skill.id,
      "unknown",
    ]);
    expect(bound.bindings["bot-1"]).toEqual([second.skill.id, first.skill.id]);
    const cleared = setBotSkills(storage, bound, "bot-1", []);
    expect(cleared.bindings).toEqual({});
  });

  it("builds a context block in binding order with versions", () => {
    const storage = makeStorage();
    const first = saveSkill(storage, emptyLibrary(), { name: "A", instructions: "甲" });
    if (!first.ok) throw new Error("create failed");
    const second = saveSkill(storage, first.library, { name: "B", instructions: "乙" });
    if (!second.ok) throw new Error("create failed");
    const bound = setBotSkills(storage, second.library, "bot-1", [
      second.skill.id,
      first.skill.id,
    ]);
    const context = buildSkillContext("bot-1", bound);
    expect(context).toContain("已为该 bot 启用 2 个技能");
    expect(context.indexOf("（v1）\n乙")).toBeLessThan(context.indexOf("（v1）\n甲"));
  });

  it("returns an empty context when nothing is bound", () => {
    expect(buildSkillContext("bot-1", emptyLibrary())).toBe("");
    expect(buildSkillContext(null, emptyLibrary())).toBe("");
  });

  it("caps the context and marks the truncation", () => {
    const storage = makeStorage();
    const long = "长".repeat(MAX_SKILL_CONTEXT_CHARS + 500);
    const created = saveSkill(storage, emptyLibrary(), {
      name: "长文",
      instructions: long,
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(storage, created.library, "bot-1", [created.skill.id]);
    const context = buildSkillContext("bot-1", bound);
    expect(context).toContain("…（技能上下文已截断）");
    expect(context.length).toBeLessThan(MAX_SKILL_CONTEXT_CHARS + 200);
  });

  it("outgrows backticks found in instructions", () => {
    const storage = makeStorage();
    const created = saveSkill(storage, emptyLibrary(), {
      name: "围栏",
      instructions: "示例：\n```ts\nconst a = 1;\n```\n结束",
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(storage, created.library, "bot-1", [created.skill.id]);
    const context = buildSkillContext("bot-1", bound);
    expect(context).toContain("````");
    expect(context.endsWith("````")).toBe(true);
  });
});
