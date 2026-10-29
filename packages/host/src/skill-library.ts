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
import {
  EMPTY_SKILL_LIBRARY,
  SkillLibrarySchema,
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
