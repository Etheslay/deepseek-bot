/**
 * Trigger evaluation (D20, FR-17). Rules watch the persisted event stream
 * from a per-rule cursor; matching events enqueue a FIRING for human
 * review. This module only reads events/runs and writes firings — the
 * actual workflow start happens in the review decision (trigger.firing.decide).
 *
 * Protections, all database-level:
 * - dedup: a firing is unique per (rule, source event) — one event fires once;
 * - loop guard: runs the queue itself started (trigger_firings.started_run_id)
 *   never enqueue new firings, so failed remediations cannot cascade forever;
 * - missed visibility: events older than this host's boot enqueue with
 *   reason "missed" — visible in the queue, never silently replayed.
 */
import {
  getTriggerCursor,
  isTriggerStartedRun,
  listTriggerRules,
  recordTriggerFiring,
  updateTriggerCursor,
  type OpenedDatabase,
} from "@deepseek-bot/storage";

export interface TriggerEvaluationResult {
  readonly scanned: number;
  readonly enqueued: number;
  readonly missed: number;
}

interface EventRow {
  rowid: number;
  event_id: string;
  run_id: string;
  type: string;
  timestamp: string;
}

function sourceWorkflowOf(db: OpenedDatabase, runId: string): string | null {
  const row = db.raw
    .prepare("SELECT workflow_snapshot_json FROM runs WHERE id = ?;")
    .get(runId) as { workflow_snapshot_json: string } | undefined;
  if (row === undefined) return null;
  try {
    const id = (JSON.parse(row.workflow_snapshot_json) as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** Scan every enabled rule once. Cheap at local scale; safe to call often. */
export function evaluateTriggerRules(
  db: OpenedDatabase,
  options: { bootAt: Date },
): TriggerEvaluationResult {
  let scanned = 0;
  let enqueued = 0;
  let missed = 0;
  const maxRow = (
    db.raw.prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM events;").get() as { m: number }
  ).m;
  for (const rule of listTriggerRules(db)) {
    if (!rule.enabled) continue;
    const cursor = getTriggerCursor(db, rule.id);
    if (maxRow <= cursor) continue;
    const events = db.raw
      .prepare(
        "SELECT rowid, event_id, run_id, type, timestamp FROM events WHERE rowid > ? AND rowid <= ? ORDER BY rowid ASC;",
      )
      .all(cursor, maxRow) as unknown as EventRow[];
    scanned += events.length;
    for (const event of events) {
      if (event.type !== rule.eventType) continue;
      const sourceWorkflowId = sourceWorkflowOf(db, event.run_id);
      if (rule.filterWorkflowId !== null && sourceWorkflowId !== rule.filterWorkflowId) {
        continue;
      }
      if (isTriggerStartedRun(db, event.run_id)) continue;
      const late = new Date(event.timestamp).getTime() < options.bootAt.getTime();
      const created = recordTriggerFiring(db, {
        ruleId: rule.id,
        ruleName: rule.name,
        workflowId: rule.workflowId,
        eventType: rule.eventType,
        sourceEventId: event.event_id,
        sourceRunId: event.run_id,
        sourceWorkflowId,
        reason: late ? "missed" : "event",
      });
      if (created) {
        enqueued += 1;
        if (late) missed += 1;
      }
    }
    updateTriggerCursor(db, rule.id, maxRow);
  }
  return { scanned, enqueued, missed };
}
