/**
 * Run and NodeRun repositories (CONTRACTS.md §2, §5).
 *
 * Status transitions are delegated to the contract state machines
 * (`assertRunTransition` / `assertNodeRunTransition`); storage refuses
 * transitions the contract forbids. Runs are created with the
 * idempotencyKey unique index, so duplicate `run.start` submissions with the
 * same key return the existing run (CONTRACTS §3). Schedule triggers are
 * deduplicated per (scheduleId, occurrenceUtc).
 */
import {
  assertNodeRunTransition,
  assertRunTransition,
  NodeRunSchema,
  RunSchema,
  TransitionError,
  type NodeRun,
  type Run,
  type RunStatus,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput, runtimeUnavailable } from "../errors.js";
import { isoNow, parseJsonColumn, runInTransaction, stringifyJson } from "./shared.js";

export const ACTIVE_RUN_STATUSES: ReadonlyArray<RunStatus> = [
  "queued",
  "running",
  "waiting_approval",
  "cancelling",
];

interface RunRow {
  id: string;
  status: string;
  trigger_json: string;
  workflow_snapshot_json: string;
  bot_snapshots_json: string;
  resumed_from_run_id: string | null;
  idempotency_key: string;
  created_at: string;
  finished_at: string | null;
}

function rowToRun(row: RunRow): Run {
  return RunSchema.parse({
    id: row.id,
    workflowSnapshot: parseJsonColumn(
      RunSchema.shape.workflowSnapshot,
      row.workflow_snapshot_json,
      "run workflow snapshot",
    ),
    botSnapshots: parseJsonColumn(
      RunSchema.shape.botSnapshots,
      row.bot_snapshots_json,
      "run bot snapshots",
    ),
    status: row.status,
    trigger: parseJsonColumn(RunSchema.shape.trigger, row.trigger_json, "run trigger"),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    resumedFromRunId: row.resumed_from_run_id ?? undefined,
  });
}

export interface CreateRunResult {
  readonly run: Run;
  readonly created: boolean;
  /** Set when an existing run was returned because of a duplicate key. */
  readonly duplicateOf?: RunStatus;
}

export function createRun(db: OpenedDatabase, run: Run): CreateRunResult {
  const parsed = RunSchema.parse(run);
  if (parsed.status !== "queued") {
    throw invalidInput("runs are created in the queued status", { status: parsed.status });
  }

  const byIdempotency = db.raw
    .prepare("SELECT * FROM runs WHERE idempotency_key = ?;")
    .get(parsed.trigger.idempotencyKey) as RunRow | undefined;
  if (byIdempotency !== undefined) {
    return { run: rowToRun(byIdempotency), created: false };
  }
  if (
    parsed.trigger.kind === "schedule" &&
    parsed.trigger.scheduleId !== undefined &&
    parsed.trigger.occurrenceUtc !== undefined
  ) {
    const byOccurrence = db.raw
      .prepare(
        "SELECT * FROM runs WHERE trigger_kind = 'schedule' AND trigger_schedule_id = ? " +
          "AND trigger_occurrence_utc = ?;",
      )
      .get(parsed.trigger.scheduleId, parsed.trigger.occurrenceUtc) as RunRow | undefined;
    if (byOccurrence !== undefined) {
      return { run: rowToRun(byOccurrence), created: false };
    }
  }

  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO runs (id, status, trigger_kind, trigger_schedule_id, trigger_occurrence_utc, " +
          "trigger_json, workflow_snapshot_json, bot_snapshots_json, resumed_from_run_id, " +
          "idempotency_key, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.status,
        parsed.trigger.kind,
        parsed.trigger.scheduleId ?? null,
        parsed.trigger.occurrenceUtc ?? null,
        stringifyJson(parsed.trigger),
        stringifyJson(parsed.workflowSnapshot),
        stringifyJson(parsed.botSnapshots),
        parsed.resumedFromRunId ?? null,
        parsed.trigger.idempotencyKey,
        now,
        null,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      // Lost a race against a concurrent insert with the same key.
      const winner = db.raw
        .prepare("SELECT * FROM runs WHERE idempotency_key = ?;")
        .get(parsed.trigger.idempotencyKey) as RunRow | undefined;
      if (winner !== undefined) {
        return { run: rowToRun(winner), created: false };
      }
    }
    throw error;
  }
  return { run: parsed, created: true };
}

