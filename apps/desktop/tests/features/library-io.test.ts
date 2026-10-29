import { describe, expect, it } from "vitest";
import {
  exportLibrary,
  importLibrary,
} from "../../src/renderer/src/features/skills/library-io.js";
import {
  emptyLibrary,
  saveSkill,
  setBotSkills,
  type SkillLibrary,
} from "../../src/renderer/src/features/skills/skills.js";
import { listTemplates, saveTemplate } from "../../src/renderer/src/features/templates/bot-templates.js";

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

function seedSkillLibrary(): SkillLibrary {
  const created = saveSkill(emptyLibrary(), {
    name: "周报助手",
    description: "整理周报",
    instructions: "输出三段式周报。",
    capabilities: ["read"],
  });
  if (!created.ok) throw new Error("seed skill failed");
  return setBotSkills(created.library, "bot-1", [created.skill.id]);
}

function seedTemplates(storage: Storage): void {
  const saved = saveTemplate(storage, {
    name: "设计模板",
    bot: {
      name: "designer",
      instructions: "负责界面评审。",
      avatarUi: { avatar: { kind: "mono" }, shape: 0, color: 2 },
    },
  });
  if (!saved.ok) throw new Error("seed template failed");
}

describe("library import/export", () => {
  it("round-trips skills and templates through one file", () => {
    const sourceTemplates = makeStorage();
    seedTemplates(sourceTemplates);
    const text = exportLibrary(
      seedSkillLibrary(),
      sourceTemplates,
      new Date("2026-10-25T21:00:00.000Z"),
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.format).toBe("deepseek-bot-library");
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.exportedAt).toBe("2026-10-25T21:00:00.000Z");

    const targetTemplates = makeStorage();
    const result = importLibrary(emptyLibrary(), targetTemplates, text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      addedSkills: 1,
      skippedSkills: 0,
      addedTemplates: 1,
      skippedTemplates: 0,
    });
    expect(result.library.skills).toHaveLength(1);
    expect(result.library.skills[0]?.name).toBe("周报助手");
    expect(result.library.skills[0]?.capabilities).toEqual(["read"]);
    expect(listTemplates(targetTemplates)).toHaveLength(1);
    // Bindings are local state and are not part of the file.
    expect(result.library.bindings).toEqual({});
  });

  it("skips entries whose name already exists locally", () => {
    const sourceTemplates = makeStorage();
    seedTemplates(sourceTemplates);
    const text = exportLibrary(seedSkillLibrary(), sourceTemplates);
    const targetTemplates = makeStorage();
    seedTemplates(targetTemplates);
    const local = seedSkillLibrary();
    const result = importLibrary(local, targetTemplates, text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      addedSkills: 0,
      skippedSkills: 1,
      addedTemplates: 0,
      skippedTemplates: 1,
    });
    expect(result.library.skills).toHaveLength(1);
  });

  it("rejects malformed JSON as a whole", () => {
    const result = importLibrary(emptyLibrary(), makeStorage(), "{oops");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("JSON");
  });

  it("rejects a file with a foreign format marker", () => {
    const text = JSON.stringify({
      format: "other-app",
      formatVersion: 1,
      exportedAt: "2026-10-25T21:00:00.000Z",
      skills: [],
      templates: [],
    });
    const result = importLibrary(emptyLibrary(), makeStorage(), text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("校验失败");
  });

  it("rejects an unknown future formatVersion", () => {
    const text = JSON.stringify({
      format: "deepseek-bot-library",
      formatVersion: 99,
      exportedAt: "2026-10-25T21:00:00.000Z",
      skills: [],
      templates: [],
    });
    expect(importLibrary(emptyLibrary(), makeStorage(), text).ok).toBe(false);
  });

  it("returns the untouched library when the file fails validation", () => {
    const local = seedSkillLibrary();
    const text = JSON.stringify({
      format: "deepseek-bot-library",
      formatVersion: 1,
      exportedAt: "not-a-date",
      skills: [],
      templates: [],
    });
    const result = importLibrary(local, makeStorage(), text);
    expect(result.ok).toBe(false);
    // A rejected file must not produce a next library at all, so `local`
    // stays the only library state the caller holds.
    expect(local.skills).toHaveLength(1);
  });
});
