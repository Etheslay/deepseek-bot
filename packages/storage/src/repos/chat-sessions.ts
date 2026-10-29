/**
 * Chat session metadata (G12 多会话, TASK_G12_MULTI_SESSION.md).
 *
 * One row per chat session a bot owns. The default session reuses the
 * historical id `chat:<botId>` — `chat_messages` rows written before sessions
 * existed already carry it, so legacy threads are default sessions with zero
 * data rewrites. Extra sessions mint `cs:` ids. Rows here are metadata only:
 * titles, archive state and the last-message stamp for list ordering.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { isoNow } from "./shared.js";

export interface ChatSessionRow {
  readonly id: string;
  readonly botId: string;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

interface ChatSessionDbRow {
  id: string;
  bot_id: string;
  title: string;
  archived_at: string | null;
  created_at: string;
  last_message_at: string;
}

function rowToSession(row: ChatSessionDbRow): ChatSessionRow {
  return {
    id: row.id,
    botId: row.bot_id,
    title: row.title,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  };
}

/** The storage id every pre-session row was written under. */
export function defaultChatSessionId(botId: string): string {
  return `chat:${botId}`;
}

/** A fresh extra session id; the `cs:` prefix never collides with turn ids. */
export function newChatSessionId(): string {
  return `cs:${randomUUID()}`;
}

export function createChatSession(
  db: OpenedDatabase,
  input: { id?: string; botId: string; title: string },
): ChatSessionRow {
  const row: ChatSessionRow = {
    id: input.id ?? newChatSessionId(),
    botId: input.botId,
    title: input.title,
    archivedAt: null,
    createdAt: isoNow(db.now),
    lastMessageAt: isoNow(db.now),
  };
  db.raw
    .prepare(
      "INSERT INTO chat_sessions (id, bot_id, title, archived_at, created_at, last_message_at) " +
        "VALUES (?, ?, ?, NULL, ?, ?);",
    )
    .run(row.id, row.botId, row.title, row.createdAt, row.lastMessageAt);
  return row;
}

export function getChatSession(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
): ChatSessionRow | undefined {
  const row = db.raw
    .prepare("SELECT * FROM chat_sessions WHERE id = ? AND bot_id = ?;")
    .get(sessionId, botId) as unknown as ChatSessionDbRow | undefined;
  return row === undefined ? undefined : rowToSession(row);
}

/** Newest activity first; the default session participates like any other. */
export function listChatSessions(db: OpenedDatabase, botId: string): ChatSessionRow[] {
  const rows = db.raw
    .prepare(
      "SELECT * FROM chat_sessions WHERE bot_id = ? ORDER BY last_message_at DESC, rowid DESC;",
    )
    .all(botId) as unknown as ChatSessionDbRow[];
  return rows.map(rowToSession);
}

/**
 * Get-or-create the bot's default session. Every caller that resolves an
 * omitted sessionId (list, send) lands here, so the sidebar always has one
 * row per bot even before its first message. The row starts untitled
 * (`""`): display titles derive at read time from the thread's first user
 * line, and a rename writes the definitive one.
 */
export function ensureDefaultChatSession(db: OpenedDatabase, botId: string): ChatSessionRow {
  const existing = getChatSession(db, botId, defaultChatSessionId(botId));
  if (existing !== undefined) {
    return existing;
  }
  return createChatSession(db, {
    id: defaultChatSessionId(botId),
    botId,
    title: "",
  });
}

export function renameChatSession(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
  title: string,
): ChatSessionRow {
  db.raw
    .prepare("UPDATE chat_sessions SET title = ? WHERE id = ? AND bot_id = ?;")
    .run(title, sessionId, botId);
  const row = getChatSession(db, botId, sessionId);
  if (row === undefined) {
    throw new Error(`chat session '${sessionId}' was not found`);
  }
  return row;
}

/** Archive is final: the row keeps its messages but the session turns read-only. */
export function archiveChatSession(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
): ChatSessionRow {
  db.raw
    .prepare("UPDATE chat_sessions SET archived_at = ? WHERE id = ? AND bot_id = ?;")
    .run(isoNow(db.now), sessionId, botId);
  const row = getChatSession(db, botId, sessionId);
  if (row === undefined) {
    throw new Error(`chat session '${sessionId}' was not found`);
  }
  return row;
}

/** Stamp after a turn lands so session lists order by real activity. */
export function touchChatSession(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
): void {
  db.raw
    .prepare("UPDATE chat_sessions SET last_message_at = ? WHERE id = ? AND bot_id = ?;")
    .run(isoNow(db.now), sessionId, botId);
}

/** Read-time count for session list rendering; rows themselves are never moved. */
export function chatSessionMessageCount(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
): number {
  const row = db.raw
    .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE bot_id = ? AND session_id = ?;")
    .get(botId, sessionId) as { n: number };
  return row.n;
}
