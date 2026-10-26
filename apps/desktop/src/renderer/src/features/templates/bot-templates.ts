/**
 * Bot templates (D17 renderer-first slice): the user can save any bot as a
 * reusable template and start a new bot from it. Storage is localStorage
 * (host persistence arrives with the skills/templates gateway hookup);
 * templates are inert data — applying one only pre-fills the create form.
 */
export type BotTemplate = {
  id: string;
  name: string;
  createdAt: string;
  bot: {
    name: string;
    instructions: string;
    /** The avatar picker state captured with the bot (pure data object). */
    avatarUi: { avatar: unknown; shape: number; color: number };
  };
};

const STORAGE_KEY = "deepseek-bot.bot-templates.v1";
export const MAX_TEMPLATES = 30;

export function listTemplates(storage: Storage): BotTemplate[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is BotTemplate =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as BotTemplate).id === "string" &&
        typeof (item as BotTemplate).bot?.name === "string" &&
        typeof (item as BotTemplate).bot?.instructions === "string",
    );
  } catch {
    return [];
  }
}

export function saveTemplate(
  storage: Storage,
  template: Omit<BotTemplate, "id" | "createdAt">,
): { ok: true; template: BotTemplate } | { ok: false; reason: "limit" | "duplicate" } {
  const existing = listTemplates(storage);
  if (existing.length >= MAX_TEMPLATES) {
    return { ok: false, reason: "limit" };
  }
  if (existing.some((item) => item.bot.name === template.bot.name)) {
    return { ok: false, reason: "duplicate" };
  }
  const full: BotTemplate = {
    ...template,
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...existing, full]));
  } catch {
    return { ok: false, reason: "limit" };
  }
  return { ok: true, template: full };
}

export function deleteTemplate(storage: Storage, id: string): BotTemplate[] {
  const next = listTemplates(storage).filter((item) => item.id !== id);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // deletion at least reflected in the returned list this session
  }
  return next;
}
