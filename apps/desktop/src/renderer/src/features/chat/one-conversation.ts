/**
 * One conversation per bot.
 *
 * The desktop does not list sessions under a bot and does not create extra
 * ones. Reads and sends omit `sessionId`, so the host stays on that bot's
 * default conversation (`chat:<botId>`) and materializes its row on send.
 * An explicit id is rejected until that row exists; any other id would open
 * a stored extra session. Those rows stay on disk and are not read.
 */
import type { JSX } from "react";
import { storedSessionId } from "../../services/stored-session.js";

/** The bot's single conversation id. Extra `cs:` sessions are not this. */
export function botConversationId(botId: string): string {
  return storedSessionId(botId);
}

export type ConversationChoice = {
  /** The only session the desktop opens or sends on. */
  sessionId: string;
  /** Stored ids the desktop does not open. */
  unreadSessionIds: readonly string[];
};

/**
 * Pick the single conversation. Every other stored id is left unread;
 * nothing here deletes it.
 */
export function selectBotConversation(
  botId: string,
  storedSessionIds: readonly string[],
): ConversationChoice {
  const sessionId = botConversationId(botId);
  return {
    sessionId,
    unreadSessionIds: storedSessionIds.filter((id) => id !== sessionId),
  };
}

/**
 * Drop `sessionId` from a host chat request. The host then uses the bot's
 * default conversation. Passing an extra id through would read that session.
 */
export function scopeToBotConversation<T extends object>(
  request: T,
): Omit<T, "sessionId"> {
  const { sessionId: _sessionId, ...rest } = request as T & { sessionId?: string };
  return rest;
}

/**
 * Sidebar slot under the selected bot. There is no "新建会话" control and
 * no session row — the open thread is the conversation.
 */
export function BotSessionSublist(): JSX.Element | null {
  return null;
}
