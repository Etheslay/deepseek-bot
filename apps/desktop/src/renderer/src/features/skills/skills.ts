import {
  CAPABILITY_IDS,
  MAX_CHAT_SKILL_CAPABILITIES,
  MAX_CHAT_SKILL_INSTRUCTIONS,
  MAX_CHAT_SKILLS,
  TEXT_LIMITS,
  type CapabilityId,
  type ChatSkillInjection,
  type SkillLibrary as ContractSkillLibrary,
} from "@deepseek-bot/contracts";

/**
 * Skill library (D17 renderer slice, D17' host persistence).
 *
 * A skill is a named, versioned block of reusable instructions with declared
 * capability ids. The durable copy lives in the Host (`skillLibrary.get` /
 * `skillLibrary.save`, protocol v0.11) — this module owns the pure library
 * operations only and no longer writes localStorage. `loadSkills` stays for
 * the one-time migration and the degraded no-Host fallback; the composer's
 * prompt-template store keeps writing its own array shape to the same legacy
 * key, which no longer collides with anything.
 *
 * A send passes the bound snapshot to the Host (`skillsForInjection`); the
 * Host injects the instructions and the tool gateway enforces declared
 * capability ids. `buildSkillContext` remains the fence-safe block shape the
 * Host mirrors.
 */
export type SkillDefinition = {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  /**
   * Declared capability ids. Unknown strings are kept in the library so an
   * older file still loads; a send refuses them instead of ignoring them.
   */
  capabilities: string[];
  /** Starts at 1 and increments on every edit. */
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type SkillLibrary = {
  skills: SkillDefinition[];
  /** botId → ordered skill ids (order is the context assembly order). */
  bindings: Record<string, string[]>;
};

export type SaveSkillInput = {
  /** Omit to create; pass an existing id to edit (bumps the version). */
  id?: string;
  name: string;
  description?: string;
  instructions: string;
  capabilities?: string[];
  /**
   * Create only: version to start from (default 1). Used by the import path so
   * a re-imported skill keeps the version it had when exported.
   */
  version?: number;
};

export type SaveSkillResult =
  | { ok: true; skill: SkillDefinition; library: SkillLibrary }
  | { ok: false; reason: "duplicate" | "limit" | "missing" | "invalid" };

const STORAGE_KEY = "deepseek-bot.skills.v1";
/** The same key, exposed for the one-time Host migration (library-migration). */
export const LEGACY_SKILLS_STORAGE_KEY = STORAGE_KEY;
export const MAX_SKILLS = 30;
export const MAX_SKILL_CONTEXT_CHARS = 4000;

export function emptyLibrary(): SkillLibrary {
  return { skills: [], bindings: {} };
}

/**
 * Adapt a contract-parsed library (from `skillLibrary.get`/`save`) to the
 * renderer shape: under `exactOptionalPropertyTypes` the zod-inferred
 * `description?: string | undefined` is not assignable to the local
 * `description?: string`, so a present-but-undefined description is dropped
 * here instead of leaking into state.
 */
export function toRendererLibrary(hostLibrary: ContractSkillLibrary): SkillLibrary {
  return {
    skills: hostLibrary.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.description !== undefined ? { description: skill.description } : {}),
      instructions: skill.instructions,
      capabilities: [...skill.capabilities],
      version: skill.version,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    })),
    bindings: Object.fromEntries(
      Object.entries(hostLibrary.bindings).map(([botId, ids]) => [botId, [...ids]]),
    ),
  };
}

