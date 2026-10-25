/**
 * Bot repository (CONTRACTS.md §2 Bot).
 *
 * Revisions are UUIDs regenerated on every mutation; updates must carry the
 * revision the caller last saw (REVISION_CONFLICT otherwise, CONTRACTS §1).
 * `create` is deduplicated by requestId (CONTRACTS §3).
 */
import { randomUUID } from "node:crypto";
import {
  BotSchema,
  type Bot,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput, StorageError } from "../errors.js";
import {
  constraintError,
  isoNow,
  runInTransaction,
} from "./shared.js";

export interface BotPatch {
  readonly name?: string;
  readonly instructions?: string;
  readonly modelProfileId?: string;
  readonly workspaceId?: string;
  readonly toolPolicyId?: string;
  readonly avatar?: Bot["avatar"];
  readonly groupId?: string | null;
}

interface BotRow {
  id: string;
  revision: string;
  name: string;
  instructions: string;
  model_profile_id: string;
  workspace_id: string;
  tool_policy_id: string;
  avatar_shape: string | null;
  avatar_color: string | null;
  group_id: string | null;
  archived_at: string | null;
  created_at: string;
}

function rowToBot(row: BotRow): Bot {
  const parsed = BotSchema.safeParse({
    id: row.id,
    revision: row.revision,
    name: row.name,
    instructions: row.instructions,
    modelProfileId: row.model_profile_id,
    workspaceId: row.workspace_id,
    toolPolicyId: row.tool_policy_id,
    ...(row.avatar_shape !== null && row.avatar_color !== null
      ? { avatar: { shape: row.avatar_shape, color: row.avatar_color } }
      : {}),
    ...(row.group_id !== null ? { groupId: row.group_id } : {}),
    archivedAt: row.archived_at,
  });
  if (!parsed.success) {
    throw invalidInput("stored bot does not match its contract schema");
  }
  return parsed.data;
}

function selectBotRow(raw: OpenedDatabase["raw"], id: string): BotRow | undefined {
  return raw.prepare("SELECT * FROM bots WHERE id = ?;").get(id) as BotRow | undefined;
}

export interface CreateBotResult {
  readonly bot: Bot;
  /** False when an earlier request with the same requestId already created it. */
  readonly created: boolean;
}

export function createBot(
  db: OpenedDatabase,
  input: { bot: Bot; requestId?: string },
): CreateBotResult {
  const bot = BotSchema.parse(input.bot);
  const now = isoNow(db.now);

  if (input.requestId !== undefined && input.requestId !== "") {
    const existing = db.raw
      .prepare("SELECT * FROM bots WHERE created_request_id = ?;")
      .get(input.requestId) as BotRow | undefined;
    if (existing !== undefined) {
      return { bot: rowToBot(existing), created: false };
    }
  }

  requireProfileAndWorkspace(db, bot);
  try {
    insertBotRow(db, bot, input.requestId ?? null, now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: bots.id")) {
      throw invalidInput("bot id already exists", { botId: bot.id });
    }
    constraintError(error, "create bot");
  }
  return { bot, created: true };
}