export function getRun(db: OpenedDatabase, id: string): Run | undefined {
  const row = db.raw.prepare("SELECT * FROM runs WHERE id = ?;").get(id) as unknown as RunRow | undefined;
  return row === undefined ? undefined : rowToRun(row);
}

export interface ListRunsOptions {
  readonly statuses?: ReadonlyArray<RunStatus>;
  readonly limit?: number;
}

export function listRuns(db: OpenedDatabase, options: ListRunsOptions = {}): Run[] {
  const params: Array<string | number> = [];
  let where = "";
  if (options.statuses !== undefined && options.statuses.length > 0) {
    const placeholders = options.statuses.map(() => "?").join(", ");
    where = ` WHERE status IN (${placeholders})`;
    params.push(...options.statuses);
  }
  const limit = options.limit === undefined ? 100 : Math.max(1, Math.floor(options.limit));
  params.push(limit);
  const rows = db.raw
    .prepare(
      `SELECT * FROM runs${where} ORDER BY created_at DESC, id DESC LIMIT ?;`,
    )
    .all(...params) as unknown as RunRow[];
  return rows.map(rowToRun);
}

/** Count runs that must not be active during backup/restore. */
export function countActiveRuns(db: OpenedDatabase): number {
  const placeholders = ACTIVE_RUN_STATUSES.map(() => "?").join(", ");
  const row = db.raw
    .prepare(`SELECT COUNT(*) AS count FROM runs WHERE status IN (${placeholders});`)
    .get(...ACTIVE_RUN_STATUSES) as { count: number };
  return row.count;
}

export function assertNoActiveRuns(db: OpenedDatabase): void {
  const active = countActiveRuns(db);
  if (active > 0) {
    throw runtimeUnavailable("active runs must be stopped before this operation", {
      activeRuns: active,
    });
  }
}

/** Apply a contract-checked status transition; terminal states set finishedAt. */
export function transitionRun(
  db: OpenedDatabase,
  input: { id: string; to: RunStatus },
): Run {
  return runInTransaction(db.raw, () => {
    const row = db.raw.prepare("SELECT * FROM runs WHERE id = ?;").get(input.id) as
      | RunRow
      | undefined;
    if (row === undefined) {
      throw invalidInput("run not found", { runId: input.id });
    }
    try {
      assertRunTransition(row.status as RunStatus, input.to);
    } catch (error) {
      if (error instanceof TransitionError) {
        throw invalidInput(error.message, {
          runId: input.id,
          from: error.from,
          to: error.to,
        });
      }
      throw error;
    }
    const finishedAt = isTerminal(input.to) ? isoNow(db.now) : null;
    db.raw
      .prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?;")
      .run(input.to, finishedAt, input.id);
    const updated = db.raw.prepare("SELECT * FROM runs WHERE id = ?;").get(input.id) as unknown as RunRow;
    return rowToRun(updated);
  });
}

function isTerminal(status: RunStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted"
  );
}

// ---------------------------------------------------------------------------
// Node runs
// ---------------------------------------------------------------------------

