/**
 * Schedule repository (CONTRACTS.md §2 Schedule).
 *
 * Occurrence deduplication for schedule triggers lives on the runs table
 * (unique index on schedule + occurrenceUtc); this repo only manages the
 * schedule definitions themselves.
 */
import {
  MISFIRE_POLICY,
  ScheduleSchema,
  type Schedule,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { isoNow } from "./shared.js";

interface ScheduleRow {
  id: string;
  workflow_id: string;
  timezone: string;
  recurrence: string;
  next_run_at: string | null;
  enabled: 0 | 1;
  misfire_policy: string;
  created_at: string;
}

function rowToSchedule(row: ScheduleRow): Schedule {
  return ScheduleSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    timezone: row.timezone,
    recurrence: row.recurrence,
    nextRunAt: row.next_run_at,
    enabled: row.enabled === 1,
    misfirePolicy: row.misfire_policy,
  });
}

export function saveSchedule(db: OpenedDatabase, schedule: Schedule): Schedule {
  const parsed = ScheduleSchema.parse(schedule);
  const workflow = db.raw
    .prepare("SELECT id FROM workflows WHERE id = ?;")
    .get(parsed.workflowId);
  if (workflow === undefined) {
    throw invalidInput("workflow does not exist", { workflowId: parsed.workflowId });
  }
  const now = isoNow(db.now);
  db.raw
    .prepare(
      "INSERT INTO schedules (id, workflow_id, timezone, recurrence, next_run_at, enabled, " +
        "misfire_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone, " +
        "recurrence = excluded.recurrence, next_run_at = excluded.next_run_at, " +
        "enabled = excluded.enabled, misfire_policy = excluded.misfire_policy, " +
        "updated_at = excluded.updated_at;",
    )
    .run(
      parsed.id,
      parsed.workflowId,
      parsed.timezone,
      parsed.recurrence,
      parsed.nextRunAt,
      parsed.enabled ? 1 : 0,
      parsed.misfirePolicy,
      now,
      now,
    );
  return parsed;
}

export function getSchedule(db: OpenedDatabase, id: string): Schedule | undefined {
  const row = db.raw
    .prepare("SELECT * FROM schedules WHERE id = ?;")
    .get(id) as ScheduleRow | undefined;
  return row === undefined ? undefined : rowToSchedule(row);
}

export function listSchedules(
  db: OpenedDatabase,
  options: { workflowId?: string; enabledOnly?: boolean } = {},
): Schedule[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.workflowId !== undefined) {
    conditions.push("workflow_id = ?");
    params.push(options.workflowId);
  }
  if (options.enabledOnly === true) {
    conditions.push("enabled = 1");
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.raw
    .prepare(`SELECT * FROM schedules${where} ORDER BY created_at ASC, id ASC;`)
    .all(...params) as unknown as ScheduleRow[];
  return rows.map(rowToSchedule);
}

export function setScheduleEnabled(
  db: OpenedDatabase,
  input: { id: string; enabled: boolean },
): Schedule {
  const row = db.raw
    .prepare("SELECT * FROM schedules WHERE id = ?;")
    .get(input.id) as ScheduleRow | undefined;
  if (row === undefined) {
    throw invalidInput("schedule not found", { scheduleId: input.id });
  }
  db.raw
    .prepare("UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?;")
    .run(input.enabled ? 1 : 0, isoNow(db.now), input.id);
  const updated = db.raw
    .prepare("SELECT * FROM schedules WHERE id = ?;")
    .get(input.id) as unknown as ScheduleRow;
  return rowToSchedule(updated);
}

export function setScheduleNextRunAt(
  db: OpenedDatabase,
  input: { id: string; nextRunAt: string | null },
): Schedule {
  const row = db.raw
    .prepare("SELECT * FROM schedules WHERE id = ?;")
    .get(input.id) as ScheduleRow | undefined;
  if (row === undefined) {
    throw invalidInput("schedule not found", { scheduleId: input.id });
  }
  db.raw
    .prepare("UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE id = ?;")
    .run(input.nextRunAt, isoNow(db.now), input.id);
  const updated = db.raw
    .prepare("SELECT * FROM schedules WHERE id = ?;")
    .get(input.id) as unknown as ScheduleRow;
  return rowToSchedule(updated);
}

/** Kept as the single place that knows the v0.1 fixed misfire policy. */
export const SCHEDULE_MISFIRE_POLICY: typeof MISFIRE_POLICY = MISFIRE_POLICY;
