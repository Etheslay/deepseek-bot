/**
 * Chat message persistence (D30 chat runtime).
 *
 * One row per chat turn (user or assistant). Sessions are per-bot and live as
 * long as the Host process; the rows survive restarts so history can be
 * replayed once the renderer wires `chat.history`.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { isoNow } from "./shared.js";

export type ChatRole = "user" | "assistant";

export interface ChatMessageRow {
  readonly id: string;
  readonly botId: string;
  readonly sessionId: string;
  readonly role: ChatRole;
  readonly text: string;
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
  },
): ChatMessageRow {
  const row: ChatMessageRow = {
    id: input.id ?? randomUUID(),
    botId: input.botId,
    sessionId: input.sessionId,
    role: input.role,
    text: input.text,
    createdAt: isoNow(db.now),
  };
  db.raw
    .prepare(
      "INSERT INTO chat_messages (id, bot_id, session_id, role, text, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?);",
    )
    .run(row.id, row.botId, row.sessionId, row.role, row.text, row.createdAt);
  return row;
}

export function listChatMessages(
  db: OpenedDatabase,
  botId: string,
  limit = 100,
): ChatMessageRow[] {
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, session_id, role, text, created_at FROM chat_messages " +
        "WHERE bot_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?;",
    )
    .all(botId, limit) as Array<{
    id: string;
    bot_id: string;
    session_id: string;
    role: string;
    text: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    botId: row.bot_id,
    sessionId: row.session_id,
    role: row.role === "assistant" ? "assistant" : "user",
    text: row.text,
    createdAt: row.created_at,
  }));
}

