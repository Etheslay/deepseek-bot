/**
 * Skill library persistence (D17', protocol v0.11).
 *
 * The D17 skill library (instruction blocks + per-bot bindings) lives in one
 * settings KV row. The row is written only through the contract-validated
 * `skillLibrary.save` handler and read back through `SkillLibrarySchema`: a
 * corrupt or hand-edited row degrades to an empty library instead of failing
 * the desktop. Injection and capability enforcement are untouched — they ride
 * `chat.send.skills` and the tool gateway exactly as before.
 */
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_IDS,
  EMPTY_SKILL_LIBRARY,
  MAX_CHAT_SKILL_CAPABILITIES,
  MAX_CHAT_SKILL_INSTRUCTIONS,
  MAX_CHAT_SKILLS,
  MAX_LIBRARY_SKILLS,
  SkillLibrarySchema,
  TEXT_LIMITS,
  type CapabilityId,
  type ChatSkillInjection,
  type SkillDefinition,
  type SkillLibrary,
} from "@deepseek-bot/contracts";
import { getSettingRaw, setSetting, type OpenedDatabase } from "@deepseek-bot/storage";

export const SKILL_LIBRARY_SETTING = "skills.library.v1";

/**
 * Read the persisted library. Missing and schema-invalid rows both answer the
 * empty library — the desktop migrates its localStorage copy in that case.
 */
export function readSkillLibrary(db: OpenedDatabase): SkillLibrary {
  const parsed = SkillLibrarySchema.safeParse(getSettingRaw(db, SKILL_LIBRARY_SETTING));
  return parsed.success ? parsed.data : { ...EMPTY_SKILL_LIBRARY };
}

/** Replace the whole library. Callers must have validated via the contract. */
export function writeSkillLibrary(db: OpenedDatabase, library: SkillLibrary): void {
  setSetting(db, SKILL_LIBRARY_SETTING, library);
}

const MAX_BOUND_SKILLS = 30;

export interface LearnedSkillView {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly description?: string;
}

export interface LearnSkillInput {
  readonly name: string;
  readonly instructions: string;
  readonly description?: string;
}

/**
 * Save a skill and bind it to this bot. The same name updates that skill
 * and still binds it here. Capabilities stay as they were (empty on a new
 * skill) so learning instructions does not narrow the bot's tools.
 */
export function learnSkillForBot(
  db: OpenedDatabase,
  botId: string,
  input: LearnSkillInput,
  nowMs: number = Date.now(),
): { created: boolean; skill: LearnedSkillView } {
  const name = input.name.trim();
  const instructions = input.instructions.trim();
  const description = input.description?.trim() ?? "";
  if (name.length < 1 || name.length > TEXT_LIMITS.name) {
    throw new Error("skill name must be 1 to 200 characters");
  }
  if (instructions.length < 1 || instructions.length > MAX_CHAT_SKILL_INSTRUCTIONS) {
    throw new Error("skill instructions must be 1 to 4000 characters");
  }
  if (description.length > 500) {
    throw new Error("skill description must be at most 500 characters");
  }
  const library = readSkillLibrary(db);
  const existing = library.skills.find((skill) => skill.name === name);
  if (existing === undefined && library.skills.length >= MAX_LIBRARY_SKILLS) {
    throw new Error("the skill library is full");
  }
  const bound = library.bindings[botId] ?? [];
  if (existing === undefined && bound.length >= MAX_BOUND_SKILLS) {
    throw new Error("this bot already has the maximum number of skills");
  }
  if (existing !== undefined && !bound.includes(existing.id) && bound.length >= MAX_BOUND_SKILLS) {
    throw new Error("this bot already has the maximum number of skills");
  }
  const skill: SkillDefinition = existing
    ? {
        ...existing,
        name,
        instructions,
        ...(description.length > 0 ? { description } : {}),
        version: existing.version + 1,
        updatedAt: nowMs,
      }
    : {
        id: randomUUID(),
        name,
        instructions,
        capabilities: [],
        version: 1,
        createdAt: nowMs,
        updatedAt: nowMs,
        ...(description.length > 0 ? { description } : {}),
      };
  const skills = existing
    ? library.skills.map((entry) => (entry.id === skill.id ? skill : entry))
    : [...library.skills, skill];
  const bindings = { ...library.bindings };
  if (!bound.includes(skill.id)) {
    bindings[botId] = [...bound, skill.id];
  }
  writeSkillLibrary(db, SkillLibrarySchema.parse({ skills, bindings }));
  return {
    created: existing === undefined,
    skill: {
      id: skill.id,
      name: skill.name,
      version: skill.version,
      ...(skill.description !== undefined ? { description: skill.description } : {}),
    },
  };
}

export function listSkillsForBot(db: OpenedDatabase, botId: string): LearnedSkillView[] {
  const library = readSkillLibrary(db);
  const byId = new Map(library.skills.map((skill) => [skill.id, skill]));
  return (library.bindings[botId] ?? []).flatMap((id) => {
    const skill = byId.get(id);
    if (skill === undefined) return [];
    return [
      {
        id: skill.id,
        name: skill.name,
        version: skill.version,
        ...(skill.description !== undefined ? { description: skill.description } : {}),
      },
    ];
  });
}

function knownCapabilities(raw: readonly string[]): CapabilityId[] {
  const out: CapabilityId[] = [];
  for (const token of raw) {
    if (!(CAPABILITY_IDS as readonly string[]).includes(token)) continue;
    const id = token as CapabilityId;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_CHAT_SKILL_CAPABILITIES) break;
  }
  return out;
}

function injectionFromStored(skill: SkillDefinition): ChatSkillInjection | undefined {
  const name = skill.name.trim();
  const instructions = skill.instructions.trim().slice(0, MAX_CHAT_SKILL_INSTRUCTIONS);
  if (name.length < 1 || name.length > TEXT_LIMITS.name || instructions.length < 1) {
    return undefined;
  }
  return {
    name,
    version: skill.version,
    instructions,
    capabilities: knownCapabilities(skill.capabilities),
  };
}

/**
 * Skills bound to this bot, then any send-time skills whose names are not
 * already bound. The stored copy wins when both sides name the same skill,
 * so a skill the bot just learned is what the next turn follows.
 */
export function mergeTurnSkills(
  db: OpenedDatabase,
  botId: string,
  payload: readonly ChatSkillInjection[],
): ChatSkillInjection[] {
  const library = readSkillLibrary(db);
  const byId = new Map(library.skills.map((skill) => [skill.id, skill]));
  const names = new Set<string>();
  const merged: ChatSkillInjection[] = [];
  for (const id of library.bindings[botId] ?? []) {
    const skill = byId.get(id);
    if (skill === undefined) continue;
    const injection = injectionFromStored(skill);
    if (injection === undefined || names.has(injection.name)) continue;
    merged.push(injection);
    names.add(injection.name);
  }
  for (const skill of payload) {
    if (names.has(skill.name)) continue;
    merged.push(skill);
    names.add(skill.name);
  }
  return merged.slice(0, MAX_CHAT_SKILLS);
}
