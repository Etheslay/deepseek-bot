/**
 * One-time legacy library import (D17' migration, A2).
 *
 * Skills used to live in localStorage under `deepseek-bot.skills.v1`; the
 * durable copy is the Host library now. On boot, when the Host answers with
 * an empty library, the legacy payload imports once through `skillLibrary.save`.
 * Every settled boot writes the idempotent `skills.library.migrated.v1`
 * marker so the import never runs again — without it, deleting every skill in
 * the Host library would resurrect the legacy copy on the next start.
 *
 * A failed import keeps the legacy payload untouched (the settings
 * 导入/导出 file path stays available) and leaves the marker unset, so the
 * next boot retries. The composer prompt-template store writes an ARRAY to
 * the same legacy key; array payloads are never migrated and count as
 * "nothing to import".
 */
import {
  METHOD_CONTRACTS,
  type SkillLibrary as ContractSkillLibrary,
} from "@deepseek-bot/contracts";
import { LEGACY_SKILLS_STORAGE_KEY, localLibraryCandidate } from "./skills.js";

/** Idempotency flag in localStorage: set once the migration window is closed. */
export const SKILLS_MIGRATION_MARKER = "skills.library.migrated.v1";

export function skillsMigrationDone(storage: Storage): boolean {
  return storage.getItem(SKILLS_MIGRATION_MARKER) !== null;
}

function markMigrated(storage: Storage): void {
  try {
    storage.setItem(SKILLS_MIGRATION_MARKER, "1");
  } catch {
    // Private mode / quota: the marker stays unset and the next boot retries.
  }
}

export type LegacyMigrationOutcome =
  /** Marker already set: the Host library is authoritative, nothing runs. */
  | "skipped"
  /** The Host library has skills; the migration window closes now. */
  | "host"
  /** The legacy payload imported through skillLibrary.save. */
  | "imported"
  /** Host empty and no legacy library payload (absent, corrupt or template array). */
  | "empty"
  /** The import call failed; the legacy payload stays for a retry or manual import. */
  | "failed";

export type LegacyMigrationResult = {
  outcome: LegacyMigrationOutcome;
  /** The contract library to display (the saved one on import). */
  library: ContractSkillLibrary;
};

export async function migrateLegacyLibrary(deps: {
  storage: Storage;
  /** Parsed `skillLibrary.get` response library. */
  hostLibrary: ContractSkillLibrary;
  /** Forwards to `skillLibrary.save`; resolves with the raw response. */
  saveLibrary: (library: ContractSkillLibrary) => Promise<unknown>;
}): Promise<LegacyMigrationResult> {
  const { storage, hostLibrary, saveLibrary } = deps;
  if (skillsMigrationDone(storage)) {
    return { outcome: "skipped", library: hostLibrary };
  }
  if (hostLibrary.skills.length > 0) {
    markMigrated(storage);
    return { outcome: "host", library: hostLibrary };
  }
  const candidate = localLibraryCandidate(storage.getItem(LEGACY_SKILLS_STORAGE_KEY));
  if (candidate === null) {
    markMigrated(storage);
    return { outcome: "empty", library: hostLibrary };
  }
  try {
    const saved = METHOD_CONTRACTS["skillLibrary.save"].response.parse(
      await saveLibrary(candidate),
    ).library;
    markMigrated(storage);
    return { outcome: "imported", library: saved };
  } catch {
    return { outcome: "failed", library: hostLibrary };
  }
}
