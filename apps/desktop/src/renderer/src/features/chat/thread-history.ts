/**
 * Open-thread hydration from host `chat.history`.
 *
 * The host keeps one logical chat per bot in `chat_messages`. listSessions
 * reports that session (`chat:<botId>`) when rows exist, and openSession
 * returns those rows. When a thread opens, the desktop loads that bot's
 * stored rows once. Later sends stay in the in-memory list and are appended;
 * this module does not reload them.
 *
 * Rows with meta are dispatch markers and task notices. The task feed already
 * renders those, so they stay out of the message thread.
 */
import type { ChatHistoryRow } from "../../services/desktop-service.js";

/** Contract maximum for chat.history. The host returns oldest-first up to this. */
export const CHAT_THREAD_HISTORY_LIMIT = 200;

/**
 * A live bubble and the stored row of the same turn are stamped a moment
 * apart (local Date.now vs the host's created_at). Wider than a local IPC
 * round trip, narrower than a person repeating the same line after a pause.
 */
export const SAME_TURN_WINDOW_MS = 2_000;

export type ThreadRole = "user" | "bot";
export type ThreadOrigin = "seed" | "history" | "live";

export type ThreadTurn = {
  from: ThreadRole;
  text: string;
  time: number;
  origin?: ThreadOrigin;
};

export type HistoryThreadMessage = ThreadTurn & {
  id: number;
  origin: "history";
  speakerKey?: number;
};

/** Negative id so stored rows never collide with Date.now() sends or bot keys. */
export function historyMessageId(rowId: string, used: Set<number>): number {
  let hash = 2166136261;
  for (let i = 0; i < rowId.length; i += 1) {
    hash ^= rowId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let id = -((hash >>> 0) % 0x7ffffffe) - 1;
  while (used.has(id)) {
    id -= 1;
  }
  used.add(id);
  return id;
}

export function historyThreadMessages(
  rows: readonly ChatHistoryRow[],
  botKey: number,
): HistoryThreadMessage[] {
  const used = new Set<number>();
  const messages: HistoryThreadMessage[] = [];
  for (const row of rows) {
    if (row.meta !== undefined) {
      continue;
    }
    const parsed = Date.parse(row.at);
    const message: HistoryThreadMessage = {
      id: historyMessageId(row.id, used),
      from: row.role === "user" ? "user" : "bot",
      text: row.text,
      time: Number.isNaN(parsed) ? 0 : parsed,
      origin: "history",
    };
    if (row.role === "assistant") {
      message.speakerKey = botKey;
    }
    messages.push(message);
  }
  return messages;
}

function sameTurn(stored: ThreadTurn, live: ThreadTurn): boolean {
  return (
    stored.from === live.from &&
    stored.text === live.text &&
    Math.abs(stored.time - live.time) <= SAME_TURN_WINDOW_MS
  );
}

/**
 * True when `message` is the stored copy of a turn the composer is about to
 * append. Used so a history snapshot that already includes the in-flight
 * reply does not gain a second bubble.
 */
export function isSameStoredTurn(
  message: ThreadTurn,
  incoming: { from: ThreadRole; text: string },
  now: number,
): boolean {
  return (
    message.origin === "history" &&
    message.from === incoming.from &&
    message.text === incoming.text &&
    Math.abs(message.time - now) <= SAME_TURN_WINDOW_MS
  );
}

/**
 * History replaces the welcome seed. Live sends that are not already in the
 * snapshot stay after it, in the order the composer appended them.
 * An empty snapshot keeps the thread that is already on screen (seed, or
 * seed plus anything sent while the read was in flight).
 */
export function mergeOpenedThread<T extends ThreadTurn>(
  history: readonly T[],
  local: readonly T[],
  seed: readonly T[],
): T[] {
  if (history.length === 0) {
    return local.length > 0 ? [...local] : [...seed];
  }
  const consumed = new Set<number>();
  const extras: T[] = [];
  for (const message of local) {
    const origin = message.origin ?? "live";
    if (origin === "seed" || origin === "history") {
      continue;
    }
    const match = history.findIndex(
      (row, index) => !consumed.has(index) && sameTurn(row, message),
    );
    if (match >= 0) {
      consumed.add(match);
      continue;
    }
    extras.push(message);
  }
  return [...history, ...extras];
}
