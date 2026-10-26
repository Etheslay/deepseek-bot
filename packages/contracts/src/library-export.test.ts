import { describe, expect, it } from "vitest";
import {
  LIBRARY_EXPORT_FORMAT,
  LIBRARY_EXPORT_FORMAT_VERSION,
  parseLibraryExport,
  type LibraryExportFile,
} from "./library-export.js";

function validFile(): LibraryExportFile {
  return {
    format: LIBRARY_EXPORT_FORMAT,
    formatVersion: LIBRARY_EXPORT_FORMAT_VERSION,
    exportedAt: "2026-10-25T21:00:00.000Z",
    skills: [
      {
        id: "6f1c2b3a-4d5e-4f60-8192-abcdefabcdef",
        name: "周报助手",
        description: "把本周进展整理成周报",
        instructions: "读取进展列表，输出三段式周报。",
        capabilities: ["read"],
        version: 2,
        createdAt: 1761400000000,
        updatedAt: 1761403600000,
      },
    ],
    templates: [
      {
        name: "设计 bot 模板",
        bot: {
          name: "designer",
          instructions: "负责界面评审。",
          avatarUi: { avatar: { kind: "mono" }, shape: 0, color: 2 },
        },
      },
    ],
  };
}

describe("parseLibraryExport", () => {
  it("accepts a valid library export file", () => {
    const result = parseLibraryExport(validFile());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.skills).toHaveLength(1);
      expect(result.file.templates).toHaveLength(1);
    }
  });

  it("rejects a wrong format marker", () => {
    const file = { ...validFile(), format: "something-else" };
    const result = parseLibraryExport(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("format");
  });

  it("rejects an unknown future formatVersion", () => {
    const file = { ...validFile(), formatVersion: 99 };
    const result = parseLibraryExport(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("formatVersion");
  });

  it("rejects entries with missing required fields", () => {
    const [firstSkill] = validFile().skills;
    if (!firstSkill) throw new Error("fixture must contain a skill");
    const { instructions: _dropped, ...withoutInstructions } = firstSkill;
    const broken = { ...validFile(), skills: [withoutInstructions] };
    const result = parseLibraryExport(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("skills");
  });

  it("rejects a non-positive skill version", () => {
    const file = validFile();
    const [firstSkill] = file.skills;
    if (!firstSkill) throw new Error("fixture must contain a skill");
    firstSkill.version = 0;
    expect(parseLibraryExport(file).ok).toBe(false);
  });

  it("strips unknown object keys (pinned zod object default)", () => {
    const file = { ...validFile(), surprise: "extra" } as unknown;
    const result = parseLibraryExport(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("surprise" in result.file).toBe(false);
    }
  });

  it("rejects non-object payloads", () => {
    expect(parseLibraryExport(null).ok).toBe(false);
    expect(parseLibraryExport("nope").ok).toBe(false);
    expect(parseLibraryExport([]).ok).toBe(false);
  });

  it("accepts a grok avatar snapshot in templates", () => {
    const file = validFile();
    const [template] = file.templates;
    if (!template) throw new Error("fixture must contain a template");
    template.bot.avatarUi = {
      avatar: { kind: "grok", shape: "blob", color: "#3b93f0", state: "idle" },
      shape: 1,
      color: 4,
    };
    expect(parseLibraryExport(file).ok).toBe(true);
  });

  it("rejects a string avatar snapshot (old shape)", () => {
    const file = validFile();
    const [template] = file.templates;
    if (!template) throw new Error("fixture must contain a template");
    template.bot.avatarUi = {
      avatar: "mono" as unknown as { kind: "mono" },
      shape: 0,
      color: 0,
    };
    expect(parseLibraryExport(file).ok).toBe(false);
  });

  it("rejects a non-numeric template color index", () => {
    const file = validFile();
    const [template] = file.templates;
    if (!template) throw new Error("fixture must contain a template");
    template.bot.avatarUi.color = "#a3a3a3" as unknown as number;
    expect(parseLibraryExport(file).ok).toBe(false);
  });
});
