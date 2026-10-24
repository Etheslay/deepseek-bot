/**
 * Persistent event repository (CONTRACTS.md §4).
 *
 * Sequences are strictly increasing per run and unique per (runId, sequence).
 * Appends are deduplicated by eventId so at-least-once redelivery cannot
 * double-record an event; replay by `afterSequence` powers crash reconnection.
 */
import {
  EventEnvelopeSchema,
  parseEventPayload,
  type EventEnvelope,
  type EventType,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { parseJsonColumn, runInTransaction, stringifyJson } from "./shared.js";

interface EventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload_json: string;
}

function rowToEnvelope(row: EventRow): EventEnvelope {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    type: row.type as EventType,
    payload: parseJsonColumn(EventEnvelopeSchema.shape.payload, row.payload_json, "event payload"),
  };
}

export interface AppendEventResult {
  /** False when an event with the same eventId was already recorded. */
  readonly recorded: boolean;
  readonly sequence: number;
}

export function appendEvent(
  db: OpenedDatabase,
  event: EventEnvelope,
): AppendEventResult {
  const parsed = EventEnvelopeSchema.parse(event);
  const payloadCheck = parseEventPayload(parsed);
  if (!payloadCheck.success) {
    throw invalidInput("event payload does not match its type schema", {
      eventType: parsed.type,
      issues: payloadCheck.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
  }
  if (db.raw.prepare("SELECT id FROM runs WHERE id = ?;").get(parsed.runId) === undefined) {
    throw invalidInput("run does not exist", { runId: parsed.runId });
  }

  return runInTransaction(db.raw, () => {
    const existing = db.raw
      .prepare("SELECT sequence FROM events WHERE event_id = ?;")
      .get(parsed.eventId) as { sequence: number } | undefined;
    if (existing !== undefined) {
      return { recorded: false, sequence: existing.sequence };
    }
    const maxRow = db.raw
      .prepare("SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM events WHERE run_id = ?;")
      .get(parsed.runId) as { max_seq: number };
    if (parsed.sequence !== maxRow.max_seq + 1) {
      throw invalidInput("event sequence must be the next value for the run", {
        runId: parsed.runId,
        expectedSequence: maxRow.max_seq + 1,
        receivedSequence: parsed.sequence,
      });
    }
    db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) " +
          "VALUES (?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.eventId,
        parsed.runId,
        parsed.sequence,
        parsed.timestamp,
        parsed.type,
        stringifyJson(parsed.payload),
      );
    return { recorded: true, sequence: parsed.sequence };
  });
}

export interface ListEventsOptions {
  /** Events with sequence > afterSequence are returned (replay semantics). */
  readonly afterSequence?: number;
  readonly limit?: number;
}

export function listEvents(
  db: OpenedDatabase,
  runId: string,
  options: ListEventsOptions = {},
): EventEnvelope[] {
  const after = options.afterSequence ?? -1;
  const limit = options.limit === undefined ? 1_000 : Math.max(1, Math.floor(options.limit));
  const rows = db.raw
    .prepare(
      "SELECT * FROM events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?;",
    )
    .all(runId, after, limit) as unknown as EventRow[];
  return rows.map(rowToEnvelope);
}

export function maxEventSequence(db: OpenedDatabase, runId: string): number {
  const row = db.raw
    .prepare("SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM events WHERE run_id = ?;")
    .get(runId) as { max_seq: number };
  return row.max_seq;
}
