import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SKILLS,
  MAX_SKILL_CONTEXT_CHARS,
  buildSkillContext,
  deleteSkill,
  skillsForInjection,
  emptyLibrary,
  loadSkills,
  localLibraryCandidate,
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

  it("creates a skill at version 1", () => {
    const created = saveSkill(emptyLibrary(), {
      name: "  周报助手  ",
      instructions: "输出三段式周报。",
      capabilities: ["read"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.skill.name).toBe("周报助手");
    expect(created.skill.version).toBe(1);
    expect(created.skill.createdAt).toBe(created.skill.updatedAt);
    expect(created.library.skills).toHaveLength(1);
  });

  it("bumps the version on edit and keeps createdAt", () => {
    const first = saveSkill(emptyLibrary(), {
      name: "代码评审",
      instructions: "按团队清单评审。",
    });
    if (!first.ok) throw new Error("create failed");
    vi.setSystemTime(new Date("2026-10-25T22:00:00.000Z"));
    const edited = saveSkill(first.library, {
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
    const first = saveSkill(emptyLibrary(), {
      name: "调研",
      instructions: "先列来源。",
    });
    if (!first.ok) throw new Error("create failed");
    const clash = saveSkill(first.library, {
      name: " 调研 ",
      instructions: "另一份。",
    });
    expect(clash).toEqual({ ok: false, reason: "duplicate" });
    const selfEdit = saveSkill(first.library, {
      id: first.skill.id,
      name: "调研",
      instructions: "先列来源，再给结论。",
    });
    expect(selfEdit.ok).toBe(true);
  });

  it("rejects the create past the cap and unknown ids", () => {
    let library = emptyLibrary();
    for (let index = 0; index < MAX_SKILLS; index += 1) {
      const created = saveSkill(library, {
        name: `技能 ${index}`,
        instructions: "做点什么。",
      });
      if (!created.ok) throw new Error("create failed early");
      library = created.library;
    }
    expect(saveSkill(library, { name: "多一个", instructions: "x" })).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(
      saveSkill(library, {
        id: "does-not-exist",
        name: "幽灵",
        instructions: "x",
      }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(saveSkill(library, { name: "   ", instructions: "x" })).toEqual({
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
    const created = saveSkill(emptyLibrary(), {
      name: "写作",
      instructions: "口语化。",
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(created.library, "bot-1", [created.skill.id]);
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
    const created = saveSkill(emptyLibrary(), {
      name: "翻译",
      instructions: "保持术语一致。",
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(created.library, "bot-1", [created.skill.id]);
    const after = deleteSkill(bound, created.skill.id);
    expect(after.skills).toEqual([]);
    expect(after.bindings).toEqual({});
    expect(skillsForBot(after, "bot-1")).toEqual([]);
  });

  it("dedupes bindings and clears them with an empty list", () => {
    const first = saveSkill(emptyLibrary(), { name: "A", instructions: "a" });
    if (!first.ok) throw new Error("create failed");
    const second = saveSkill(first.library, { name: "B", instructions: "b" });
    if (!second.ok) throw new Error("create failed");
    const bound = setBotSkills(second.library, "bot-1", [
      second.skill.id,
      first.skill.id,
      second.skill.id,
      "unknown",
    ]);
    expect(bound.bindings["bot-1"]).toEqual([second.skill.id, first.skill.id]);
    const cleared = setBotSkills(bound, "bot-1", []);
    expect(cleared.bindings).toEqual({});
  });

  it("builds a context block in binding order with versions", () => {
    const first = saveSkill(emptyLibrary(), { name: "A", instructions: "甲" });
    if (!first.ok) throw new Error("create failed");
    const second = saveSkill(first.library, { name: "B", instructions: "乙" });
    if (!second.ok) throw new Error("create failed");
    const bound = setBotSkills(second.library, "bot-1", [
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
    const long = "长".repeat(MAX_SKILL_CONTEXT_CHARS + 500);
    const created = saveSkill(emptyLibrary(), {
      name: "长文",
      instructions: long,
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(created.library, "bot-1", [created.skill.id]);
    const context = buildSkillContext("bot-1", bound);
    expect(context).toContain("…（技能上下文已截断）");
    expect(context.length).toBeLessThan(MAX_SKILL_CONTEXT_CHARS + 200);
  });

  it("outgrows backticks found in instructions", () => {
    const created = saveSkill(emptyLibrary(), {
      name: "围栏",
      instructions: "示例：\n```ts\nconst a = 1;\n```\n结束",
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(created.library, "bot-1", [created.skill.id]);
    const context = buildSkillContext("bot-1", bound);
    expect(context).toContain("````");
    expect(context.endsWith("````")).toBe(true);
  });
});

describe("localLibraryCandidate (D17' migration)", () => {
  it("returns null for empty, array and corrupt payloads", () => {
    expect(localLibraryCandidate(null)).toBeNull();
    // The composer prompt-template store writes an array under the same key.
    expect(
      localLibraryCandidate(
        JSON.stringify([{ id: "skill-1", name: "x", prompt: "y", version: 1 }]),
      ),
    ).toBeNull();
    expect(localLibraryCandidate("{not json")).toBeNull();
    expect(localLibraryCandidate(JSON.stringify({ skills: [], bindings: {} }))).toBeNull();
    expect(
      localLibraryCandidate(JSON.stringify({ skills: [{ junk: true }], bindings: {} })),
    ).toBeNull();
  });

  it("returns the library when at least one valid skill exists", () => {
    const created = saveSkill(emptyLibrary(), { name: "周报", instructions: "三段" });
    if (!created.ok) throw new Error("create failed");
    const candidate = localLibraryCandidate(JSON.stringify(created.library));
    expect(candidate?.skills).toHaveLength(1);
    expect(candidate?.skills[0]?.name).toBe("周报");
    // Bindings pointing at skills that did not survive the parse are dropped.
    const withGhost = {
      ...created.library,
      bindings: { "bot-1": [created.skill.id, "ghost"], "bot-2": ["ghost"] },
    };
    const migrated = localLibraryCandidate(JSON.stringify(withGhost));
    expect(migrated?.bindings).toEqual({ "bot-1": [created.skill.id] });
  });
});

describe("skillsForInjection", () => {
  it("returns the bound snapshot and refuses an unknown capability", () => {
    const created = saveSkill(emptyLibrary(), {
      name: "周报",
      instructions: "三段",
      capabilities: ["fs.read", "fs.read"],
    });
    if (!created.ok) throw new Error("create failed");
    const bound = setBotSkills(created.library, "bot-1", [created.skill.id]);
    const injected = skillsForInjection("bot-1", bound);
    expect(injected).toMatchObject({
      ok: true,
      skills: [{ name: "周报", capabilities: ["fs.read"], instructions: "三段" }],
    });
    const unknown = saveSkill(bound, {
      id: created.skill.id,
      name: "周报",
      instructions: "三段",
      capabilities: ["read"],
    });
    if (!unknown.ok) throw new Error("edit failed");
    const rebound = setBotSkills(unknown.library, "bot-1", [created.skill.id]);
    expect(skillsForInjection("bot-1", rebound)).toEqual({
      ok: false,
      reason: "unknown-capability",
      skill: "周报",
      capability: "read",
    });
  });

  it("returns no skills when the bot has none bound", () => {
    expect(skillsForInjection("bot-1", emptyLibrary())).toEqual({ ok: true, skills: [] });
    expect(skillsForInjection(null, emptyLibrary())).toEqual({ ok: true, skills: [] });
  });
});
