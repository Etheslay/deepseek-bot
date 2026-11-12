/**
 * Open-thread hydration from host `chat.history`.
 *
 * The host keeps one logical chat per bot in `chat_messages`. listSessions
 * reports that session (`chat:<botId>`) when rows exist, and openSession
 * returns those rows. When a thread opens, the desktop loads that bot's
 * stored rows once. Later sends stay in the in-memory list and are appended;
 * this module does not reload them.
 *
 * Dispatch, task-notice, and automation rows belong to the task feed and the
 * notice bar, so they stay out of the message thread. An answered choice
 * card (`meta.kind === "choice"`) is the question row itself: it comes back
 * as a collapsed card and is marked `history: true` with every other replay.
 */
import type { DeliveredFile } from "@deepseek-bot/contracts";
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

export type RestoredChoice = {
  question: string;
  options: { id: string; label: string }[];
  other?: boolean;
  answered: string;
};

export type HistoryThreadMessage = ThreadTurn & {
  id: number;
  origin: "history";
  /** Replay of a stored row. Live composer turns never set this. */
  history: true;
  /** Host chat row id, so a later poll can tell this bubble from a new one. */
  storedId: string;
  speakerKey?: number;
  choices?: RestoredChoice;
  /** Office file the turn handed back. Restored so the card survives a reload. */
  files?: DeliveredFile[];
};

function restoredChoice(row: ChatHistoryRow): RestoredChoice | undefined {
  const meta = row.meta;
  if (meta?.kind !== "choice" || meta.answered.length === 0) {
    return undefined;
  }
  return {
    question: meta.question,
    options: meta.options.map((option) => ({ id: option.id, label: option.label })),
    ...(meta.other === true ? { other: true } : {}),
    answered: meta.answered,
  };
}

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
    if (row.meta !== undefined && row.meta.kind !== "choice" && row.meta.kind !== "files") {
      continue;
    }
    const choices = restoredChoice(row);
    const files = row.meta?.kind === "files" ? row.meta.files : undefined;
    const parsed = Date.parse(row.at);
    const message: HistoryThreadMessage = {
      id: historyMessageId(row.id, used),
      storedId: row.id,
      from: row.role === "user" ? "user" : "bot",
      text: row.text,
      time: Number.isNaN(parsed) ? 0 : parsed,
      origin: "history",
      history: true,
      ...(choices !== undefined ? { choices } : {}),
      ...(files !== undefined ? { files } : {}),
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
    const match = history.findIndex((row, index) => !consumed.has(index) && sameTurn(row, message));
    if (match >= 0) {
      consumed.add(match);
      continue;
    }
    extras.push(message);
  }
  return [...history, ...extras];
}

/**
 * Fold chat rows that arrived after the thread was opened, such as a
 * scheduled line. A stored row that is the copy of a live composer bubble
 * is stamped onto that bubble instead of shown twice.
 */
export function absorbArrivedMessages<T extends ThreadTurn & { storedId?: string }>(
  local: readonly T[],
  history: readonly T[],
): { messages: T[]; changed: boolean } {
  const known = new Set(
    local.flatMap((message) => (message.storedId !== undefined ? [message.storedId] : [])),
  );
  const pendingLive = local.flatMap((message, index) =>
    (message.origin ?? "live") === "live" && message.storedId === undefined
      ? [index]
      : [],
  );
  const usedLive = new Set<number>();
  const stamps = new Map<number, string>();
  const arrivals: T[] = [];
  for (const row of history) {
    if (row.storedId === undefined || known.has(row.storedId)) {
      continue;
    }
    const match = pendingLive.find(
      (index) =>
        !usedLive.has(index) && local[index]?.from === row.from && local[index]?.text === row.text,
    );
    if (match !== undefined) {
      usedLive.add(match);
      stamps.set(match, row.storedId);
      known.add(row.storedId);
      continue;
    }
    arrivals.push(row);
    known.add(row.storedId);
  }
  if (stamps.size === 0 && arrivals.length === 0) {
    return { messages: [...local], changed: false };
  }
  const stamped = local.map((message, index) => {
    const storedId = stamps.get(index);
    return storedId === undefined ? message : { ...message, storedId };
  });
  return { messages: [...stamped, ...arrivals], changed: true };
}
