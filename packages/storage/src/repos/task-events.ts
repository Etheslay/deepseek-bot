/**
 * Task event repository (v0.5 manager orchestration).
 *
 * The run event log is foreign-keyed to `runs`, so dispatched-task
 * transitions persist here with the same delivery semantics: appends are
 * deduplicated by eventId (at-least-once redelivery cannot double-record),
 * sequences are strictly increasing per task and replay starts after any
 * `afterSequence` (CONTRACTS §4).
 */
import {
  TaskEventEnvelopeSchema,
  parseTaskEventPayload,
  type TaskEventEnvelope,
  type TaskEventType,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { parseJsonColumn, runInTransaction, stringifyJson } from "./shared.js";

interface TaskEventRow {
  event_id: string;
  task_id: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload_json: string;
}

function rowToEnvelope(row: TaskEventRow): TaskEventEnvelope {
  return {
    eventId: row.event_id,
    taskId: row.task_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    type: row.type as TaskEventType,
    payload: parseJsonColumn(
      TaskEventEnvelopeSchema.shape.payload,
      row.payload_json,
      "task event payload",
    ),
  };
}

export interface AppendTaskEventResult {
  /** False when an event with the same eventId was already recorded. */
  readonly recorded: boolean;
  readonly sequence: number;
}

export function appendTaskEvent(
  db: OpenedDatabase,
  event: TaskEventEnvelope,
): AppendTaskEventResult {
  const parsed = TaskEventEnvelopeSchema.parse(event);
  const payloadCheck = parseTaskEventPayload(parsed);
  if (!payloadCheck.success) {
    throw invalidInput("task event payload does not match its type schema", {
      eventType: parsed.type,
      issues: payloadCheck.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
  }
  if (db.raw.prepare("SELECT id FROM tasks WHERE id = ?;").get(parsed.taskId) === undefined) {
    throw invalidInput("task does not exist", { taskId: parsed.taskId });
  }

  return runInTransaction(db.raw, () => {
    const existing = db.raw
      .prepare("SELECT sequence FROM task_events WHERE event_id = ?;")
      .get(parsed.eventId) as { sequence: number } | undefined;
    if (existing !== undefined) {
      return { recorded: false, sequence: existing.sequence };
    }
    const maxRow = db.raw
      .prepare("SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM task_events WHERE task_id = ?;")
      .get(parsed.taskId) as { max_seq: number };
    if (parsed.sequence !== maxRow.max_seq + 1) {
      throw invalidInput("task event sequence must be the next value for the task", {
        taskId: parsed.taskId,
        expectedSequence: maxRow.max_seq + 1,
        receivedSequence: parsed.sequence,
      });
    }
    db.raw
      .prepare(
        "INSERT INTO task_events (event_id, task_id, sequence, timestamp, type, payload_json) " +
          "VALUES (?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.eventId,
        parsed.taskId,
        parsed.sequence,
        parsed.timestamp,
        parsed.type,
        stringifyJson(payloadCheck.data),
      );
    return { recorded: true, sequence: parsed.sequence };
  });
}

export function listTaskEvents(
  db: OpenedDatabase,
  taskId: string,
  options: { afterSequence?: number; limit?: number } = {},
): TaskEventEnvelope[] {
  const after = options.afterSequence ?? -1;
  const limit = options.limit === undefined ? 1_000 : Math.max(1, Math.floor(options.limit));
  const rows = db.raw
    .prepare(
      "SELECT * FROM task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?;",
    )
    .all(taskId, after, limit) as unknown as TaskEventRow[];
  return rows.map(rowToEnvelope);
}

export function maxTaskEventSequence(db: OpenedDatabase, taskId: string): number {
  const row = db.raw
    .prepare("SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM task_events WHERE task_id = ?;")
    .get(taskId) as { max_seq: number };
  return row.max_seq;
}
