/**
 * Schedule miss repository (D10, CONTRACTS.md §2 misfirePolicy, FR-08).
 *
 * The v0.1 misfire policy is fixed to skip-and-notify: an occurrence whose
 * time passed while the host could not run it (sleep, shutdown, restart) is
 * never silently re-run in a batch; each missed occurrence is recorded here
 * so the UI can surface it (QA-10: 错过可见) and the scheduler advances to
 * the next future occurrence.
 */
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { isoNow } from "./shared.js";

interface ScheduleMissRow {
  id: string;
  schedule_id: string;
  occurrence_utc: string;
  reason: string;
  detected_at: string;
}

export interface ScheduleMiss {
  readonly id: string;
  readonly scheduleId: string;
  readonly occurrenceUtc: string;
  readonly reason: string;
  readonly detectedAt: string;
}

function rowToMiss(row: ScheduleMissRow): ScheduleMiss {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    occurrenceUtc: row.occurrence_utc,
    reason: row.reason,
    detectedAt: row.detected_at,
  };
}

export function recordScheduleMiss(
  db: OpenedDatabase,
  input: {
    id: string;
    scheduleId: string;
    occurrenceUtc: string;
    reason: string;
    detectedAt?: string;
  },
): ScheduleMiss {
  if (db.raw.prepare("SELECT id FROM schedules WHERE id = ?;").get(input.scheduleId) === undefined) {
    throw invalidInput("schedule not found", { scheduleId: input.scheduleId });
  }
  const detectedAt = input.detectedAt ?? isoNow(db.now);
  // Unique (schedule_id, occurrence_utc): recording the same missed
  // occurrence twice (two ticks, restart + tick) is a no-op.
  db.raw
    .prepare(
      "INSERT INTO schedule_misses (id, schedule_id, occurrence_utc, reason, detected_at) " +
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT(schedule_id, occurrence_utc) DO NOTHING;",
    )
    .run(input.id, input.scheduleId, input.occurrenceUtc, input.reason, detectedAt);
  const row = db.raw
    .prepare("SELECT * FROM schedule_misses WHERE schedule_id = ? AND occurrence_utc = ?;")
    .get(input.scheduleId, input.occurrenceUtc) as unknown as ScheduleMissRow;
  return rowToMiss(row);
}

export function listScheduleMisses(
  db: OpenedDatabase,
  options: { scheduleId?: string; limit?: number } = {},
): ScheduleMiss[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.scheduleId !== undefined) {
    conditions.push("schedule_id = ?");
    params.push(options.scheduleId);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit === undefined ? 100 : Math.max(1, Math.floor(options.limit));
  params.push(limit);
  const rows = db.raw
    .prepare(
      `SELECT * FROM schedule_misses${where} ORDER BY detected_at DESC, occurrence_utc DESC, id ASC LIMIT ?;`,
    )
    .all(...params) as unknown as ScheduleMissRow[];
  return rows.map(rowToMiss);
}
