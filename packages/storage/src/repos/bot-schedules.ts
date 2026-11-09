/**
 * Chat-owned message schedules.
 *
 * A person tells one bot, in that bot's chat, to say a fixed line on a
 * clock. The row belongs to that bot. It is not a workflow schedule: when
 * the time arrives the scheduler writes the saved text into the bot's
 * default chat and does not start a model turn.
 */
import { randomUUID } from "node:crypto";
import { isValidIanaTimeZone } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { isoNow } from "./shared.js";

export const BOT_MESSAGE_SCHEDULE_LIMIT = 20;

export type BotMessageScheduleDays = "every" | "weekdays";

export interface BotMessageSchedule {
  readonly id: string;
  readonly botId: string;
  readonly message: string;
  readonly timezone: string;
  readonly recurrence: string;
  readonly hour: number;
  readonly minute: number;
  readonly days: BotMessageScheduleDays;
  readonly nextRunAt: string | null;
  readonly enabled: boolean;
}

export interface SaveBotMessageScheduleInput {
  readonly botId: string;
  readonly message: string;
  readonly timezone: string;
  readonly recurrence: string;
  readonly hour: number;
  readonly minute: number;
  readonly days: BotMessageScheduleDays;
  readonly nextRunAt: string | null;
}

interface ScheduleRow {
  id: string;
  bot_id: string;
  message: string;
  timezone: string;
  recurrence: string;
  hour: number;
  minute: number;
  days: string;
  next_run_at: string | null;
  enabled: number;
}

function rowToSchedule(row: ScheduleRow): BotMessageSchedule {
  return {
    id: row.id,
    botId: row.bot_id,
    message: row.message,
    timezone: row.timezone,
    recurrence: row.recurrence,
    hour: row.hour,
    minute: row.minute,
    days: row.days === "weekdays" ? "weekdays" : "every",
    nextRunAt: row.next_run_at,
    enabled: row.enabled === 1,
  };
}

function assertDraft(input: SaveBotMessageScheduleInput): SaveBotMessageScheduleInput {
  const message = input.message.trim();
  if (message.length < 1 || message.length > 2_000) {
    throw invalidInput("scheduled message must be 1 to 2000 characters");
  }
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) {
    throw invalidInput("scheduled hour must be 0-23");
  }
  if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) {
    throw invalidInput("scheduled minute must be 0-59");
  }
  if (input.days !== "every" && input.days !== "weekdays") {
    throw invalidInput("scheduled days must be every or weekdays");
  }
  if (!isValidIanaTimeZone(input.timezone)) {
    throw invalidInput("unknown IANA time zone", { timezone: input.timezone });
  }
  if (input.recurrence.trim().split(/\s+/).length !== 5) {
    throw invalidInput("expected a 5-field cron expression");
  }
  return { ...input, message };
}

export function listBotMessageSchedules(
  db: OpenedDatabase,
  botId: string,
  options: { enabledOnly?: boolean } = {},
): BotMessageSchedule[] {
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, message, timezone, recurrence, hour, minute, days, next_run_at, enabled " +
        "FROM bot_message_schedules WHERE bot_id = ?" +
        (options.enabledOnly === true ? " AND enabled = 1" : "") +
        " ORDER BY created_at ASC, rowid ASC;",
    )
    .all(botId) as unknown as ScheduleRow[];
  return rows.map(rowToSchedule);
}

export function listEnabledBotMessageSchedules(db: OpenedDatabase): BotMessageSchedule[] {
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, message, timezone, recurrence, hour, minute, days, next_run_at, enabled " +
        "FROM bot_message_schedules WHERE enabled = 1 ORDER BY created_at ASC, rowid ASC;",
    )
    .all() as unknown as ScheduleRow[];
  return rows.map(rowToSchedule);
}

/**
 * Save a schedule for this bot. The same message, clock, days and timezone
 * update the existing row and turn it back on, so saying the request twice
 * does not deliver two copies.
 */
