/**
 * One-time legacy library migration (A2): imports the localStorage library
 * only while the Host library is empty, marks the window closed with an
 * idempotent flag, and never deletes the legacy payload — a failed import
 * keeps the old data for the next boot or the settings re-import.
 */
import { describe, expect, it, vi } from "vitest";
import type { SkillLibrary as ContractSkillLibrary } from "@deepseek-bot/contracts";
import {
  SKILLS_MIGRATION_MARKER,
  migrateLegacyLibrary,
  skillsMigrationDone,
} from "../../src/renderer/src/features/skills/library-migration.js";
import { LEGACY_SKILLS_STORAGE_KEY } from "../../src/renderer/src/features/skills/skills.js";

const SKILL = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "整理周报",
  instructions: "把要点整理成周报",
  capabilities: [],
  version: 2,
  createdAt: 1_730_000_000_000,
  updatedAt: 1_730_000_100_000,
};

const LEGACY_LIBRARY: ContractSkillLibrary = { skills: [SKILL], bindings: {} };
const LEGACY_RAW = JSON.stringify(LEGACY_LIBRARY);
const HOST_EMPTY: ContractSkillLibrary = { skills: [], bindings: {} };
const HOST_READY: ContractSkillLibrary = { skills: [SKILL], bindings: {} };

/** Minimal Storage stand-in; records removes so tests can pin "never deletes". */
function fakeStorage(initial: Record<string, string> = {}): Storage & { removals: string[] } {
  const map = new Map(Object.entries(initial));
  const removals: string[] = [];
  return {
    removals,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      removals.push(key);
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage & { removals: string[] };
}

function deps(storage: Storage, hostLibrary: ContractSkillLibrary) {
  const saveLibrary = vi.fn(async (library: ContractSkillLibrary) => ({ library }));
  return {
    saveLibrary,
    run: () => migrateLegacyLibrary({ storage, hostLibrary, saveLibrary }),
  };
}

describe("migrateLegacyLibrary", () => {
  it("imports the legacy library only when the Host library is empty", async () => {
    const withHostSkills = fakeStorage({ [LEGACY_SKILLS_STORAGE_KEY]: LEGACY_RAW });
    const ready = deps(withHostSkills, HOST_READY);
    await expect(ready.run()).resolves.toEqual({ outcome: "host", library: HOST_READY });
    expect(ready.saveLibrary).not.toHaveBeenCalled();
    expect(skillsMigrationDone(withHostSkills)).toBe(true);

    const empty = fakeStorage({ [LEGACY_SKILLS_STORAGE_KEY]: LEGACY_RAW });
    const migrating = deps(empty, HOST_EMPTY);
    await expect(migrating.run()).resolves.toEqual({
      outcome: "imported",
      library: LEGACY_LIBRARY,
    });
    expect(migrating.saveLibrary).toHaveBeenCalledWith(LEGACY_LIBRARY);
    expect(skillsMigrationDone(empty)).toBe(true);
  });

  it("treats the idempotent marker as done: no import after a settled boot", async () => {
    const storage = fakeStorage({
      [LEGACY_SKILLS_STORAGE_KEY]: LEGACY_RAW,
      [SKILLS_MIGRATION_MARKER]: "1",
    });
    const { saveLibrary, run } = deps(storage, HOST_EMPTY);
    await expect(run()).resolves.toEqual({ outcome: "skipped", library: HOST_EMPTY });
    expect(saveLibrary).not.toHaveBeenCalled();

    // Even after the user empties the Host library, the legacy copy stays retired.
    const settled = fakeStorage({ [LEGACY_SKILLS_STORAGE_KEY]: LEGACY_RAW });
    const first = deps(settled, HOST_EMPTY);
    await first.run();
    const again = deps(settled, HOST_EMPTY);
    await expect(again.run()).resolves.toEqual({ outcome: "skipped", library: HOST_EMPTY });
    expect(again.saveLibrary).not.toHaveBeenCalled();
  });

  it("keeps the legacy payload on failure and leaves the marker unset for a retry", async () => {
    const storage = fakeStorage({ [LEGACY_SKILLS_STORAGE_KEY]: LEGACY_RAW });
    const saveLibrary = vi.fn(async () => {
      throw new Error("host rejected the save");
    });
    await expect(
      migrateLegacyLibrary({ storage, hostLibrary: HOST_EMPTY, saveLibrary }),
    ).resolves.toEqual({ outcome: "failed", library: HOST_EMPTY });

    expect(storage.getItem(LEGACY_SKILLS_STORAGE_KEY)).toBe(LEGACY_RAW);
    expect(skillsMigrationDone(storage)).toBe(false);
    expect(storage.removals).toEqual([]);
  });

  it("marks the window closed when there is nothing to import", async () => {
    for (const legacy of [null, JSON.stringify(["a prompt template"]), "{not json"]) {
      const storage = fakeStorage(
        legacy === null ? {} : { [LEGACY_SKILLS_STORAGE_KEY]: legacy },
      );
      const { saveLibrary, run } = deps(storage, HOST_EMPTY);
      await expect(run()).resolves.toEqual({ outcome: "empty", library: HOST_EMPTY });
      expect(saveLibrary).not.toHaveBeenCalled();
      expect(skillsMigrationDone(storage)).toBe(true);
    }
  });
});
