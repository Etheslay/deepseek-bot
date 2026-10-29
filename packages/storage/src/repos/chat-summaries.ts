/**
 * Compressed-history summaries (TASK_CONTEXT_METER.md). One row per bot
 * session: the digest of everything before the watermark plus the watermark
 * itself (the last chat_messages id folded in). Pure cache — deleting a row
 * restores the full verbatim replay, because chat_messages is never trimmed.
 */
import type { OpenedDatabase } from "../database.js";

export interface ChatSummary {
  readonly botId: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly coversMessageId: string;
  readonly createdAt: string;
}

interface ChatSummaryRow {
  bot_id: string;
  session_id: string;
  summary: string;
  covers_message_id: string;
  created_at: string;
}

function rowToSummary(row: ChatSummaryRow): ChatSummary {
  return {
    botId: row.bot_id,
    sessionId: row.session_id,
    summary: row.summary,
    coversMessageId: row.covers_message_id,
    createdAt: row.created_at,
  };
}

export function getChatSummary(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
): ChatSummary | undefined {
  const row = db.raw
    .prepare("SELECT * FROM chat_summaries WHERE bot_id = ? AND session_id = ?;")
    .get(botId, sessionId) as unknown as ChatSummaryRow | undefined;
  return row === undefined ? undefined : rowToSummary(row);
}

/** Replace-on-write: the summary always describes the whole folded prefix. */
export function upsertChatSummary(
  db: OpenedDatabase,
  input: { botId: string; sessionId: string; summary: string; coversMessageId: string },
): ChatSummary {
  const createdAt = new Date(db.now()).toISOString();
  db.raw
    .prepare(
      "INSERT INTO chat_summaries (bot_id, session_id, summary, covers_message_id, created_at) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (bot_id, session_id) DO UPDATE SET " +
        "summary = excluded.summary, covers_message_id = excluded.covers_message_id, " +
        "created_at = excluded.created_at;",
    )
    .run(input.botId, input.sessionId, input.summary, input.coversMessageId, createdAt);
  const row = db.raw
    .prepare("SELECT * FROM chat_summaries WHERE bot_id = ? AND session_id = ?;")
    .get(input.botId, input.sessionId) as unknown as ChatSummaryRow;
  return rowToSummary(row);
}

export function deleteChatSummary(
  db: OpenedDatabase,
  botId: string,
  sessionId: string,
): void {
  db.raw
    .prepare("DELETE FROM chat_summaries WHERE bot_id = ? AND session_id = ?;")
    .run(botId, sessionId);
}
