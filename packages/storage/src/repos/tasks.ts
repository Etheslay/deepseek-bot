/**
 * Dispatched-task repository (v0.5 manager orchestration, CONTRACTS §5).
 *
 * Rows are the durable side of the TaskDispatcher: one chat turn owed to an
 * executor bot. Status transitions are guarded by the contract state machine
 * so an illegal transition fails here instead of corrupting the record. The
 * `worker_message_ids` column pins the executor-session rows (dispatch
 * marker + assistant reply); `authorization_json` carries the first-hop
 * approval/grant references the relay revalidator consumes (T7 R-13.6).
 */
import {
  TaskSchema,
  canTransitionTask,
  type Task,
  type TaskStatus,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import {
  isoNow,
  parseJsonColumn,
  runInTransaction,
  stringifyJson,
} from "./shared.js";

interface TaskRow {
  id: string;
  from_bot_id: string;
  to_bot_id: string;
  instruction: string;
  status: string;
  result_summary: string | null;
  root_task_id: string;
  chain_index: number;
  chain_total: number;
  authorization_json: string | null;
  idempotency_key: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker_message_ids: string;
}

export interface TaskAuthorizationRef {
  readonly approvalId?: string;
  readonly grantIds?: readonly string[];
}

function rowToTask(row: TaskRow): Task {
  const parsed = TaskSchema.safeParse({
    id: row.id,
    fromBotId: row.from_bot_id,
    toBotId: row.to_bot_id,
    instruction: row.instruction,
    status: row.status,
    resultSummary: row.result_summary,
    rootTaskId: row.root_task_id,
    chainIndex: row.chain_index,
    chainTotal: row.chain_total,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    workerMessageIds: parseJsonColumn(
      TaskSchema.shape.workerMessageIds,
      row.worker_message_ids,
      "task worker message ids",
    ),
  });
  if (!parsed.success) {
    throw invalidInput("stored task does not match its contract schema", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
  }
  return parsed.data;
}

export function insertTask(
  db: OpenedDatabase,
  input: {
    id: string;
    fromBotId: string;
    toBotId: string;
    instruction: string;
    rootTaskId: string;
    chainIndex: number;
    chainTotal: number;
    authorization?: TaskAuthorizationRef;
    /** Idempotency key (interop): the dispatcher checks it before inserting. */
    idempotencyKey?: string;
    createdAt?: string;
  },
): Task {
  const createdAt = input.createdAt ?? isoNow(db.now);
  const row: TaskRow = {
    id: input.id,
    from_bot_id: input.fromBotId,
    to_bot_id: input.toBotId,
    instruction: input.instruction,
    status: "queued",
    result_summary: null,
    root_task_id: input.rootTaskId,
    chain_index: input.chainIndex,
    chain_total: input.chainTotal,
    authorization_json:
      input.authorization === undefined
        ? null
        : stringifyJson({
            ...(input.authorization.approvalId !== undefined
              ? { approvalId: input.authorization.approvalId }
              : {}),
            ...(input.authorization.grantIds !== undefined
              ? { grantIds: input.authorization.grantIds }
              : {}),
          }),
    idempotency_key: input.idempotencyKey ?? null,
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    worker_message_ids: "[]",
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO tasks (id, from_bot_id, to_bot_id, instruction, status, " +
          "result_summary, root_task_id, chain_index, chain_total, " +
          "authorization_json, idempotency_key, created_at, started_at, finished_at, worker_message_ids) " +
          "VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]');",
      )
      .run(
        row.id,
        row.from_bot_id,
        row.to_bot_id,
        row.instruction,
        row.root_task_id,
        row.chain_index,
        row.chain_total,
        row.authorization_json,
        row.idempotency_key,
        row.created_at,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("FOREIGN KEY constraint failed")) {
      throw invalidInput("task endpoints must be existing bots");
    }
    if (message.includes("UNIQUE constraint failed: tasks.id")) {
      throw invalidInput("task id already exists", { taskId: input.id });
    }
    throw error;
  }
  return rowToTask(row);
}

export function getTask(db: OpenedDatabase, id: string): Task | undefined {
  const row = db.raw.prepare("SELECT * FROM tasks WHERE id = ?;").get(id) as
    | TaskRow
    | undefined;
  return row === undefined ? undefined : rowToTask(row);
}

/**
 * Idempotency replay lookup (interop): the first task this sender created
 * under the key, root row only (hops carry no key). Same key always replays
 * the same task — first write wins, regardless of the replayed payload.
 */
export function getTaskByIdempotencyKey(
  db: OpenedDatabase,
  fromBotId: string,
  idempotencyKey: string,
): Task | undefined {
  const row = db.raw
    .prepare("SELECT * FROM tasks WHERE from_bot_id = ? AND idempotency_key = ?;")
    .get(fromBotId, idempotencyKey) as TaskRow | undefined;
  return row === undefined ? undefined : rowToTask(row);
}

export interface ListTasksFilter {
  readonly fromBotId?: string;
  readonly toBotId?: string;
  readonly rootTaskId?: string;
  readonly status?: TaskStatus;
  readonly limit?: number;
}

export function listTasks(db: OpenedDatabase, filter: ListTasksFilter = {}): Task[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.fromBotId !== undefined) {
    clauses.push("from_bot_id = ?");
    params.push(filter.fromBotId);
  }
  if (filter.toBotId !== undefined) {
    clauses.push("to_bot_id = ?");
    params.push(filter.toBotId);
  }
  if (filter.rootTaskId !== undefined) {
    clauses.push("root_task_id = ?");
    params.push(filter.rootTaskId);
  }
  if (filter.status !== undefined) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 100));
  const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
  const rows = db.raw
    .prepare(
      `SELECT * FROM tasks${where} ORDER BY created_at ASC, chain_index ASC, id ASC LIMIT ?;`,
    )
    .all(...params, limit) as unknown as TaskRow[];
  return rows.map(rowToTask);
}