export function newSkillId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `skill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSkill(value: unknown): value is SkillDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SkillDefinition>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.instructions === "string" &&
    candidate.instructions.trim().length > 0 &&
    typeof candidate.version === "number" &&
    Number.isInteger(candidate.version) &&
    candidate.version >= 1 &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every((entry) => typeof entry === "string")
  );
}

function isBindingMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (entry) =>
      Array.isArray(entry) && entry.every((id) => typeof id === "string"),
  );
}

/**
 * Read the library from a parsed payload. Corrupt payloads degrade to an
 * empty library rather than throwing, mirroring `settings-store.ts`. When
 * `knownBotIds` is given, the bindings pointing at bots that no longer exist
 * are pruned (and the pruned result is not written back — the caller decides
 * when to persist).
 */
function parseLibrary(parsed: unknown, knownBotIds?: readonly string[]): SkillLibrary {
  if (typeof parsed !== "object" || parsed === null) {
    return emptyLibrary();
  }
  const record = parsed as { skills?: unknown; bindings?: unknown };
  const skills = Array.isArray(record.skills)
    ? record.skills.filter(isSkill)
    : [];
  const knownSkillIds = new Set(skills.map((skill) => skill.id));
  const rawBindings = isBindingMap(record.bindings) ? record.bindings : {};
  const bindings: Record<string, string[]> = {};
  for (const [botId, ids] of Object.entries(rawBindings)) {
    if (knownBotIds && !knownBotIds.includes(botId)) {
      continue;
    }
    const kept = ids.filter((id) => knownSkillIds.has(id));
    if (kept.length > 0) {
      bindings[botId] = kept;
    }
  }
  return { skills, bindings };
}

export function loadSkills(
  storage: Storage,
  knownBotIds?: readonly string[],
): SkillLibrary {
  let parsed: unknown;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return emptyLibrary();
    }
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return emptyLibrary();
  }
  return parseLibrary(parsed, knownBotIds);
}

/**
 * One-time migration candidate (D17'): parse the raw localStorage payload and
 * return it only when it is the LIBRARY shape with at least one skill. The
 * composer prompt-template store writes an ARRAY to the same legacy key — an
 * array payload returns null so that store stays untouched.
 */
export function localLibraryCandidate(raw: string | null): SkillLibrary | null {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    return null;
  }
  const library = parseLibrary(parsed);
  return library.skills.length > 0 ? library : null;
}

/**
 * Create (no id) or edit (existing id). Pure: the caller persists the returned
 * library through `skillLibrary.save`. Names are compared after trimming;
 * editing a skill never collides with itself.
 */
export function saveSkill(
  library: SkillLibrary,
  input: SaveSkillInput,
): SaveSkillResult {
  const name = input.name.trim();
  const instructions = input.instructions.trim();
  if (name.length === 0 || instructions.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  const existing = input.id
    ? library.skills.find((skill) => skill.id === input.id)
    : undefined;
  if (input.id && !existing) {
    return { ok: false, reason: "missing" };
  }
  if (!existing && library.skills.length >= MAX_SKILLS) {
    return { ok: false, reason: "limit" };
  }
  const duplicate = library.skills.some(
    (skill) => skill.id !== input.id && skill.name === name,
  );
  if (duplicate) {
    return { ok: false, reason: "duplicate" };
  }
  const now = Date.now();
  const description = input.description?.trim();
  const descriptionField = description ? { description } : {};
  const skill: SkillDefinition = existing
    ? {
        ...existing,
        name,
        ...descriptionField,
        instructions,
        capabilities: input.capabilities ?? existing.capabilities,
        version: existing.version + 1,
        updatedAt: now,
      }
    : {
        id: newSkillId(),
        name,
        ...descriptionField,
        instructions,
        capabilities: input.capabilities ?? [],
        version:
          input.version && Number.isInteger(input.version) && input.version >= 1
            ? input.version
            : 1,
        createdAt: now,
        updatedAt: now,
      };
  const skills = existing
    ? library.skills.map((entry) => (entry.id === skill.id ? skill : entry))
    : [...library.skills, skill];
  const next: SkillLibrary = { ...library, skills };
  return { ok: true, skill, library: next };
}

/** Remove a skill and every binding that referenced it. */
export function deleteSkill(library: SkillLibrary, id: string): SkillLibrary {
  const skills = library.skills.filter((skill) => skill.id !== id);
  const bindings: Record<string, string[]> = {};
  for (const [botId, ids] of Object.entries(library.bindings)) {
    const kept = ids.filter((entry) => entry !== id);
    if (kept.length > 0) {
      bindings[botId] = kept;
    }
  }
  return { skills, bindings };
}

/** Bind an ordered list of skills to a bot; an empty list unbinds. */
export function setBotSkills(
  library: SkillLibrary,
  botId: string,
  skillIds: readonly string[],
): SkillLibrary {
  const known = new Set(library.skills.map((skill) => skill.id));
  const ordered = skillIds.filter(
    (id, index) => known.has(id) && skillIds.indexOf(id) === index,
  );
  const bindings = { ...library.bindings };
  if (ordered.length === 0) {
    delete bindings[botId];
  } else {
    bindings[botId] = ordered;
  }
  return { ...library, bindings };
}

const CAPABILITY_ID_SET = new Set<string>(CAPABILITY_IDS);

export type SkillInjectionResult =
  | { ok: true; skills: ChatSkillInjection[] }
  | { ok: false; reason: "unknown-capability"; skill: string; capability: string }
  | { ok: false; reason: "too-many-capabilities"; skill: string }
  | { ok: false; reason: "too-many-skills"; skill: string }
  | { ok: false; reason: "invalid"; skill: string };

/**
 * Snapshot of the skills bound to a bot, shaped for `chat.send`.
 * Does not read or write the Host. Unknown capability strings fail the
 * send so a typo cannot silently skip enforcement.
 */
export function skillsForInjection(
  botId: string | null | undefined,
  library: SkillLibrary,
): SkillInjectionResult {
  const bound = skillsForBot(library, botId);
  if (bound.length > MAX_CHAT_SKILLS) {
    return { ok: false, reason: "too-many-skills", skill: bound[MAX_CHAT_SKILLS]?.name ?? "" };
  }
  const skills: ChatSkillInjection[] = [];
  for (const skill of bound) {
    const name = skill.name.trim();
    if (name.length === 0 || name.length > TEXT_LIMITS.name) {
      return { ok: false, reason: "invalid", skill: skill.name };
    }
    const capabilities: CapabilityId[] = [];
    for (const raw of skill.capabilities) {
      const token = raw.trim();
      if (token.length === 0) continue;
      if (!CAPABILITY_ID_SET.has(token)) {
        return { ok: false, reason: "unknown-capability", skill: name, capability: token };
      }
      const id = token as CapabilityId;
      if (!capabilities.includes(id)) capabilities.push(id);
    }
    if (capabilities.length > MAX_CHAT_SKILL_CAPABILITIES) {
      return { ok: false, reason: "too-many-capabilities", skill: name };
    }
    const instructions = skill.instructions.trim().slice(0, MAX_CHAT_SKILL_INSTRUCTIONS);
    if (instructions.length === 0) continue;
    skills.push({
      name,
      version: skill.version,
      instructions,
      capabilities,
    });
  }
  return { ok: true, skills };
}

export function skillsForBot(
  library: SkillLibrary,
  botId: string | null | undefined,
): SkillDefinition[] {
  if (!botId) {
    return [];
  }
  const ids = library.bindings[botId] ?? [];
  const byId = new Map(library.skills.map((skill) => [skill.id, skill]));
  return ids
    .map((id) => byId.get(id))
    .filter((skill): skill is SkillDefinition => skill !== undefined);
}

/** Longest run of backticks in the text, so the fence can outgrow it. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    if (char === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * Compose the bound skills into a bounded, fence-safe context block for the
 * outgoing message. Returns an empty string when the bot has no bindings, so
 * callers can skip concatenation entirely.
 */
export function buildSkillContext(
  botId: string | null | undefined,
  library: SkillLibrary,
): string {
  const skills = skillsForBot(library, botId);
  if (skills.length === 0) {
    return "";
  }
  const body = skills
    .map((skill) => `### ${skill.name}（v${skill.version}）\n${skill.instructions}`)
    .join("\n\n");
  const capped =
    body.length > MAX_SKILL_CONTEXT_CHARS
      ? // i18n-ignore: model-facing skill context, not interface copy
        `${body.slice(0, MAX_SKILL_CONTEXT_CHARS)}\n…（技能上下文已截断）`
      : body;
  const fence = "`".repeat(Math.max(3, longestBacktickRun(capped) + 1));
  return [
    // i18n-ignore: model-facing skill context, not interface copy
    `已为该 bot 启用 ${skills.length} 个技能（按绑定顺序）：`,
    fence,
    capped,
    fence,
  ].join("\n");
}
