// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applySkill,
  deleteSkill,
  listSkills,
  MAX_SKILLS,
  upsertSkill,
} from "../../src/renderer/src/features/skills/skill-store.js";

describe("skills store", () => {
  it("creates v1 and bumps version on same-name upsert", () => {
    const storage = window.localStorage;
    storage.clear();
    const first = upsertSkill(storage, { name: "总结", prompt: "总结以下内容" });
    expect(first.ok).toBe(true);
    const second = upsertSkill(storage, { name: "总结", prompt: "总结并点评" });
    expect(second.ok).toBe(true);
    const list = listSkills(storage);
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe(2);
    expect(list[0]?.prompt).toBe("总结并点评");
  });

  it("rejects empty name or prompt", () => {
    const storage = window.localStorage;
    storage.clear();
    expect(upsertSkill(storage, { name: "  ", prompt: "x" }).ok).toBe(false);
    expect(upsertSkill(storage, { name: "x", prompt: "" }).ok).toBe(false);
  });

  it("enforces the cap without blocking same-name updates", () => {
    const storage = window.localStorage;
    storage.clear();
    for (let i = 0; i < MAX_SKILLS; i += 1) {
      expect(upsertSkill(storage, { name: `s${i}`, prompt: "p" }).ok).toBe(true);
    }
    const overflow = upsertSkill(storage, { name: "overflow", prompt: "p" });
    expect(overflow.ok).toBe(false);
    const update = upsertSkill(storage, { name: "s0", prompt: "p2" });
    expect(update.ok).toBe(true);
  });

  it("deletes by id", () => {
    const storage = window.localStorage;
    storage.clear();
    const saved = upsertSkill(storage, { name: "翻译", prompt: "翻译成英文" });
    expect(saved.ok).toBe(true);
    const id = (saved as { skill: { id: string } }).skill.id;
    expect(deleteSkill(storage, id)).toHaveLength(0);
  });

  it("applySkill absorbs the draft via the placeholder", () => {
    const skill = { id: "s", name: "n", prompt: "总结：{{输入}}", version: 1, createdAt: "", updatedAt: "" };
    expect(applySkill(skill, "一份长报告")).toBe("总结：一份长报告");
  });

  it("applySkill appends the draft when no placeholder exists", () => {
    const skill = { id: "s", name: "n", prompt: "审阅以下内容：", version: 1, createdAt: "", updatedAt: "" };
    expect(applySkill(skill, "草稿正文")).toBe("审阅以下内容：\n\n草稿正文");
    expect(applySkill(skill, "")).toBe("审阅以下内容：");
  });
});
