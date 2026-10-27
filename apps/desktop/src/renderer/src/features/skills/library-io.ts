/**
 * Library import/export (D17 renderer slice).
 *
 * One JSON file carries both skills and bot templates. The file is validated by
 * the shared contract schema (`parseLibraryExport`) and rejected as a whole when
 * invalid — no partial imports. Merging is name-based and never overwrites:
 * entries whose name already exists locally are skipped and counted.
 *
 * Pure functions over `Storage` + strings: file picking and downloading stay in
 * the UI layer so this module stays unit-testable.
 */
import {
  LIBRARY_EXPORT_FORMAT,
  LIBRARY_EXPORT_FORMAT_VERSION,
  parseLibraryExport,
  type LibraryExportFile,
  type SkillExport,
  type TemplateExport,
} from "@deepseek-bot/contracts";
import {
  listTemplates,
  saveTemplate,
} from "../templates/bot-templates.js";
import { loadSkills, saveSkill, type SkillLibrary } from "./skills.js";
import { t } from "../../i18n.js";

export type ImportSummary = {
  addedSkills: number;
  skippedSkills: number;
  addedTemplates: number;
  skippedTemplates: number;
};

export type ImportResult =
  | { ok: true; summary: ImportSummary; library: SkillLibrary }
  | { ok: false; reason: string };

/** Build the unified export file text (2-space indent, contract-valid). */
export function exportLibrary(
  storage: Storage,
  now: Date = new Date(),
): string {
  const library = loadSkills(storage);
  const templates = listTemplates(storage);
  const file: LibraryExportFile = {
    format: LIBRARY_EXPORT_FORMAT,
    formatVersion: LIBRARY_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    skills: library.skills.map(
      (skill): SkillExport => ({
        id: skill.id,
        name: skill.name,
        ...(skill.description === undefined
          ? {}
          : { description: skill.description }),
        instructions: skill.instructions,
        capabilities: skill.capabilities,
        version: skill.version,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      }),
    ),
    templates: templates.map(
      (template): TemplateExport => ({
        name: template.name,
        bot: {
          name: template.bot.name,
          instructions: template.bot.instructions,
          avatarUi: {
            avatar: template.bot
              .avatarUi
              .avatar as unknown as TemplateExport["bot"]["avatarUi"]["avatar"],
            shape: template.bot.avatarUi.shape,
            color: template.bot.avatarUi.color,
          },
        },
      }),
    ),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Validate and merge an export file. Same-name entries are skipped (skills by
 * skill name, templates by bot name); nothing existing is overwritten.
 */
export function importLibrary(
  storage: Storage,
  library: SkillLibrary,
  text: string,
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: t("skills.invalidJson") };
  }
  const validated = parseLibraryExport(parsed);
  if (!validated.ok) {
    return { ok: false, reason: t("skills.validationFailed", [validated.reason]) };
  }
  const summary: ImportSummary = {
    addedSkills: 0,
    skippedSkills: 0,
    addedTemplates: 0,
    skippedTemplates: 0,
  };

  let current = library;
  const takenSkillNames = new Set(
    library.skills.map((skill) => skill.name.trim()),
  );
  for (const skill of validated.file.skills) {
    const name = skill.name.trim();
    if (takenSkillNames.has(name)) {
      summary.skippedSkills += 1;
      continue;
    }
    const saved = saveSkill(storage, current, {
      name,
      instructions: skill.instructions,
      ...(skill.description === undefined
        ? {}
        : { description: skill.description }),
      capabilities: skill.capabilities,
      version: skill.version,
    });
    if (!saved.ok) {
      summary.skippedSkills += 1;
      continue;
    }
    takenSkillNames.add(saved.skill.name);
    current = saved.library;
    summary.addedSkills += 1;
  }

  const takenBotNames = new Set(
    listTemplates(storage).map((template) => template.bot.name),
  );
  for (const template of validated.file.templates) {
    if (takenBotNames.has(template.bot.name)) {
      summary.skippedTemplates += 1;
      continue;
    }
    const saved = saveTemplate(storage, {
      name: template.name,
      bot: {
        name: template.bot.name,
        instructions: template.bot.instructions,
        avatarUi: template.bot
          .avatarUi as unknown as Parameters<typeof saveTemplate>[1]["bot"]["avatarUi"],
      },
    });
    if (!saved.ok) {
      summary.skippedTemplates += 1;
      continue;
    }
    takenBotNames.add(saved.template.bot.name);
    summary.addedTemplates += 1;
  }

  return { ok: true, summary, library: current };
}
