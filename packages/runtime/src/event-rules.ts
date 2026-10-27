/**
 * Local event-rule evaluation (D20 slice).
 *
 * Scans the persisted event log from each rule's cursor and, for one
 * matching local event, starts one run through WorkflowEngine.startRun.
 * The scheduler is not involved. A second sighting of the same event
 * records `duplicate` and does not start another run. A disabled rule
 * records `skipped` and does not start a run. Events that already
 * happened before the rule was saved stay behind the cursor.
 *
 * Runs are started with a manual trigger whose idempotency key is derived
 * from (rule, event), so a crash between start and the ledger write still
 * collapses to the same run. This module does not open sockets.
 */
import { createHash } from "node:crypto";
import type { WorkflowEngine } from "./engine.js";
import {
  appendEventRuleRecord,
  findEventRulePrimary,
  listEventRules,
  setEventRuleCursor,
  wasRunStartedByEventRule,
  type OpenedDatabase,
} from "@deepseek-bot/storage";

export interface EventRuleEvaluation {
  readonly scanned: number;
  readonly started: number;
  readonly duplicates: number;
  readonly skipped: number;
}

interface EventRow {
  rowid: number;
  event_id: string;
  run_id: string;
  type: string;
}

/** Stable UUID-shaped key so the same event cannot start a second run. */
export function eventRuleIdempotencyKey(ruleId: string, eventId: string): string {
  const hash = createHash("sha256")
    .update("event-rule:")
    .update(ruleId)
    .update(":")
    .update(eventId)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function runInvolvesBot(db: OpenedDatabase, runId: string, botId: string): boolean {
  const row = db.raw
    .prepare("SELECT bot_snapshots_json, workflow_snapshot_json FROM runs WHERE id = ?;")
    .get(runId) as
    | { bot_snapshots_json: string; workflow_snapshot_json: string }
    | undefined;
  if (row === undefined) return false;
  return snapshotsIncludeBot(row.bot_snapshots_json, botId) || workflowIncludesBot(row.workflow_snapshot_json, botId);
}

function snapshotsIncludeBot(raw: string, botId: string): boolean {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return false;
    return value.some((item) => {
      if (item === null || typeof item !== "object") return false;
      return (item as { id?: unknown }).id === botId;
    });
  } catch {
    return false;
  }
}

function workflowIncludesBot(raw: string, botId: string): boolean {
  try {
    const value = JSON.parse(raw) as { nodes?: unknown };
    if (!Array.isArray(value.nodes)) return false;
    return value.nodes.some((node) => {
      if (node === null || typeof node !== "object") return false;
      const record = node as { type?: unknown; botId?: unknown };
      return record.type === "bot" && record.botId === botId;
    });
  } catch {
    return false;
  }
}

function findRunIdByIdempotency(db: OpenedDatabase, idempotencyKey: string): string | undefined {
  const row = db.raw
    .prepare("SELECT id FROM runs WHERE idempotency_key = ?;")
    .get(idempotencyKey) as { id: string } | undefined;
  return row?.id;
}

function truncate(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
}

/**
 * One pass over every rule, including disabled ones. Disabled matches are
 * skips. The cursor advances only after that rule's rows are handled.
 */
export function evaluateEventRules(
  db: OpenedDatabase,
  engine: WorkflowEngine,
): EventRuleEvaluation {
  let scanned = 0;
  let started = 0;
  let duplicates = 0;
  let skipped = 0;
  const maxRow = (
    db.raw.prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM events;").get() as { m: number }
  ).m;
  for (const rule of listEventRules(db)) {
    if (maxRow <= rule.cursorEventRowId) continue;
    const events = db.raw
      .prepare(
        "SELECT rowid, event_id, run_id, type FROM events WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC;",
      )
      .all(rule.cursorEventRowId, maxRow) as unknown as EventRow[];
    scanned += events.length;
    for (const event of events) {
      if (event.type !== rule.eventType) continue;
      if (!runInvolvesBot(db, event.run_id, rule.botId)) continue;
      const primary = findEventRulePrimary(db, rule.id, event.event_id);
      if (primary !== undefined) {
        appendEventRuleRecord(db, {
          ruleId: rule.id,
          eventId: event.event_id,
          outcome: "duplicate",
          runId: primary.runId,
          reason: "duplicate event",
        });
        duplicates += 1;
        continue;
      }
      if (!rule.enabled) {
        appendEventRuleRecord(db, {
          ruleId: rule.id,
          eventId: event.event_id,
          outcome: "skipped",
          runId: null,
          reason: "rule disabled",
        });
        skipped += 1;
        continue;
      }
      if (wasRunStartedByEventRule(db, event.run_id)) {
        appendEventRuleRecord(db, {
          ruleId: rule.id,
          eventId: event.event_id,
          outcome: "skipped",
          runId: null,
          reason: "source run was started by an event rule",
        });
        skipped += 1;
        continue;
      }
      const idempotencyKey = eventRuleIdempotencyKey(rule.id, event.event_id);
      try {
        const { run, created } = engine.startRun({
          workflowId: rule.workflowId,
          trigger: { kind: "manual", idempotencyKey },
        });
        if (!created) {
          appendEventRuleRecord(db, {
            ruleId: rule.id,
            eventId: event.event_id,
            outcome: "duplicate",
            runId: run.id,
            reason: "duplicate event",
          });
          duplicates += 1;
          continue;
        }
        appendEventRuleRecord(db, {
          ruleId: rule.id,
          eventId: event.event_id,
          outcome: "started",
          runId: run.id,
          reason: "matching local event",
        });
        started += 1;
      } catch (error) {
        const existingId = findRunIdByIdempotency(db, idempotencyKey);
        if (existingId !== undefined) {
          appendEventRuleRecord(db, {
            ruleId: rule.id,
            eventId: event.event_id,
            outcome: "started",
            runId: existingId,
            reason: "matching local event",
          });
          started += 1;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        appendEventRuleRecord(db, {
          ruleId: rule.id,
          eventId: event.event_id,
          outcome: "skipped",
          runId: null,
          reason: truncate(`event rule trigger failed: ${message}`),
        });
        skipped += 1;
      }
    }
    setEventRuleCursor(db, rule.id, maxRow);
  }
  return { scanned, started, duplicates, skipped };
}