export function countTasks(db: OpenedDatabase, status?: TaskStatus): number {
  const row =
    status === undefined
      ? (db.raw.prepare("SELECT COUNT(*) AS n FROM tasks;").get() as { n: number })
      : (db.raw
          .prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = ?;")
          .get(status) as { n: number });
  return row.n;
}

/** Q3 (TASK_MANAGER_ORCHESTRATION.md): per-bot queued cap, default 10. */
export function countQueuedTasksForBot(db: OpenedDatabase, toBotId: string): number {
  const row = db.raw
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE to_bot_id = ? AND status = 'queued';")
    .get(toBotId) as { n: number };
  return row.n;
}

function updateTaskRow(
  db: OpenedDatabase,
  id: string,
  fields: { status?: TaskStatus; resultSummary?: string | null; startedAt?: string | null; finishedAt?: string | null; workerMessageIds?: readonly string[] },
): Task {
  const row = db.raw.prepare("SELECT * FROM tasks WHERE id = ?;").get(id) as
    | TaskRow
    | undefined;
  if (row === undefined) {
    throw invalidInput("task not found", { taskId: id });
  }
  const nextStatus = fields.status ?? (row.status as TaskStatus);
  if (fields.status !== undefined && fields.status !== row.status) {
    if (!canTransitionTask(row.status as TaskStatus, fields.status)) {
      throw invalidInput("illegal task transition", {
        taskId: id,
        from: row.status,
        to: fields.status,
      });
    }
  }
  const workerMessageIds =
    fields.workerMessageIds ??
    parseJsonColumn(
      TaskSchema.shape.workerMessageIds,
      row.worker_message_ids,
      "task worker message ids",
    );
  db.raw
    .prepare(
      "UPDATE tasks SET status = ?, result_summary = ?, started_at = ?, " +
        "finished_at = ?, worker_message_ids = ? WHERE id = ?;",
    )
    .run(
      nextStatus,
      fields.resultSummary !== undefined ? fields.resultSummary : row.result_summary,
      fields.startedAt !== undefined ? fields.startedAt : row.started_at,
      fields.finishedAt !== undefined ? fields.finishedAt : row.finished_at,
      stringifyJson(workerMessageIds),
      id,
    );
  const updated = db.raw.prepare("SELECT * FROM tasks WHERE id = ?;").get(id) as
    | TaskRow
    | undefined;
  if (updated === undefined) {
    throw invalidInput("task disappeared during update", { taskId: id });
  }
  return rowToTask(updated);
}

export function markTaskRunning(db: OpenedDatabase, id: string): Task {
  return runInTransaction(db.raw, () =>
    updateTaskRow(db, id, { status: "running", startedAt: isoNow(db.now) }),
  );
}

export function finishTask(
  db: OpenedDatabase,
  id: string,
  input: { status: Extract<TaskStatus, "done" | "failed" | "cancelled" | "skipped" | "interrupted">; resultSummary?: string | null },
): Task {
  return runInTransaction(db.raw, () =>
    updateTaskRow(db, id, {
      status: input.status,
      resultSummary: input.resultSummary ?? null,
      finishedAt: isoNow(db.now),
    }),
  );
}

export function appendWorkerMessageId(db: OpenedDatabase, id: string, messageId: string): Task {
  return runInTransaction(db.raw, () => {
    const row = db.raw.prepare("SELECT * FROM tasks WHERE id = ?;").get(id) as
      | TaskRow
      | undefined;
    if (row === undefined) {
      throw invalidInput("task not found", { taskId: id });
    }
    const current = parseJsonColumn(
      TaskSchema.shape.workerMessageIds,
      row.worker_message_ids,
      "task worker message ids",
    );
    if (!current.includes(messageId)) {
      return updateTaskRow(db, id, { workerMessageIds: [...current, messageId] });
    }
    return rowToTask(row);
  });
}

/** Oldest queued task of one executor bot (the dispatcher's next work item). */
export function nextQueuedTask(db: OpenedDatabase, toBotId: string): Task | undefined {
  const row = db.raw
    .prepare(
      "SELECT * FROM tasks WHERE to_bot_id = ? AND status = 'queued' " +
        "ORDER BY created_at ASC, chain_index ASC, id ASC LIMIT 1;",
    )
    .get(toBotId) as TaskRow | undefined;
  return row === undefined ? undefined : rowToTask(row);
}

export function listQueuedHopsOfRoot(db: OpenedDatabase, rootTaskId: string): Task[] {
  return listTasks(db, { rootTaskId, status: "queued", limit: 100 });
}

/**
 * FR-10 restart sweep: queued/running tasks cannot survive a Host restart
 * (their chat turns die with the process), so they become `interrupted` and
 * stay queryable. Returns the swept tasks so the dispatcher can emit a
 * task.status event per row.
 */
export function sweepInterruptedTasks(db: OpenedDatabase): Task[] {
  return runInTransaction(db.raw, () => {
    const rows = db.raw
      .prepare("SELECT * FROM tasks WHERE status IN ('queued', 'running') ORDER BY created_at ASC;")
      .all() as unknown as TaskRow[];
    const finishedAt = isoNow(db.now);
    for (const row of rows) {
      db.raw
        .prepare("UPDATE tasks SET status = 'interrupted', finished_at = ? WHERE id = ?;")
        .run(finishedAt, row.id);
    }
    return rows.map((row) =>
      rowToTask({ ...row, status: "interrupted", finished_at: finishedAt }),
    );
  });
}
