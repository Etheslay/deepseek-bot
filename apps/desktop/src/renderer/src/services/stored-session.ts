/**
 * One stored chat per bot.
 *
 * The host keeps that conversation in `chat_messages` under `chat:<botId>`.
 * `chat.history` already returns those rows, and the open thread loads them.
 * The session list and session open read the same rows: a bot with messages
 * has that one session, and opening it returns those messages. There is no
 * separate event log.
 */
import { UuidSchema } from "@deepseek-bot/contracts";
import { CHAT_THREAD_HISTORY_LIMIT } from "../features/chat/thread-history.js";
import type { ChatHistoryRow, ChatSessionView } from "./desktop-service.js";

/** Same window the open thread reads. The contract rejects a higher limit. */
export const STORED_SESSION_HISTORY_LIMIT = CHAT_THREAD_HISTORY_LIMIT;

/** Popover title width. The first plain user line is the label. */
export const STORED_SESSION_TITLE_LIMIT = 48;

export function storedSessionId(botId: string): string {
  return `chat:${botId}`;
}

/** `chat:<botId>` for a lowercase UUID. Anything else is not this chat. */
export function storedSessionBotId(sessionId: string): string | null {
  const prefix = "chat:";
  if (!sessionId.startsWith(prefix)) return null;
  const botId = sessionId.slice(prefix.length);
  return UuidSchema.safeParse(botId).success ? botId : null;
}

export function messagesForStoredSession(
  sessionId: string,
  messages: readonly ChatHistoryRow[],
): ChatHistoryRow[] {
  return messages.filter((row) => row.sessionId === sessionId);
}

/**
 * The current bot's stored session when that session has rows.
 * An empty bot, or rows stored under some other session id, is an empty list.
 */
export function storedChatSession(
  botId: string,
  messages: readonly ChatHistoryRow[],
): ChatSessionView[] {
  const sessionId = storedSessionId(botId);
  const stored = messagesForStoredSession(sessionId, messages);
  const first = stored[0];
  if (first === undefined) return [];
  return [
    {
      sessionId,
      botId,
      title: sessionTitle(stored),
      startedAt: stored.reduce(
        (earliest, row) => (row.at < earliest ? row.at : earliest),
        first.at,
      ),
      replayEventCount: stored.length,
      status: "active",
    },
  ];
}

function sessionTitle(messages: readonly ChatHistoryRow[]): string {
  const plain = messages.filter((row) => row.meta === undefined && row.text.trim().length > 0);
  const source =
    plain.find((row) => row.role === "user") ??
    plain[0] ??
    messages.find((row) => row.text.trim().length > 0);
  return oneLine(source?.text ?? "");
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "…";
  if (flat.length <= STORED_SESSION_TITLE_LIMIT) return flat;
  return `${flat.slice(0, STORED_SESSION_TITLE_LIMIT - 1)}…`;
}
