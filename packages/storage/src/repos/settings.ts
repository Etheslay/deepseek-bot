/**
 * Generic settings key/value store (theme, window state, etc.).
 *
 * Values are JSON; structural validation is the caller's job because the
 * settings surface is defined by the UI tasks (FR-01 settings persistence).
 */
import type { OpenedDatabase } from "../database.js";
import { isoNow } from "./shared.js";

export function getSettingRaw(db: OpenedDatabase, key: string): unknown | undefined {
  const row = db.raw
    .prepare("SELECT value_json FROM settings WHERE key = ?;")
    .get(key) as { value_json: string } | undefined;
  if (row === undefined) {
    return undefined;
  }
  return JSON.parse(row.value_json) as unknown;
}

export function setSetting(db: OpenedDatabase, key: string, value: unknown): void {
  if (key === "") {
    throw new Error("settings key must not be empty");
  }
  const json = JSON.stringify(value);
  db.raw
    .prepare(
      "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, " +
        "updated_at = excluded.updated_at;",
    )
    .run(key, json, isoNow(db.now));
}

export function deleteSetting(db: OpenedDatabase, key: string): boolean {
  const result = db.raw.prepare("DELETE FROM settings WHERE key = ?;").run(key);
  return Number(result.changes) > 0;
}

export function listSettingKeys(db: OpenedDatabase): string[] {
  const rows = db.raw.prepare("SELECT key FROM settings ORDER BY key ASC;").all() as unknown as Array<{
    key: string;
  }>;
  return rows.map((row) => row.key);
}

// ---------------------------------------------------------------------------
// Host boot generation (CONTRACTS §2 Approval: 启动代次绑定)
// ---------------------------------------------------------------------------

const BOOT_GENERATION_KEY = "host.boot_generation";

/** Current boot generation; 0 before the first increment. */
export function getBootGeneration(db: OpenedDatabase): number {
  const value = getSettingRaw(db, BOOT_GENERATION_KEY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/**
 * Bump and return the boot generation. The Host calls this exactly once at
 * startup; approvals created afterwards bind to the returned value, so
 * approvals left over from a previous process can no longer be decided or
 * consumed (FR-06: 重启后旧审批不能直接重放).
 */
export function incrementBootGeneration(db: OpenedDatabase): number {
  const next = getBootGeneration(db) + 1;
  setSetting(db, BOOT_GENERATION_KEY, next);
  return next;
}
