import { describe, expect, it } from "vitest";
import {
  exportLibrary,
  importLibrary,
} from "../../src/renderer/src/features/skills/library-io.js";
import {
  emptyLibrary,
  loadSkills,
  saveSkill,
  setBotSkills,
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

function seed(storage: Storage): void {
  const created = saveSkill(storage, emptyLibrary(), {
    name: "周报助手",
    description: "整理周报",
    instructions: "输出三段式周报。",
    capabilities: ["read"],
  });
  if (!created.ok) throw new Error("seed skill failed");
  setBotSkills(storage, created.library, "bot-1", [created.skill.id]);
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
    const source = makeStorage();
    seed(source);
    const text = exportLibrary(source, new Date("2026-10-25T21:00:00.000Z"));
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.format).toBe("deepseek-bot-library");
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.exportedAt).toBe("2026-10-25T21:00:00.000Z");

    const target = makeStorage();
    const result = importLibrary(target, emptyLibrary(), text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      addedSkills: 1,
      skippedSkills: 0,
      addedTemplates: 1,
      skippedTemplates: 0,
    });
    const reloaded = loadSkills(target);
    expect(reloaded.skills).toHaveLength(1);
    expect(reloaded.skills[0]?.name).toBe("周报助手");
    expect(reloaded.skills[0]?.capabilities).toEqual(["read"]);
    expect(listTemplates(target)).toHaveLength(1);
    // Bindings are local state and are not part of the file.
    expect(reloaded.bindings).toEqual({});
  });

  it("skips entries whose name already exists locally", () => {
    const source = makeStorage();
    seed(source);
    const text = exportLibrary(source);
    const target = makeStorage();
    seed(target);
    const result = importLibrary(target, loadSkills(target), text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      addedSkills: 0,
      skippedSkills: 1,
      addedTemplates: 0,
      skippedTemplates: 1,
    });
    expect(loadSkills(target).skills).toHaveLength(1);
  });

  it("rejects malformed JSON as a whole", () => {
    const result = importLibrary(makeStorage(), emptyLibrary(), "{oops");
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
    const result = importLibrary(makeStorage(), emptyLibrary(), text);
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
    expect(importLibrary(makeStorage(), emptyLibrary(), text).ok).toBe(false);
  });

  it("does not import anything when the file fails validation", () => {
    const target = makeStorage();
    const text = JSON.stringify({
      format: "deepseek-bot-library",
      formatVersion: 1,
      exportedAt: "not-a-date",
      skills: [],
      templates: [],
    });
    expect(importLibrary(target, emptyLibrary(), text).ok).toBe(false);
    expect(loadSkills(target).skills).toEqual([]);
  });
});
