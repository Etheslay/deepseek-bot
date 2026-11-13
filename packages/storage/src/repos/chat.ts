/**
 * Chat message persistence (D30 chat runtime).
 *
 * One row per chat turn (user or assistant). Sessions are per-bot and live as
 * long as the Host process; the rows survive restarts so history can be
 * replayed once the renderer wires `chat.history`.
 */
import { randomUUID } from "node:crypto";
import { ChatMessageMetaSchema, type ChatMessageMeta } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { isoNow, parseJsonColumn, stringifyJson } from "./shared.js";

export type ChatRole = "user" | "assistant";

export interface ChatMessageRow {
  readonly id: string;
  readonly botId: string;
  readonly sessionId: string;
  readonly role: ChatRole;
  readonly text: string;
  /** Dispatch, task notice, automation, or an answered choice card. */
  readonly meta?: ChatMessageMeta;
  readonly createdAt: string;
}

export function appendChatMessage(
  db: OpenedDatabase,
  input: {
    id?: string;
    botId: string;
    sessionId: string;
    role: ChatRole;
    text: string;
    meta?: ChatMessageMeta;
  },
): ChatMessageRow {
  const row: ChatMessageRow = {
    id: input.id ?? randomUUID(),
    botId: input.botId,
    sessionId: input.sessionId,
    role: input.role,
    text: input.text,
    ...(input.meta !== undefined ? { meta: ChatMessageMetaSchema.parse(input.meta) } : {}),
    createdAt: isoNow(db.now),
  };
  db.raw
    .prepare(
      "INSERT INTO chat_messages (id, bot_id, session_id, role, text, meta_json, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?);",
    )
    .run(
      row.id,
      row.botId,
      row.sessionId,
      row.role,
      row.text,
      row.meta !== undefined ? stringifyJson(row.meta) : null,
      row.createdAt,
    );
  return row;
}

interface ChatMessageSqlRow {
  id: string;
  bot_id: string;
  session_id: string;
  role: string;
  text: string;
  meta_json: string | null;
  created_at: string;
}

const CHAT_MESSAGE_COLUMNS =
  "id, bot_id, session_id, role, text, meta_json, created_at";

function mapChatMessageRows(rows: readonly ChatMessageSqlRow[]): ChatMessageRow[] {
  return rows.map((row) => {
    if (row.meta_json === null) {
      return {
        id: row.id,
        botId: row.bot_id,
        sessionId: row.session_id,
        role: row.role === "assistant" ? "assistant" : "user",
        text: row.text,
        createdAt: row.created_at,
      };
    }
    return {
      id: row.id,
      botId: row.bot_id,
      sessionId: row.session_id,
      role: row.role === "assistant" ? "assistant" : "user",
      text: row.text,
      meta: parseJsonColumn(ChatMessageMetaSchema, row.meta_json, "chat message meta"),
      createdAt: row.created_at,
    };
  });
}

export function listChatMessages(
  db: OpenedDatabase,
  botId: string,
  limit = 100,
  /**
   * G12: omit for the bot-wide read (every session — the pre-sessions
   * behavior all existing callers keep); pass a session id to scope the
   * replay/history read to that one thread.
   */
  sessionId?: string,
): ChatMessageRow[] {
  const rows = db.raw
    .prepare(
      `SELECT ${CHAT_MESSAGE_COLUMNS} FROM chat_messages ` +
        (sessionId === undefined
          ? "WHERE bot_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?;"
          : "WHERE bot_id = ? AND session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?;"),
    )
    .all(...(sessionId === undefined ? [botId, limit] : [botId, sessionId, limit])) as unknown as ChatMessageSqlRow[];
  return mapChatMessageRows(rows);
}

/**
 * Newest `limit` rows of one session, oldest-first.
 * `listChatMessages` keeps the oldest rows (the history pane). Replay wants
 * the recent end of the thread, then trims that window by token budget.
 */
export function listRecentChatMessages(
  db: OpenedDatabase,
  botId: string,
  limit: number,
  sessionId: string,
): ChatMessageRow[] {
  const rows = db.raw
    .prepare(
      `SELECT ${CHAT_MESSAGE_COLUMNS} FROM (` +
        `SELECT ${CHAT_MESSAGE_COLUMNS}, rowid AS message_rowid FROM chat_messages ` +
        "WHERE bot_id = ? AND session_id = ? " +
        "ORDER BY created_at DESC, rowid DESC LIMIT ?" +
        ") ORDER BY created_at ASC, message_rowid ASC;",
    )
    .all(botId, sessionId, limit) as unknown as ChatMessageSqlRow[];
  return mapChatMessageRows(rows);
}

/**
 * Rows strictly after `afterMessageId` in one session, newest `limit` of
 * those, oldest-first. Returns undefined when that anchor row is not in
 * the session, so the caller can drop a summary whose watermark is gone.
 */
export function listChatMessagesAfter(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
  afterMessageId: string,
  limit: number,
): ChatMessageRow[] | undefined {
  const mark = db.raw
    .prepare(
      "SELECT created_at, rowid FROM chat_messages WHERE id = ? AND bot_id = ? AND session_id = ?;",
    )
    .get(afterMessageId, botId, sessionId) as { created_at: string; rowid: number } | undefined;
  if (mark === undefined) return undefined;
  const rows = db.raw
    .prepare(
      `SELECT ${CHAT_MESSAGE_COLUMNS} FROM (` +
        `SELECT ${CHAT_MESSAGE_COLUMNS}, rowid AS message_rowid FROM chat_messages ` +
        "WHERE bot_id = ? AND session_id = ? " +
        "AND (created_at > ? OR (created_at = ? AND rowid > ?)) " +
        "ORDER BY created_at DESC, rowid DESC LIMIT ?" +
        ") ORDER BY created_at ASC, message_rowid ASC;",
    )
    .all(
      botId,
      sessionId,
      mark.created_at,
      mark.created_at,
      mark.rowid,
      limit,
    ) as unknown as ChatMessageSqlRow[];
  return mapChatMessageRows(rows);
}

