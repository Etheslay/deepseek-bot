/**
 * Local event rules for one bot (D20 slice).
 *
 * A rule watches the local `events` table for run.failed or run.completed
 * on runs that involve that bot. New rules are stored disabled. The cursor
 * starts at the current end of the event log so older rows are not replayed.
 * The evaluator (runtime) writes one primary record per (rule, event):
 * `started` or `skipped`. A later sighting of that same event is a
 * `duplicate` record and does not start another run. A rule with review
 * set holds one pending item per event instead of starting; approve and
 * deny write the primary record. A disabled rule still records a skip and
 * does not enter the queue.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";
import { getBot } from "./bots.js";
import { getWorkflow } from "./workflows.js";

export const EVENT_RULE_NAME_MAX = 200;
export const EVENT_RULE_REASON_MAX = 500;
export const EVENT_RULE_EVENT_TYPES = ["run.failed", "run.completed"] as const;
export type EventRuleEventType = (typeof EVENT_RULE_EVENT_TYPES)[number];
export const EVENT_RULE_OUTCOMES = ["started", "duplicate", "skipped"] as const;
export type EventRuleOutcome = (typeof EVENT_RULE_OUTCOMES)[number];

export interface EventRule {
  readonly id: string;
  readonly botId: string;
  readonly name: string;
  readonly workflowId: string;
  readonly eventType: EventRuleEventType;
  readonly enabled: boolean;
  /** When true, a match is queued for a local decision instead of started. */
  readonly review: boolean;
  /** Last scanned `events.rowid`. Rows at or below this are not replayed. */
  readonly cursorEventRowId: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EventRuleRecord {
  readonly id: string;
  readonly ruleId: string;
  readonly eventId: string;
  readonly outcome: EventRuleOutcome;
  readonly runId: string | null;
  readonly reason: string;
  readonly createdAt: string;
}

export const EVENT_RULE_REVIEW_STATUSES = ["pending", "approved", "denied"] as const;
export type EventRuleReviewStatus = (typeof EVENT_RULE_REVIEW_STATUSES)[number];

