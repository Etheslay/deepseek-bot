/**
 * Event trigger rules and their review-queue firings (D20, FR-17).
 *
 * A rule watches the persisted event stream (`events` table) from a
 * per-rule cursor; matching events enqueue a FIRING that a human approves
 * or dismisses — nothing auto-starts. One event fires a rule at most once
 * (UNIQUE rule+event); runs the queue itself started carry started_run_id
 * and are skipped during evaluation (loop guard). Events that accumulated
 * before the host could evaluate them enqueue with reason "missed" —
 * visible in the queue, never silently replayed.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow, runInTransaction } from "./shared.js";

export const TRIGGER_NAME_MAX = 200;
export const TRIGGER_EVENT_TYPES = ["run.failed", "run.completed"] as const;
export type TriggerEventType = (typeof TRIGGER_EVENT_TYPES)[number];

export interface TriggerRuleRow {
  readonly id: string;
  readonly name: string;
  readonly workflowId: string;
  readonly eventType: TriggerEventType;
  readonly filterWorkflowId: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TriggerFiringRow {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly workflowId: string;
  readonly eventType: TriggerEventType;
  readonly sourceEventId: string;
  readonly sourceRunId: string | null;
  readonly sourceWorkflowId: string | null;
  readonly reason: "event" | "missed";
  readonly status: "pending" | "approved" | "dismissed";
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

type RuleSqlRow = {
  id: string;
  name: string;
  workflow_id: string;
  event_type: string;
  filter_workflow_id: string | null;
  enabled: number;
  cursor_event_rowid: number;
  created_at: string;
  updated_at: string;
};

type FiringSqlRow = {
  id: string;
  rule_id: string;
  rule_name: string;
  workflow_id: string;
  event_type: string;
  source_event_id: string;
  source_run_id: string | null;
  source_workflow_id: string | null;
  reason: string;
  status: string;
  created_at: string;
  decided_at: string | null;
};

function mapRule(row: RuleSqlRow): TriggerRuleRow {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflow_id,
    eventType: row.event_type as TriggerEventType,
    filterWorkflowId: row.filter_workflow_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFiring(row: FiringSqlRow): TriggerFiringRow {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    workflowId: row.workflow_id,
    eventType: row.event_type as TriggerEventType,
    sourceEventId: row.source_event_id,
    sourceRunId: row.source_run_id,
    sourceWorkflowId: row.source_workflow_id,
    reason: row.reason as "event" | "missed",
    status: row.status as "pending" | "approved" | "dismissed",
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function ruleName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > TRIGGER_NAME_MAX) {
    throw invalidInput("trigger name must be between 1 and 200 characters");
  }
  return trimmed;
}

/** The target workflow must exist; the optional source filter too. */
function requireWorkflow(db: OpenedDatabase, workflowId: string, label: string): void {
  const row = db.raw.prepare("SELECT id FROM workflows WHERE id = ?;").get(workflowId);
  if (row === undefined) {
    throw invalidInput(`${label} workflow does not exist`, { workflowId });
  }
}

export function saveTriggerRule(
  db: OpenedDatabase,
  input: {
    id?: string;
    name: string;
    workflowId: string;
    eventType: TriggerEventType;
    filterWorkflowId?: string | null;
  },
): TriggerRuleRow {
  const at = isoNow(db.now);
  const id = input.id ?? randomUUID();
  requireWorkflow(db, input.workflowId, "target");
  const filter = input.filterWorkflowId ?? null;
  if (filter !== null) requireWorkflow(db, filter, "source filter");
  try {
    if (input.id === undefined) {
      db.raw
        .prepare(
          "INSERT INTO trigger_rules (id, name, workflow_id, event_type, filter_workflow_id, enabled, cursor_event_rowid, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?);",
        )
        .run(id, ruleName(input.name), input.workflowId, input.eventType, filter, at, at);
    } else {
      const result = db.raw
        .prepare(
          "UPDATE trigger_rules SET name = ?, workflow_id = ?, event_type = ?, filter_workflow_id = ?, updated_at = ? WHERE id = ?;",
        )
        .run(ruleName(input.name), input.workflowId, input.eventType, filter, at, id);
      if (Number(result.changes) !== 1) throw invalidInput("trigger rule was not found");
    }
  } catch (error) {
    constraintError(error, "save trigger rule");
  }
  return getTriggerRule(db, id)!;
}

function selectRule(db: OpenedDatabase, id: string): RuleSqlRow | undefined {
  return db.raw.prepare("SELECT * FROM trigger_rules WHERE id = ?;").get(id) as
    | RuleSqlRow
    | undefined;
}

export function getTriggerRule(db: OpenedDatabase, id: string): TriggerRuleRow | undefined {
  const row = selectRule(db, id);
  return row === undefined ? undefined : mapRule(row);
}

export function listTriggerRules(db: OpenedDatabase): TriggerRuleRow[] {
  const rows = db.raw
    .prepare("SELECT * FROM trigger_rules ORDER BY created_at ASC, id ASC;")
    .all() as unknown as RuleSqlRow[];
  return rows.map(mapRule);
}

