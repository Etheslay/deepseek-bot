/**
 * Skills (D17 renderer-first slice): named, versioned prompt templates the
 * user can reuse from the composer. Storage is localStorage until the
 * skills gateway hookup; applying a skill only touches the composer draft.
 * `{{输入}}` in a prompt absorbs the current draft when present.
 */
export type Skill = {
  id: string;
  name: string;
  prompt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "deepseek-bot.skills.v1";
export const MAX_SKILLS = 20;
export const SKILL_INPUT_PLACEHOLDER = "{{输入}}";

export function listSkills(storage: Storage): Skill[] {
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
      (item): item is Skill =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Skill).id === "string" &&
        typeof (item as Skill).name === "string" &&
        typeof (item as Skill).prompt === "string" &&
        typeof (item as Skill).version === "number",
    );
  } catch {
    return [];
  }
}

export type SkillUpsertInput = { name: string; prompt: string };

/** Upsert by name: same name bumps the version, new name creates v1. */
export function upsertSkill(
  storage: Storage,
  input: SkillUpsertInput,
): { ok: true; skill: Skill } | { ok: false; reason: "limit" | "empty" } {
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (name.length === 0 || prompt.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const existing = listSkills(storage);
  if (existing.length >= MAX_SKILLS && !existing.some((s) => s.name === name)) {
    return { ok: false, reason: "limit" };
  }
  const now = new Date().toISOString();
  const current = existing.find((s) => s.name === name);
  const skill: Skill = current
    ? { ...current, prompt, version: current.version + 1, updatedAt: now }
    : {
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        prompt,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
  const next = current
    ? existing.map((s) => (s.id === skill.id ? skill : s))
    : [...existing, skill];
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: "limit" };
  }
  return { ok: true, skill };
}

export function deleteSkill(storage: Storage, id: string): Skill[] {
  const next = listSkills(storage).filter((s) => s.id !== id);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // the returned list still reflects the deletion for this session
  }
  return next;
}

/** Prompt → final draft: `{{输入}}` absorbs the current draft when present,
 * otherwise the prompt lands in the composer for the user to complete. */
export function applySkill(skill: Skill, currentDraft: string): string {
  const draft = currentDraft.trim();
  if (skill.prompt.includes(SKILL_INPUT_PLACEHOLDER)) {
    return skill.prompt.split(SKILL_INPUT_PLACEHOLDER).join(draft);
  }
  return draft.length > 0 ? `${skill.prompt}\n\n${draft}` : skill.prompt;
}
