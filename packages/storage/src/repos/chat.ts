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
      "SELECT id, bot_id, session_id, role, text, meta_json, created_at FROM chat_messages " +
        (sessionId === undefined
          ? "WHERE bot_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?;"
          : "WHERE bot_id = ? AND session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?;"),
    )
    .all(...(sessionId === undefined ? [botId, limit] : [botId, sessionId, limit])) as Array<{
    id: string;
    bot_id: string;
    session_id: string;
    role: string;
    text: string;
    meta_json: string | null;
    created_at: string;
  }>;
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
      meta: parseJsonColumn(
        ChatMessageMetaSchema,
        row.meta_json,
        "chat message meta",
      ),
      createdAt: row.created_at,
    };
  });
}

