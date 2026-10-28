/**
 * Local device-action records (D21).
 *
 * One exact once approval appends one row: id, bot id, action name, and time.
 * The action name is the gate's closed set, `pointer` or `key`. This module
 * does not move a pointer, send a key, or call the exec daemon.
 */
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { constraintError } from "./shared.js";

export const DEVICE_ACTION_NAMES = ["pointer", "key"] as const;
export type DeviceActionName = (typeof DEVICE_ACTION_NAMES)[number];

/** One accepted device action. Denied, disabled, and reused approvals are absent. */
export interface DeviceActionRecord {
  readonly id: string;
  readonly botId: string;
  readonly action: DeviceActionName;
  readonly createdAt: string;
}

type RecordSqlRow = {
  id: string;
  bot_id: string;
  action: string;
  created_at: string;
};

function requireActionName(action: string): DeviceActionName {
  if (action === "pointer" || action === "key") return action;
  throw invalidInput("device action name is unknown", { action });
}

function mapRecord(row: RecordSqlRow): DeviceActionRecord {
  return {
    id: row.id,
    botId: row.bot_id,
    action: requireActionName(row.action),
    createdAt: row.created_at,
  };
}

/** Persist one accepted action. Unknown names are rejected before the insert. */
export function appendDeviceActionRecord(
  db: OpenedDatabase,
  input: { id: string; botId: string; action: string; at: string },
): DeviceActionRecord {
  const action = requireActionName(input.action);
  try {
    db.raw
      .prepare(
        "INSERT INTO device_action_records (id, bot_id, action, created_at) VALUES (?, ?, ?, ?);",
      )
      .run(input.id, input.botId, action, input.at);
  } catch (error) {
    constraintError(error, "record device action");
  }
  return { id: input.id, botId: input.botId, action, createdAt: input.at };
}

/** Accepted actions for one bot, newest first. */
export function listDeviceActionRecords(
  db: OpenedDatabase,
  input: { botId: string; limit: number },
): DeviceActionRecord[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, action, created_at FROM device_action_records " +
        "WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?;",
    )
    .all(input.botId, limit) as unknown as RecordSqlRow[];
  return rows.map(mapRecord);
}