/** Raw insert shared by createBot and the transactional batch creation. */
export function insertBotRow(
  db: OpenedDatabase,
  bot: Bot,
  requestId: string | null,
  now: string,
): void {
  db.raw
    .prepare(
      "INSERT INTO bots (id, revision, name, instructions, model_profile_id, " +
        "workspace_id, tool_policy_id, avatar_shape, avatar_color, group_id, " +
        "archived_at, created_request_id, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    )
    .run(
      bot.id,
      bot.revision,
      bot.name,
      bot.instructions,
      bot.modelProfileId,
      bot.workspaceId,
      bot.toolPolicyId,
      bot.avatar?.shape ?? null,
      bot.avatar?.color ?? null,
      bot.groupId ?? null,
      bot.archivedAt,
      requestId,
      now,
      now,
    );
}

/** Referenced profile/workspace must exist (shared with batch creation). */
export function requireProfileAndWorkspace(db: OpenedDatabase, bot: Bot): void {
  const profile = db.raw
    .prepare("SELECT id FROM model_profiles WHERE id = ?;")
    .get(bot.modelProfileId);
  if (profile === undefined) {
    throw invalidInput("model profile does not exist", { modelProfileId: bot.modelProfileId });
  }
  const workspace = db.raw
    .prepare("SELECT id FROM workspaces WHERE id = ?;")
    .get(bot.workspaceId);
  if (workspace === undefined) {
    throw invalidInput("workspace does not exist", { workspaceId: bot.workspaceId });
  }
}

export function getBot(db: OpenedDatabase, id: string): Bot | undefined {
  const row = selectBotRow(db.raw, id);
  return row === undefined ? undefined : rowToBot(row);
}

export function listBots(
  db: OpenedDatabase,
  options: { includeArchived?: boolean } = {},
): Bot[] {
  const sql =
    options.includeArchived === true
      ? "SELECT * FROM bots ORDER BY created_at ASC, id ASC;"
      : "SELECT * FROM bots WHERE archived_at IS NULL ORDER BY created_at ASC, id ASC;";
  const rows = db.raw.prepare(sql).all() as unknown as BotRow[];
  return rows.map(rowToBot);
}

/** Members of one group (avatar auto-assignment scope for batch creation). */
export function listBotsInGroup(
  db: OpenedDatabase,
  groupId: string,
  options: { includeArchived?: boolean } = {},
): Bot[] {
  const sql =
    options.includeArchived === true
      ? "SELECT * FROM bots WHERE group_id = ? ORDER BY created_at ASC, id ASC;"
      : "SELECT * FROM bots WHERE group_id = ? AND archived_at IS NULL ORDER BY created_at ASC, id ASC;";
  const rows = db.raw.prepare(sql).all(groupId) as unknown as BotRow[];
  return rows.map(rowToBot);
}

/**
 * Revision-guarded update. The merged entity is validated against the
 * contract schema before it is written; the revision rotates on success.
 */
export function updateBot(
  db: OpenedDatabase,
  input: { id: string; expectedRevision: string; patch: BotPatch },
): Bot {
  return runInTransaction(db.raw, () => {
    const row = selectBotRow(db.raw, input.id);
    if (row === undefined) {
      throw invalidInput("bot not found", { botId: input.id });
    }
    if (row.revision !== input.expectedRevision) {
      throw new StorageError({
        code: "REVISION_CONFLICT",
        message: "bot was modified by someone else",
        details: { botId: input.id, currentRevision: row.revision },
        retryable: false,
      });
    }
    const parsed = BotSchema.parse({
      id: row.id,
      revision: row.revision,
      name: input.patch.name ?? row.name,
      instructions: input.patch.instructions ?? row.instructions,
      modelProfileId: input.patch.modelProfileId ?? row.model_profile_id,
      workspaceId: input.patch.workspaceId ?? row.workspace_id,
      toolPolicyId: input.patch.toolPolicyId ?? row.tool_policy_id,
      ...(input.patch.avatar !== undefined
        ? { avatar: input.patch.avatar }
        : row.avatar_shape !== null && row.avatar_color !== null
          ? { avatar: { shape: row.avatar_shape, color: row.avatar_color } }
          : {}),
      ...(input.patch.groupId !== undefined
        ? { groupId: input.patch.groupId }
        : row.group_id !== null
          ? { groupId: row.group_id }
          : {}),
      archivedAt: row.archived_at,
    });
    // Reads omit unassigned avatar/group keys; keep the update response in
    // the same shape (null stays a storage-only representation).
    const merged = {
      id: parsed.id,
      revision: parsed.revision,
      name: parsed.name,
      instructions: parsed.instructions,
      modelProfileId: parsed.modelProfileId,
      workspaceId: parsed.workspaceId,
      toolPolicyId: parsed.toolPolicyId,
      ...(parsed.avatar !== undefined && parsed.avatar !== null
        ? { avatar: parsed.avatar }
        : {}),
      ...(parsed.groupId !== undefined && parsed.groupId !== null
        ? { groupId: parsed.groupId }
        : {}),
      archivedAt: parsed.archivedAt,
    };
    if (
      input.patch.modelProfileId !== undefined ||
      input.patch.workspaceId !== undefined
    ) {
      requireProfileAndWorkspace(db, merged);
    }
    const nextRevision = randomUUID();
    db.raw
      .prepare(
        "UPDATE bots SET revision = ?, name = ?, instructions = ?, " +
          "model_profile_id = ?, workspace_id = ?, tool_policy_id = ?, " +
          "avatar_shape = ?, avatar_color = ?, group_id = ?, updated_at = ? " +
          "WHERE id = ? AND revision = ?;",
      )
      .run(
        nextRevision,
        merged.name,
        merged.instructions,
        merged.modelProfileId,
        merged.workspaceId,
        merged.toolPolicyId,
        merged.avatar?.shape ?? null,
        merged.avatar?.color ?? null,
        merged.groupId ?? null,
        isoNow(db.now),
        input.id,
        input.expectedRevision,
      );
    return { ...merged, revision: nextRevision };
  });
}

/**
 * Archive a bot (forbid new executions, keep history). Archiving an already
 * archived bot with the matching revision is an idempotent no-op.
 */
export function archiveBot(
  db: OpenedDatabase,
  input: { id: string; expectedRevision: string },
): Bot {
  return runInTransaction(db.raw, () => {
    const row = selectBotRow(db.raw, input.id);
    if (row === undefined) {
      throw invalidInput("bot not found", { botId: input.id });
    }
    if (row.revision !== input.expectedRevision) {
      throw new StorageError({
        code: "REVISION_CONFLICT",
        message: "bot was modified by someone else",
        details: { botId: input.id, currentRevision: row.revision },
        retryable: false,
      });
    }
    if (row.archived_at !== null) {
      return rowToBot(row);
    }
    const nextRevision = randomUUID();
    const archivedAt = isoNow(db.now);
    db.raw
      .prepare("UPDATE bots SET archived_at = ?, revision = ?, updated_at = ? WHERE id = ?;")
      .run(archivedAt, nextRevision, archivedAt, input.id);
    const updated = selectBotRow(db.raw, input.id);
    if (updated === undefined) {
      throw invalidInput("bot disappeared during archive", { botId: input.id });
    }
    return rowToBot(updated);
  });
}

/**
 * Archive without the revision guard — the creation.revoke path (FR-12):
 * a batch member may legitimately have been edited after creation, and the
 * undo must still win. Idempotent on already-archived bots.
 */
export function archiveBotUnchecked(
  db: OpenedDatabase,
  input: { id: string },
): Bot {
  return runInTransaction(db.raw, () => {
    const row = selectBotRow(db.raw, input.id);
    if (row === undefined) {
      throw invalidInput("bot not found", { botId: input.id });
    }
    if (row.archived_at !== null) {
      return rowToBot(row);
    }
    const nextRevision = randomUUID();
    const archivedAt = isoNow(db.now);
    db.raw
      .prepare("UPDATE bots SET archived_at = ?, revision = ?, updated_at = ? WHERE id = ?;")
      .run(archivedAt, nextRevision, archivedAt, input.id);
    const updated = selectBotRow(db.raw, input.id);
    if (updated === undefined) {
      throw invalidInput("bot disappeared during archive", { botId: input.id });
    }
    return rowToBot(updated);
  });
}