export function setTriggerEnabled(
  db: OpenedDatabase,
  input: { id: string; enabled: boolean },
): TriggerRuleRow {
  const at = isoNow(db.now);
  const result = db.raw
    .prepare("UPDATE trigger_rules SET enabled = ?, updated_at = ? WHERE id = ?;")
    .run(input.enabled ? 1 : 0, at, input.id);
  if (Number(result.changes) !== 1) throw invalidInput("trigger rule was not found");
  return getTriggerRule(db, input.id)!;
}

/** Deleting a rule cascades to its firings (review queue items included). */
export function deleteTriggerRule(db: OpenedDatabase, id: string): void {
  const result = db.raw.prepare("DELETE FROM trigger_rules WHERE id = ?;").run(id);
  if (Number(result.changes) !== 1) throw invalidInput("trigger rule was not found");
}

/**
 * Record one firing. Returns false when the (rule, source event) pair
 * already fired — the dedup guard that keeps one event to one firing.
 */
export function recordTriggerFiring(
  db: OpenedDatabase,
  input: {
    ruleId: string;
    ruleName: string;
    workflowId: string;
    eventType: TriggerEventType;
    sourceEventId: string;
    sourceRunId: string | null;
    sourceWorkflowId: string | null;
    reason: "event" | "missed";
  },
): boolean {
  const at = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO trigger_firings (id, rule_id, source_event_id, source_run_id, source_workflow_id, reason, status, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?);",
      )
      .run(
        randomUUID(),
        input.ruleId,
        input.sourceEventId,
        input.sourceRunId,
        input.sourceWorkflowId,
        input.reason,
        at,
      );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) return false;
    constraintError(error, "record trigger firing");
  }
}

const FIRING_SELECT =
  "SELECT f.*, r.name AS rule_name, r.workflow_id, r.event_type AS event_type FROM trigger_firings f " +
  "JOIN trigger_rules r ON r.id = f.rule_id";

export function listTriggerFirings(
  db: OpenedDatabase,
  input: { status?: "pending" | "approved" | "dismissed"; limit?: number } = {},
): TriggerFiringRow[] {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw invalidInput("firing limit must be between 1 and 100");
  }
  const rows = (
    input.status === undefined
      ? db.raw
          .prepare(`${FIRING_SELECT} ORDER BY f.created_at DESC, f.rowid DESC LIMIT ?;`)
          .all(limit)
      : db.raw
          .prepare(
            `${FIRING_SELECT} WHERE f.status = ? ORDER BY f.created_at DESC, f.rowid DESC LIMIT ?;`,
          )
          .all(input.status, limit)
  ) as unknown as FiringSqlRow[];
  return rows.map(mapFiring);
}

export function getTriggerFiring(
  db: OpenedDatabase,
  id: string,
): TriggerFiringRow | undefined {
  const row = db.raw.prepare(`${FIRING_SELECT} WHERE f.id = ?;`).get(id) as
    | FiringSqlRow
    | undefined;
  return row === undefined ? undefined : mapFiring(row);
}

/**
 * Decide a pending firing. `start` records the run it started (the loop
 * guard reads this); only pending firings are decidable.
 */
export function decideTriggerFiring(
  db: OpenedDatabase,
  input: { firingId: string; decision: "start" | "dismiss"; startedRunId?: string },
): TriggerFiringRow {
  return runInTransaction(db.raw, () => {
    const row = db.raw
      .prepare("SELECT status FROM trigger_firings WHERE id = ?;")
      .get(input.firingId) as { status: string } | undefined;
    if (row === undefined) throw invalidInput("trigger firing was not found");
    if (row.status !== "pending") {
      throw invalidInput("trigger firing was already decided");
    }
    db.raw
      .prepare(
        "UPDATE trigger_firings SET status = ?, started_run_id = ?, decided_at = ? WHERE id = ?;",
      )
      .run(
        input.decision === "start" ? "approved" : "dismissed",
        input.startedRunId ?? null,
        isoNow(db.now),
        input.firingId,
      );
    return getTriggerFiring(db, input.firingId)!;
  });
}

/** The loop guard: true when this run was started from the review queue. */
export function isTriggerStartedRun(db: OpenedDatabase, runId: string): boolean {
  const row = db.raw
    .prepare("SELECT id FROM trigger_firings WHERE started_run_id = ? LIMIT 1;")
    .get(runId);
  return row !== undefined;
}

/** Advance a rule's event-stream cursor after a scan. */
export function updateTriggerCursor(db: OpenedDatabase, ruleId: string, cursor: number): void {
  db.raw
    .prepare("UPDATE trigger_rules SET cursor_event_rowid = ?, updated_at = ? WHERE id = ?;")
    .run(cursor, isoNow(db.now), ruleId);
}

/** The rule's current event-stream cursor (events with rowid > cursor are new). */
export function getTriggerCursor(db: OpenedDatabase, ruleId: string): number {
  const row = db.raw
    .prepare("SELECT cursor_event_rowid FROM trigger_rules WHERE id = ?;")
    .get(ruleId) as { cursor_event_rowid: number };
  return row.cursor_event_rowid;
}
