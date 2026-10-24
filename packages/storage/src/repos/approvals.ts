/**
 * Approval repository (CONTRACTS.md §2 Approval, §3 approval.decide).
 *
 * Decisions apply only to pending approvals and expire past their TTL;
 * consuming is single-use. The generation column records the run start
 * generation the approval is bound to (CONTRACTS §2: 启动代次绑定), enforced
 * by the Host when resuming interrupted runs.
 */
import {
  APPROVAL_STATUSES,
  ApprovalSchema,
  type Approval,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput, StorageError } from "../errors.js";
import { isoNow, runInTransaction } from "./shared.js";

interface ApprovalRow {
  id: string;
  run_id: string;
  node_run_id: string;
  action_digest: string;
  resource: string;
  expires_at: string;
  status: (typeof APPROVAL_STATUSES)[number];
  consumed_at: string | null;
  generation: number;
  created_at: string;
}

function rowToApproval(row: ApprovalRow): Approval {
  return ApprovalSchema.parse({
    id: row.id,
    runId: row.run_id,
    nodeRunId: row.node_run_id,
    actionDigest: row.action_digest,
    resource: row.resource,
    expiresAt: row.expires_at,
    status: row.status,
  });
}

export function createApproval(
  db: OpenedDatabase,
  approval: Approval,
  options: { generation?: number } = {},
): Approval {
  const parsed = ApprovalSchema.parse(approval);
  if (parsed.status !== "pending") {
    throw invalidInput("approvals are created in the pending status", {
      status: parsed.status,
    });
  }
  if (db.raw.prepare("SELECT id FROM runs WHERE id = ?;").get(parsed.runId) === undefined) {
    throw invalidInput("run does not exist", { runId: parsed.runId });
  }
  if (
    db.raw.prepare("SELECT id FROM node_runs WHERE id = ?;").get(parsed.nodeRunId) === undefined
  ) {
    throw invalidInput("node run does not exist", { nodeRunId: parsed.nodeRunId });
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO approvals (id, run_id, node_run_id, action_digest, resource, expires_at, " +
          "status, consumed_at, generation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.runId,
        parsed.nodeRunId,
        parsed.actionDigest,
        parsed.resource,
        parsed.expiresAt,
        "pending",
        null,
        options.generation ?? 0,
        now,
        now,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw invalidInput("approval id already exists", { approvalId: parsed.id });
    }
    throw error;
  }
  return parsed;
}

export function getApproval(db: OpenedDatabase, id: string): Approval | undefined {
  const row = db.raw
    .prepare("SELECT * FROM approvals WHERE id = ?;")
    .get(id) as unknown as ApprovalRow | undefined;
  return row === undefined ? undefined : rowToApproval(row);
}

export function listApprovals(
  db: OpenedDatabase,
  options: { runId?: string; status?: Approval["status"] } = {},
): Approval[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (options.runId !== undefined) {
    conditions.push("run_id = ?");
    params.push(options.runId);
  }
  if (options.status !== undefined) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.raw
    .prepare(`SELECT * FROM approvals${where} ORDER BY created_at ASC, id ASC;`)
    .all(...params) as unknown as ApprovalRow[];
  return rows.map(rowToApproval);
}

export type ApprovalDecision = "approved" | "denied";

/**
 * Decide a pending approval. Expired-but-still-pending approvals are marked
 * expired (committed outside the transaction so the status survives) and
 * reported with the stable APPROVAL_EXPIRED code.
 */
export function decideApproval(
  db: OpenedDatabase,
  input: { id: string; decision: ApprovalDecision },
): Approval {
  const row = db.raw
    .prepare("SELECT * FROM approvals WHERE id = ?;")
    .get(input.id) as unknown as ApprovalRow | undefined;
  if (row === undefined) {
    throw invalidInput("approval not found", { approvalId: input.id });
  }
  const now = isoNow(db.now);
  if (row.status === "pending" && row.expires_at <= now) {
    // Single-statement autocommit: the expired status must persist even
    // though the decide call itself fails.
    db.raw
      .prepare("UPDATE approvals SET status = 'expired', updated_at = ? WHERE id = ?;")
      .run(now, input.id);
    throw new StorageError({
      code: "APPROVAL_EXPIRED",
      message: "approval validity window has passed",
      details: { approvalId: input.id, expiresAt: row.expires_at },
      retryable: false,
    });
  }
  return runInTransaction(db.raw, () => {
    const current = db.raw
      .prepare("SELECT * FROM approvals WHERE id = ?;")
      .get(input.id) as unknown as ApprovalRow | undefined;
    if (current === undefined) {
      throw invalidInput("approval not found", { approvalId: input.id });
    }
    if (current.status !== "pending") {
      throw invalidInput("approval was already resolved", {
        approvalId: input.id,
        status: current.status,
      });
    }
    db.raw
      .prepare("UPDATE approvals SET status = ?, updated_at = ? WHERE id = ?;")
      .run(input.decision, now, input.id);
    const updated = db.raw
      .prepare("SELECT * FROM approvals WHERE id = ?;")
      .get(input.id) as unknown as ApprovalRow;
    return rowToApproval(updated);
  });
}

/** Consume an approved approval exactly once before executing the action. */
export function consumeApproval(db: OpenedDatabase, input: { id: string }): Approval {
  return runInTransaction(db.raw, () => {
    const row = db.raw
      .prepare("SELECT * FROM approvals WHERE id = ?;")
      .get(input.id) as unknown as ApprovalRow | undefined;
    if (row === undefined) {
      throw invalidInput("approval not found", { approvalId: input.id });
    }
    if (row.status !== "approved") {
      throw invalidInput("only approved approvals can be consumed", {
        approvalId: input.id,
        status: row.status,
      });
    }
    const now = isoNow(db.now);
    db.raw
      .prepare("UPDATE approvals SET status = 'consumed', consumed_at = ?, updated_at = ? WHERE id = ?;")
      .run(now, now, input.id);
    const updated = db.raw
      .prepare("SELECT * FROM approvals WHERE id = ?;")
      .get(input.id) as unknown as ApprovalRow;
    return rowToApproval(updated);
  });
}

/** Mark pending approvals past their TTL as expired; returns the count. */
export function expireApprovals(db: OpenedDatabase): number {
  const now = isoNow(db.now);
  const result = db.raw
    .prepare(
      "UPDATE approvals SET status = 'expired', updated_at = ? " +
        "WHERE status = 'pending' AND expires_at <= ?;",
    )
    .run(now, now);
  return Number(result.changes);
}
