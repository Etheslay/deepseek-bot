// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  deleteTemplate,
  listTemplates,
  MAX_TEMPLATES,
  saveTemplate,
  type BotTemplate,
} from "../../src/renderer/src/features/templates/bot-templates.js";

function draft(name = "note-summarizer") {
  return {
    name: `${name} 模板`,
    bot: {
      name,
      instructions: "You summarize notes.",
      avatarUi: { avatar: { kind: "mono" }, shape: 0, color: 2 },
    },
  };
}

describe("bot templates store", () => {
  it("saves and lists templates", () => {
    const storage = window.localStorage;
    storage.clear();
    const result = saveTemplate(storage, draft());
    expect(result.ok).toBe(true);
    const list = listTemplates(storage);
    expect(list).toHaveLength(1);
    expect(list[0]?.bot.name).toBe("note-summarizer");
    expect(list[0]?.id).toMatch(/^tpl-/);
  });

  it("rejects duplicate bot names", () => {
    const storage = window.localStorage;
    storage.clear();
    expect(saveTemplate(storage, draft()).ok).toBe(true);
    const second = saveTemplate(storage, draft());
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("duplicate");
    }
  });

  it("enforces the cap", () => {
    const storage = window.localStorage;
    storage.clear();
    for (let i = 0; i < MAX_TEMPLATES; i += 1) {
      expect(saveTemplate(storage, draft(`bot-${i}`)).ok).toBe(true);
    }
    const overflow = saveTemplate(storage, draft("one-too-many"));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.reason).toBe("limit");
    }
  });

  it("deletes by id and survives corrupt payloads", () => {
    const storage = window.localStorage;
    storage.clear();
    const saved = saveTemplate(storage, draft());
    expect(saved.ok).toBe(true);
    const id = (saved as { template: BotTemplate }).template.id;
    expect(deleteTemplate(storage, id)).toHaveLength(0);

    storage.setItem("deepseek-bot.bot-templates.v1", "not-json");
    expect(listTemplates(storage)).toEqual([]);
  });
});
