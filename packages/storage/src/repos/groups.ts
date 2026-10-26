/**
 * Bot group repository (CONTRACTS.md §2 BotGroup, D15 write layer).
 *
 * Groups are labels over bots (bots carry `groupId`); creation and archive
 * follow the bots.ts conventions: schema-parsed entities, revision rotation
 * on mutation, idempotent archive.
 */
import { randomUUID } from "node:crypto";
import { BotGroupSchema, type BotGroup } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput, StorageError } from "../errors.js";
import { constraintError, isoNow, runInTransaction } from "./shared.js";

interface GroupRow {
  id: string;
  revision: string;
  name: string;
  archived_at: string | null;
  created_at: string;
}

function rowToGroup(row: GroupRow): BotGroup {
  const parsed = BotGroupSchema.safeParse({
    id: row.id,
    revision: row.revision,
    name: row.name,
    archivedAt: row.archived_at,
  });
  if (!parsed.success) {
    throw invalidInput("stored group does not match its contract schema");
  }
  return parsed.data;
}

export function createGroup(
  db: OpenedDatabase,
  input: { group: BotGroup },
): BotGroup {
  const group = BotGroupSchema.parse(input.group);
  const now = isoNow(db.now);
  try {
    insertGroupRow(db, group, now);
  } catch (error) {
    constraintError(error, "create group");
  }
  return group;
}

/** Raw insert shared by createGroup and the transactional batch creation. */
export function insertGroupRow(
  db: OpenedDatabase,
  group: BotGroup,
  now: string,
): void {
  db.raw
    .prepare(
      "INSERT INTO bot_groups (id, revision, name, archived_at, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?);",
    )
    .run(group.id, group.revision, group.name, group.archivedAt, now, now);
}

function selectGroupRow(
  raw: OpenedDatabase["raw"],
  id: string,
): GroupRow | undefined {
  return raw.prepare("SELECT * FROM bot_groups WHERE id = ?;").get(id) as
    | GroupRow
    | undefined;
}

export function getGroup(db: OpenedDatabase, id: string): BotGroup | undefined {
  const row = selectGroupRow(db.raw, id);
  return row === undefined ? undefined : rowToGroup(row);
}

export function listGroups(db: OpenedDatabase): BotGroup[] {
  const rows = db.raw
    .prepare("SELECT * FROM bot_groups WHERE archived_at IS NULL ORDER BY created_at ASC, id ASC;")
    .all() as unknown as GroupRow[];
  return rows.map(rowToGroup);
}

/**
 * Archive a group (FR-12 revoke path). Archiving an already archived group
 * with the matching revision is an idempotent no-op.
 */
export function archiveGroup(
  db: OpenedDatabase,
  input: { id: string; expectedRevision: string },
): BotGroup {
  return runInTransaction(db.raw, () => {
    const row = selectGroupRow(db.raw, input.id);
    if (row === undefined) {
      throw invalidInput("group not found", { groupId: input.id });
    }
    if (row.revision !== input.expectedRevision) {
      throw new StorageError({
        code: "REVISION_CONFLICT",
        message: "group was modified by someone else",
        details: { groupId: input.id, currentRevision: row.revision },
        retryable: false,
      });
    }
    if (row.archived_at !== null) {
      return rowToGroup(row);
    }
    const nextRevision = randomUUID();
    const archivedAt = isoNow(db.now);
    db.raw
      .prepare(
        "UPDATE bot_groups SET archived_at = ?, revision = ?, updated_at = ? WHERE id = ?;",
      )
      .run(archivedAt, nextRevision, archivedAt, input.id);
    const updated = selectGroupRow(db.raw, input.id);
    if (updated === undefined) {
      throw invalidInput("group disappeared during archive", { groupId: input.id });
    }
    return rowToGroup(updated);
  });
}
