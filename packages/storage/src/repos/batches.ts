/**
 * Creation batch ledger (D15 write layer, FR-12 整批撤销).
 *
 * One row per `bot.batchCreate` execution: the target group (when any), the
 * group the batch minted itself and the member bot ids, so
 * `creation.revoke` can undo exactly this batch later — including after a
 * host restart. This entity is storage-internal; the contract only exposes
 * the batchId and the revoke result.
 */
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";

export interface CreationBatchRow {
  id: string;
  /** Target group of the batch (null when the bots stand alone). */
  groupId: string | null;
  /** Group the batch minted itself (null when targeting existing/none). */
  createdGroupId: string | null;
  botIds: readonly string[];
  /** Idempotency key from the request (unique when present). */
  requestId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface BatchRow {
  id: string;
  group_id: string | null;
  created_group_id: string | null;
  bot_ids_json: string;
  request_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

function rowToBatch(row: BatchRow): CreationBatchRow {
  let botIds: unknown;
  try {
    botIds = JSON.parse(row.bot_ids_json);
  } catch {
    throw invalidInput("stored creation batch has invalid member ids");
  }
  if (
    !Array.isArray(botIds) ||
    botIds.some((id) => typeof id !== "string")
  ) {
    throw invalidInput("stored creation batch has invalid member ids");
  }
  return {
    id: row.id,
    groupId: row.group_id,
    createdGroupId: row.created_group_id,
    botIds,
    requestId: row.request_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export function insertBatch(
  db: OpenedDatabase,
  input: {
    id: string;
    groupId: string | null;
    createdGroupId: string | null;
    botIds: readonly string[];
    requestId: string | null;
  },
): CreationBatchRow {
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO creation_batches (id, group_id, created_group_id, bot_ids_json, request_id, created_at, revoked_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, NULL);",
      )
      .run(
        input.id,
        input.groupId,
        input.createdGroupId,
        JSON.stringify(input.botIds),
        input.requestId,
        now,
      );
  } catch (error) {
    constraintError(error, "insert creation batch");
  }
  const inserted = getBatch(db, input.id);
  if (inserted === undefined) {
    throw invalidInput("creation batch disappeared after insert");
  }
  return inserted;
}

export function getBatch(
  db: OpenedDatabase,
  id: string,
): CreationBatchRow | undefined {
  const row = db.raw
    .prepare("SELECT * FROM creation_batches WHERE id = ?;")
    .get(id) as BatchRow | undefined;
  return row === undefined ? undefined : rowToBatch(row);
}

/** Idempotent-rebatch lookup: the request id that produced an earlier batch. */
export function getBatchByRequestId(
  db: OpenedDatabase,
  requestId: string,
): CreationBatchRow | undefined {
  const row = db.raw
    .prepare("SELECT * FROM creation_batches WHERE request_id = ?;")
    .get(requestId) as BatchRow | undefined;
  return row === undefined ? undefined : rowToBatch(row);
}

export function markBatchRevoked(
  db: OpenedDatabase,
  id: string,
): CreationBatchRow {
  const row = db.raw
    .prepare("SELECT * FROM creation_batches WHERE id = ?;")
    .get(id) as BatchRow | undefined;
  if (row === undefined) {
    throw invalidInput("creation batch not found", { batchId: id });
  }
  if (row.revoked_at !== null) {
    throw invalidInput("creation batch was already revoked", { batchId: id });
  }
  const revokedAt = isoNow(db.now);
  db.raw
    .prepare("UPDATE creation_batches SET revoked_at = ? WHERE id = ?;")
    .run(revokedAt, id);
  return { ...rowToBatch(row), revokedAt };
}
