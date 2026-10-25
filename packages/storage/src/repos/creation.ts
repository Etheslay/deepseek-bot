/**
 * Transactional chat-driven batch creation (D15 write layer, FR-12).
 *
 * One `runInTransaction` covers the whole operation: mint the group (when
 * the batch carries newGroup), assign pool-distinct avatars (contracts'
 * assignBatchAvatars — explicit picks win, repeats only after exhaustion),
 * insert every member bot and record the batch ledger row. A failure
 * anywhere rolls the entire batch back, so `creation.revoke` always sees
 * exactly what a successful call created; an `idempotencyKey` replay
 * returns the recorded batch instead of duplicating it.
 */
import {
  assignBatchAvatars,
  BotSchema,
  type Avatar,
  type Bot,
  type BotGroup,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { isoNow, runInTransaction } from "./shared.js";
import { insertBatch, getBatchByRequestId, type CreationBatchRow } from "./batches.js";
import { getBot, insertBotRow, requireProfileAndWorkspace } from "./bots.js";
import { getGroup, insertGroupRow } from "./groups.js";

export interface BatchBotSpec {
  /** Contract-valid bot WITHOUT avatar/groupId (caller mints id/revision). */
  readonly bot: Bot;
  /** Explicit avatar (用户显式指定时以用户为准); omit for auto-assignment. */
  readonly avatar?: Avatar;
}

export interface CreateBotBatchInput {
  readonly batchId: string;
  readonly requestId?: string;
  /** Mint-and-attach a fresh group (caller generates id/revision). */
  readonly newGroup?: BotGroup;
  /** Attach to an existing, non-archived group. */
  readonly groupId?: string;
  readonly bots: ReadonlyArray<BatchBotSpec>;
}

export interface CreateBotBatchResult {
  /** Id of the ledger row — the original one when a request replays. */
  readonly batchId: string;
  readonly group: BotGroup | null;
  readonly bots: Bot[];
}

function replayBatch(
  db: OpenedDatabase,
  batch: CreationBatchRow,
): CreateBotBatchResult {
  const group =
    batch.groupId === null ? null : getGroup(db, batch.groupId) ?? null;
  const bots = batch.botIds.map((id) => {
    const bot = getBot(db, id);
    if (bot === undefined) {
      throw invalidInput("batch member missing during replay", { botId: id });
    }
    return bot;
  });
  return { batchId: batch.id, group, bots };
}

export function createBotBatch(
  db: OpenedDatabase,
  input: CreateBotBatchInput,
): CreateBotBatchResult {
  if (input.requestId !== undefined && input.requestId !== "") {
    const existing = getBatchByRequestId(db, input.requestId);
    if (existing !== undefined) {
      return replayBatch(db, existing);
    }
  }
  if (input.bots.length === 0) {
    throw invalidInput("a creation batch needs at least one bot");
  }
  return runInTransaction(db.raw, () => {
    const now = isoNow(db.now);
    let group: BotGroup | null = null;
    let createdGroupId: string | null = null;
    if (input.newGroup !== undefined) {
      group = input.newGroup;
      createdGroupId = input.newGroup.id;
      insertGroupRow(db, input.newGroup, now);
    } else if (input.groupId !== undefined) {
      const target = getGroup(db, input.groupId);
      if (target === undefined) {
        throw invalidInput("target group does not exist", {
          groupId: input.groupId,
        });
      }
      if (target.archivedAt !== null) {
        throw invalidInput("target group is archived", {
          groupId: input.groupId,
        });
      }
      group = target;
    }

    // Avatar uniqueness scope: the group's current non-archived members.
    const taken = new Set<string>();
    if (group !== null) {
      const rows = db.raw
        .prepare(
          "SELECT avatar_shape, avatar_color FROM bots WHERE group_id = ? AND archived_at IS NULL;",
        )
        .all(group.id) as unknown as ReadonlyArray<{
        avatar_shape: string | null;
        avatar_color: string | null;
      }>;
      for (const row of rows) {
        if (row.avatar_shape !== null && row.avatar_color !== null) {
          taken.add(`${row.avatar_shape}:${row.avatar_color}`);
        }
      }
    }
    const avatars = assignBatchAvatars({
      count: input.bots.length,
      explicit: input.bots.map((spec) => spec.avatar),
      taken,
    });

    const created: Bot[] = [];
    const botIds: string[] = [];
    for (const [index, spec] of input.bots.entries()) {
      const bot = BotSchema.parse({
        ...spec.bot,
        avatar: avatars[index],
        ...(group !== null ? { groupId: group.id } : {}),
      });
      requireProfileAndWorkspace(db, bot);
      insertBotRow(db, bot, null, now);
      botIds.push(bot.id);
      created.push(bot);
    }
    insertBatch(db, {
      id: input.batchId,
      groupId: group?.id ?? null,
      createdGroupId,
      botIds,
      requestId: input.requestId ?? null,
    });
    return { batchId: input.batchId, group, bots: created };
  });
}