interface NodeRunRow {
  id: string;
  run_id: string;
  node_id: string;
  attempt: number;
  status: string;
  input_refs_json: string;
  output_refs_json: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToNodeRun(row: NodeRunRow): NodeRun {
  return NodeRunSchema.parse({
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    status: row.status,
    inputRefs: parseJsonColumn(
      NodeRunSchema.shape.inputRefs,
      row.input_refs_json,
      "node run input refs",
    ),
    outputRefs: parseJsonColumn(
      NodeRunSchema.shape.outputRefs,
      row.output_refs_json,
      "node run output refs",
    ),
    sessionId: row.session_id,
  });
}

export function createNodeRun(db: OpenedDatabase, nodeRun: NodeRun): NodeRun {
  const parsed = NodeRunSchema.parse(nodeRun);
  if (parsed.status !== "pending") {
    throw invalidInput("node runs are created in the pending status", {
      status: parsed.status,
    });
  }
  if (db.raw.prepare("SELECT id FROM runs WHERE id = ?;").get(parsed.runId) === undefined) {
    throw invalidInput("run does not exist", { runId: parsed.runId });
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO node_runs (id, run_id, node_id, attempt, status, input_refs_json, " +
          "output_refs_json, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.runId,
        parsed.nodeId,
        parsed.attempt,
        parsed.status,
        stringifyJson(parsed.inputRefs),
        stringifyJson(parsed.outputRefs),
        parsed.sessionId,
        now,
        now,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw invalidInput("node run attempt already exists", {
        runId: parsed.runId,
        nodeId: parsed.nodeId,
        attempt: parsed.attempt,
      });
    }
    throw error;
  }
  return parsed;
}

export function getNodeRun(db: OpenedDatabase, id: string): NodeRun | undefined {
  const row = db.raw.prepare("SELECT * FROM node_runs WHERE id = ?;").get(id) as unknown as NodeRunRow | undefined;
  return row === undefined ? undefined : rowToNodeRun(row);
}

export function listNodeRuns(db: OpenedDatabase, runId: string): NodeRun[] {
  const rows = db.raw
    .prepare(
      "SELECT * FROM node_runs WHERE run_id = ? ORDER BY created_at ASC, attempt ASC, node_id ASC;",
    )
    .all(runId) as unknown as NodeRunRow[];
  return rows.map(rowToNodeRun);
}

export function transitionNodeRun(
  db: OpenedDatabase,
  input: { id: string; to: NodeRun["status"] },
): NodeRun {
  return runInTransaction(db.raw, () => {
    const row = db.raw
      .prepare("SELECT * FROM node_runs WHERE id = ?;")
      .get(input.id) as unknown as NodeRunRow;
    if (row === undefined) {
      throw invalidInput("node run not found", { nodeRunId: input.id });
    }
    try {
      assertNodeRunTransition(row.status as NodeRun["status"], input.to);
    } catch (error) {
      if (error instanceof TransitionError) {
        throw invalidInput(error.message, {
          nodeRunId: input.id,
          from: error.from,
          to: error.to,
        });
      }
      throw error;
    }
    db.raw
      .prepare("UPDATE node_runs SET status = ?, updated_at = ? WHERE id = ?;")
      .run(input.to, isoNow(db.now), input.id);
    const updated = db.raw
      .prepare("SELECT * FROM node_runs WHERE id = ?;")
      .get(input.id) as unknown as NodeRunRow;
    return rowToNodeRun(updated);
  });
}

/** Record the Harness session a node attempt is bound to (CONTRACTS §2). */
export function setNodeRunSession(
  db: OpenedDatabase,
  input: { id: string; sessionId: string | null },
): NodeRun {
  const row = db.raw
    .prepare("SELECT * FROM node_runs WHERE id = ?;")
    .get(input.id) as unknown as NodeRunRow;
  if (row === undefined) {
    throw invalidInput("node run not found", { nodeRunId: input.id });
  }
  db.raw
    .prepare("UPDATE node_runs SET session_id = ?, updated_at = ? WHERE id = ?;")
    .run(input.sessionId, isoNow(db.now), input.id);
  const updated = db.raw
    .prepare("SELECT * FROM node_runs WHERE id = ?;")
    .get(input.id) as unknown as NodeRunRow;
  return rowToNodeRun(updated);
}
