/**
 * Per-bot memory notes. A row is visible only to its botId.
 * Delete is physical; there is no tombstone and no cross-bot share flag.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";

export const MEMORY_TEXT_MAX = 4_000;
export const MEMORY_LIST_DEFAULT = 20;
export const MEMORY_LIST_MAX = 50;

export interface MemoryRow {
  readonly id: string;
  readonly botId: string;
  readonly text: string;
  readonly createdAt: string;
}

type MemorySqlRow = {
  id: string;
  bot_id: string;
  text: string;
  created_at: string;
};

function memoryText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > MEMORY_TEXT_MAX) {
    throw invalidInput("memory text must be between 1 and 4000 characters");
  }
  return trimmed;
}

function memoryLimit(limit: number | undefined): number {
  const value = limit ?? MEMORY_LIST_DEFAULT;
  if (!Number.isInteger(value) || value < 1 || value > MEMORY_LIST_MAX) {
    throw invalidInput("memory limit must be between 1 and 50");
  }
  return value;
}

function mapRow(row: MemorySqlRow): MemoryRow {
  return { id: row.id, botId: row.bot_id, text: row.text, createdAt: row.created_at };
}

export function writeMemory(
  db: OpenedDatabase,
  input: { id?: string; botId: string; text: string },
): MemoryRow {
  const row: MemoryRow = {
    id: input.id ?? randomUUID(),
    botId: input.botId,
    text: memoryText(input.text),
    createdAt: isoNow(db.now),
  };
  try {
    db.raw
      .prepare("INSERT INTO memories (id, bot_id, text, created_at) VALUES (?, ?, ?, ?);")
      .run(row.id, row.botId, row.text, row.createdAt);
  } catch (error) {
    constraintError(error, "write memory");
  }
  return row;
}

/** Newest first. An empty query lists recent notes. Matching is case-insensitive. */
export function listMemories(
  db: OpenedDatabase,
  input: { botId: string; query?: string; limit?: number },
): MemoryRow[] {
  const limit = memoryLimit(input.limit);
  const needle = (input.query ?? "").trim().toLocaleLowerCase();
  if (needle.length > MEMORY_TEXT_MAX) {
    throw invalidInput("memory query must be at most 4000 characters");
  }
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, text, created_at FROM memories WHERE bot_id = ? " +
        "ORDER BY created_at DESC, rowid DESC;",
    )
    .all(input.botId) as unknown as MemorySqlRow[];
  const matched =
    needle.length === 0
      ? rows
      : rows.filter((row) => row.text.toLocaleLowerCase().includes(needle));
  return matched.slice(0, limit).map(mapRow);
}

/** Deletes only a row owned by botId. A miss uses the same not-found error. */
export function deleteMemory(db: OpenedDatabase, input: { botId: string; memoryId: string }): void {
  const result = db.raw
    .prepare("DELETE FROM memories WHERE id = ? AND bot_id = ?;")
    .run(input.memoryId, input.botId);
  if (Number(result.changes) !== 1) throw invalidInput("memory was not found");
}