export interface EventRuleReview {
  readonly id: string;
  readonly ruleId: string;
  readonly eventId: string;
  readonly status: EventRuleReviewStatus;
  readonly runId: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

type RuleSqlRow = {
  id: string;
  bot_id: string;
  name: string;
  workflow_id: string;
  event_type: string;
  enabled: number;
  review: number;
  cursor_event_rowid: number;
  created_at: string;
  updated_at: string;
};

type RecordSqlRow = {
  id: string;
  rule_id: string;
  event_id: string;
  outcome: string;
  run_id: string | null;
  reason: string;
  created_at: string;
};

type ReviewSqlRow = {
  id: string;
  rule_id: string;
  event_id: string;
  status: string;
  run_id: string | null;
  created_at: string;
  decided_at: string | null;
};

function mapRule(row: RuleSqlRow): EventRule {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    workflowId: row.workflow_id,
    eventType: row.event_type as EventRuleEventType,
    enabled: row.enabled === 1,
    review: row.review === 1,
    cursorEventRowId: row.cursor_event_rowid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRecord(row: RecordSqlRow): EventRuleRecord {
  return {
    id: row.id,
    ruleId: row.rule_id,
    eventId: row.event_id,
    outcome: row.outcome as EventRuleOutcome,
    runId: row.run_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapReview(row: ReviewSqlRow): EventRuleReview {
  return {
    id: row.id,
    ruleId: row.rule_id,
    eventId: row.event_id,
    status: row.status as EventRuleReviewStatus,
    runId: row.run_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function ruleName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > EVENT_RULE_NAME_MAX) {
    throw invalidInput("event rule name must be between 1 and 200 characters");
  }
  return trimmed;
}

function requireEventType(eventType: string): EventRuleEventType {
  if (!(EVENT_RULE_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw invalidInput("event rule event type is not local", { eventType });
  }
  return eventType as EventRuleEventType;
}

/** The workflow must exist and include this live bot. */
function requireOwnedWorkflow(db: OpenedDatabase, botId: string, workflowId: string): void {
  const bot = getBot(db, botId);
  if (bot === undefined) {
    throw invalidInput("bot was not found", { botId });
  }
  if (bot.archivedAt !== null) {
    throw invalidInput("archived bots cannot own event rules", { botId });
  }
  const workflow = getWorkflow(db, workflowId);
  if (workflow === undefined) {
    throw invalidInput("workflow was not found", { workflowId });
  }
  const included = workflow.nodes.some((node) => node.type === "bot" && node.botId === botId);
  if (!included) {
    throw invalidInput("workflow does not include this bot", { botId, workflowId });
  }
}

function currentEventRowId(db: OpenedDatabase): number {
  const row = db.raw.prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM events;").get() as {
    m: number;
  };
  return row.m;
}

export function getEventRule(db: OpenedDatabase, id: string): EventRule | undefined {
  const row = db.raw.prepare("SELECT * FROM event_rules WHERE id = ?;").get(id) as
    | RuleSqlRow
    | undefined;
  return row === undefined ? undefined : mapRule(row);
}

export function listEventRules(db: OpenedDatabase, botId?: string): EventRule[] {
  const rows = (
    botId === undefined
      ? db.raw.prepare("SELECT * FROM event_rules ORDER BY created_at ASC, id ASC;").all()
      : db.raw
          .prepare(
            "SELECT * FROM event_rules WHERE bot_id = ? ORDER BY created_at ASC, id ASC;",
          )
          .all(botId)
  ) as unknown as RuleSqlRow[];
  return rows.map(mapRule);
}

export function saveEventRule(
  db: OpenedDatabase,
  input: {
    id?: string;
    botId: string;
    name: string;
    workflowId: string;
    eventType: EventRuleEventType;
  },
): EventRule {
  const at = isoNow(db.now);
  const name = ruleName(input.name);
  const eventType = requireEventType(input.eventType);
  requireOwnedWorkflow(db, input.botId, input.workflowId);
  try {
    if (input.id === undefined) {
      const id = randomUUID();
      db.raw
        .prepare(
          "INSERT INTO event_rules (id, bot_id, name, workflow_id, event_type, enabled, cursor_event_rowid, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?);",
        )
        .run(id, input.botId, name, input.workflowId, eventType, currentEventRowId(db), at, at);
      return getEventRule(db, id)!;
    }
    const existing = getEventRule(db, input.id);
    if (existing === undefined || existing.botId !== input.botId) {
      throw invalidInput("event rule was not found", { id: input.id });
    }
    db.raw
      .prepare(
        "UPDATE event_rules SET name = ?, workflow_id = ?, event_type = ?, updated_at = ? WHERE id = ? AND bot_id = ?;",
      )
      .run(name, input.workflowId, eventType, at, input.id, input.botId);
    return getEventRule(db, input.id)!;
  } catch (error) {
    constraintError(error, "save event rule");
  }
}

export function setEventRuleEnabled(
  db: OpenedDatabase,
  input: { id: string; botId: string; enabled: boolean },
): EventRule {
  const existing = getEventRule(db, input.id);
  if (existing === undefined || existing.botId !== input.botId) {
    throw invalidInput("event rule was not found", { id: input.id });
  }
  const at = isoNow(db.now);
  db.raw
    .prepare("UPDATE event_rules SET enabled = ?, updated_at = ? WHERE id = ? AND bot_id = ?;")
    .run(input.enabled ? 1 : 0, at, input.id, input.botId);
  return getEventRule(db, input.id)!;
}

/** Hold later matches for a local decision. Enabling is a separate switch. */
export function setEventRuleReview(
  db: OpenedDatabase,
  input: { id: string; botId: string },
): EventRule {
  const existing = getEventRule(db, input.id);
  if (existing === undefined || existing.botId !== input.botId) {
    throw invalidInput("event rule was not found", { id: input.id });
  }
  const at = isoNow(db.now);
  db.raw
    .prepare("UPDATE event_rules SET review = 1, updated_at = ? WHERE id = ? AND bot_id = ?;")
    .run(at, input.id, input.botId);
  return getEventRule(db, input.id)!;
}

/** Advance the scan cursor. Enabling a rule does not move it backwards. */
export function setEventRuleCursor(db: OpenedDatabase, id: string, rowId: number): void {
  const result = db.raw
    .prepare("UPDATE event_rules SET cursor_event_rowid = ? WHERE id = ?;")
    .run(rowId, id);
  if (Number(result.changes) !== 1) {
    throw invalidInput("event rule was not found", { id });
  }
}

/** The one started/skipped row for this event, when one exists. */
export function findEventRulePrimary(
  db: OpenedDatabase,
  ruleId: string,
  eventId: string,
): EventRuleRecord | undefined {
  const row = db.raw
    .prepare(
      "SELECT * FROM event_rule_records WHERE rule_id = ? AND event_id = ? AND outcome IN ('started', 'skipped') LIMIT 1;",
    )
    .get(ruleId, eventId) as RecordSqlRow | undefined;
  return row === undefined ? undefined : mapRecord(row);
}

export function wasRunStartedByEventRule(db: OpenedDatabase, runId: string): boolean {
  const row = db.raw
    .prepare(
      "SELECT 1 AS ok FROM event_rule_records WHERE outcome = 'started' AND run_id = ? LIMIT 1;",
    )
    .get(runId) as { ok: number } | undefined;
  return row !== undefined;
}

export function appendEventRuleRecord(
  db: OpenedDatabase,
  input: {
    ruleId: string;
    eventId: string;
    outcome: EventRuleOutcome;
    runId: string | null;
    reason: string;
  },
): EventRuleRecord {
  const reason = input.reason.trim().slice(0, EVENT_RULE_REASON_MAX);
  if (reason.length < 1) {
    throw invalidInput("event rule record reason is empty");
  }
  if (!(EVENT_RULE_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw invalidInput("event rule record outcome is invalid", { outcome: input.outcome });
  }
  const id = randomUUID();
  const at = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO event_rule_records (id, rule_id, event_id, outcome, run_id, reason, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?);",
      )
      .run(id, input.ruleId, input.eventId, input.outcome, input.runId, reason, at);
  } catch (error) {
    constraintError(error, "record event rule outcome");
  }
  return {
    id,
    ruleId: input.ruleId,
    eventId: input.eventId,
    outcome: input.outcome,
    runId: input.runId,
    reason,
    createdAt: at,
  };
}

export function listEventRuleRecords(
  db: OpenedDatabase,
  input: {
    botId: string;
    ruleId?: string;
    outcome?: EventRuleOutcome;
    limit: number;
  },
): EventRuleRecord[] {
  const params: Array<string | number> = [input.botId];
  let ruleClause = "";
  if (input.ruleId !== undefined) {
    ruleClause = " AND records.rule_id = ?";
    params.push(input.ruleId);
  }
  let outcomeClause = "";
  if (input.outcome !== undefined) {
    outcomeClause = " AND records.outcome = ?";
    params.push(input.outcome);
  }
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
  params.push(limit);
  const rows = db.raw
    .prepare(
      "SELECT records.* FROM event_rule_records AS records " +
        "JOIN event_rules AS rules ON rules.id = records.rule_id " +
        `WHERE rules.bot_id = ?${ruleClause}${outcomeClause} ` +
        "ORDER BY records.created_at DESC, records.id ASC LIMIT ?;",
    )
    .all(...params) as unknown as RecordSqlRow[];
  return rows.map(mapRecord);
}

export function getEventRuleReview(db: OpenedDatabase, id: string): EventRuleReview | undefined {
  const row = db.raw.prepare("SELECT * FROM event_rule_reviews WHERE id = ?;").get(id) as
    | ReviewSqlRow
    | undefined;
  return row === undefined ? undefined : mapReview(row);
}

/** The one review item for this event, including items that are already decided. */
export function findEventRuleReview(
  db: OpenedDatabase,
  ruleId: string,
  eventId: string,
): EventRuleReview | undefined {
  const row = db.raw
    .prepare("SELECT * FROM event_rule_reviews WHERE rule_id = ? AND event_id = ?;")
    .get(ruleId, eventId) as ReviewSqlRow | undefined;
  return row === undefined ? undefined : mapReview(row);
}

/** One pending item. A second insert for the same event fails the unique key. */
export function enqueueEventRuleReview(
  db: OpenedDatabase,
  input: { ruleId: string; eventId: string },
): EventRuleReview {
  const id = randomUUID();
  const at = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO event_rule_reviews (id, rule_id, event_id, status, run_id, created_at, decided_at) " +
          "VALUES (?, ?, ?, 'pending', NULL, ?, NULL);",
      )
      .run(id, input.ruleId, input.eventId, at);
  } catch (error) {
    constraintError(error, "enqueue event rule review");
  }
  return getEventRuleReview(db, id)!;
}

export function listPendingEventRuleReviews(
  db: OpenedDatabase,
  input: { botId: string; ruleId?: string; limit: number },
): EventRuleReview[] {
  const params: Array<string | number> = [input.botId];
  let ruleClause = "";
  if (input.ruleId !== undefined) {
    ruleClause = " AND reviews.rule_id = ?";
    params.push(input.ruleId);
  }
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
  params.push(limit);
  const rows = db.raw
    .prepare(
      "SELECT reviews.* FROM event_rule_reviews AS reviews " +
        "JOIN event_rules AS rules ON rules.id = reviews.rule_id " +
        `WHERE rules.bot_id = ? AND reviews.status = 'pending'${ruleClause} ` +
        "ORDER BY reviews.created_at DESC, reviews.id ASC LIMIT ?;",
    )
    .all(...params) as unknown as ReviewSqlRow[];
  return rows.map(mapReview);
}

/**
 * Close a pending item. The caller writes the started or skipped record.
 * A second decision finds the row is no longer pending.
 */
export function decideEventRuleReview(
  db: OpenedDatabase,
  input: { id: string; status: "approved" | "denied"; runId: string | null },
): EventRuleReview & { readonly decidedAt: string } {
  const existing = getEventRuleReview(db, input.id);
  if (existing === undefined) {
    throw invalidInput("event rule review was not found", { id: input.id });
  }
  if (existing.status !== "pending") {
    throw invalidInput("event rule review is not pending", { id: input.id });
  }
  const at = isoNow(db.now);
  const result = db.raw
    .prepare(
      "UPDATE event_rule_reviews SET status = ?, run_id = ?, decided_at = ? WHERE id = ? AND status = 'pending';",
    )
    .run(input.status, input.runId, at, input.id);
  if (Number(result.changes) !== 1) {
    throw invalidInput("event rule review is not pending", { id: input.id });
  }
  return {
    ...existing,
    status: input.status,
    runId: input.runId,
    decidedAt: at,
  };
}