export function saveBotMessageSchedule(
  db: OpenedDatabase,
  input: SaveBotMessageScheduleInput,
): { schedule: BotMessageSchedule; created: boolean } {
  const draft = assertDraft(input);
  const bot = db.raw.prepare("SELECT id FROM bots WHERE id = ?;").get(draft.botId);
  if (bot === undefined) {
    throw invalidInput("bot does not exist", { botId: draft.botId });
  }
  const existing = db.raw
    .prepare(
      "SELECT id, bot_id, message, timezone, recurrence, hour, minute, days, next_run_at, enabled " +
        "FROM bot_message_schedules WHERE bot_id = ? AND message = ? AND hour = ? AND minute = ? " +
        "AND days = ? AND timezone = ?;",
    )
    .get(draft.botId, draft.message, draft.hour, draft.minute, draft.days, draft.timezone) as unknown as
    | ScheduleRow
    | undefined;
  const now = isoNow(db.now);
  if (existing !== undefined) {
    db.raw
      .prepare(
        "UPDATE bot_message_schedules SET recurrence = ?, next_run_at = ?, enabled = 1, updated_at = ? " +
          "WHERE id = ?;",
      )
      .run(draft.recurrence, draft.nextRunAt, now, existing.id);
    const updated = db.raw
      .prepare(
        "SELECT id, bot_id, message, timezone, recurrence, hour, minute, days, next_run_at, enabled " +
          "FROM bot_message_schedules WHERE id = ?;",
      )
      .get(existing.id) as unknown as ScheduleRow;
    return { schedule: rowToSchedule(updated), created: false };
  }
  const enabledCount = db.raw
    .prepare("SELECT COUNT(*) AS n FROM bot_message_schedules WHERE bot_id = ? AND enabled = 1;")
    .get(draft.botId) as unknown as { n: number };
  if (enabledCount.n >= BOT_MESSAGE_SCHEDULE_LIMIT) {
    throw invalidInput("this bot already has the maximum number of chat schedules", {
      limit: BOT_MESSAGE_SCHEDULE_LIMIT,
    });
  }
  const id = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO bot_message_schedules (id, bot_id, message, timezone, recurrence, hour, minute, " +
        "days, next_run_at, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);",
    )
    .run(
      id,
      draft.botId,
      draft.message,
      draft.timezone,
      draft.recurrence,
      draft.hour,
      draft.minute,
      draft.days,
      draft.nextRunAt,
      now,
      now,
    );
  return {
    schedule: {
      id,
      botId: draft.botId,
      message: draft.message,
      timezone: draft.timezone,
      recurrence: draft.recurrence,
      hour: draft.hour,
      minute: draft.minute,
      days: draft.days,
      nextRunAt: draft.nextRunAt,
      enabled: true,
    },
    created: true,
  };
}

/** Disable one schedule. A schedule owned by another bot is left untouched. */
export function cancelBotMessageSchedule(
  db: OpenedDatabase,
  botId: string,
  id: string,
): boolean {
  const result = db.raw
    .prepare(
      "UPDATE bot_message_schedules SET enabled = 0, next_run_at = NULL, updated_at = ? " +
        "WHERE id = ? AND bot_id = ? AND enabled = 1;",
    )
    .run(isoNow(db.now), id, botId);
  return Number(result.changes) > 0;
}

export function setBotMessageScheduleNextRunAt(
  db: OpenedDatabase,
  input: { id: string; nextRunAt: string | null },
): void {
  db.raw
    .prepare("UPDATE bot_message_schedules SET next_run_at = ?, updated_at = ? WHERE id = ?;")
    .run(input.nextRunAt, isoNow(db.now), input.id);
}

export function disableBotMessageSchedule(db: OpenedDatabase, id: string): void {
  db.raw
    .prepare(
      "UPDATE bot_message_schedules SET enabled = 0, next_run_at = NULL, updated_at = ? WHERE id = ?;",
    )
    .run(isoNow(db.now), id);
}

/**
 * One delivery per occurrence. Returns false when this occurrence was
 * already claimed, including after a crash between claim and chat write.
 */
export function claimBotMessageDelivery(
  db: OpenedDatabase,
  input: { scheduleId: string; occurrenceUtc: string },
): boolean {
  const result = db.raw
    .prepare(
      "INSERT INTO bot_message_deliveries (schedule_id, occurrence_utc, delivered_at) " +
        "VALUES (?, ?, ?) ON CONFLICT(schedule_id, occurrence_utc) DO NOTHING;",
    )
    .run(input.scheduleId, input.occurrenceUtc, isoNow(db.now));
  return Number(result.changes) > 0;
}

export function releaseBotMessageDelivery(
  db: OpenedDatabase,
  input: { scheduleId: string; occurrenceUtc: string },
): void {
  db.raw
    .prepare("DELETE FROM bot_message_deliveries WHERE schedule_id = ? AND occurrence_utc = ?;")
    .run(input.scheduleId, input.occurrenceUtc);
}
