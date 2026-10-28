/**
 * D25 host-side global search (trusted desktop surface).
 *
 * One query fans out over the four local corpora the renderer index cannot
 * see: bot names, workflow names, persisted chat messages, and artifact
 * paths (latest version per file). The user text is only ever a bound LIKE
 * parameter with %, _ and \ escaped, so it matches as a literal substring
 * and can never change the shape of the query. Every function takes a hard
 * LIMIT; there is no full-table scan without one.
 */
import type { OpenedDatabase } from "../database.js";

/**
 * Escape the three LIKE wildcards so the query is a literal substring.
 * The caller must pair this with `ESCAPE '\'` in the SQL.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface GlobalSearchBotHit {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
}

export function searchBotNames(
  db: OpenedDatabase,
  query: string,
  limit: number,
): GlobalSearchBotHit[] {
  const rows = db.raw
    .prepare(
      "SELECT id, name, archived_at, created_at FROM bots " +
        "WHERE name LIKE ? ESCAPE '\\' ORDER BY created_at DESC, rowid DESC LIMIT ?;",
    )
    .all(`%${escapeLikePattern(query)}%`, limit) as Array<{
    id: string;
    name: string;
    archived_at: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  }));
}

export interface GlobalSearchMessageHit {
  readonly id: string;
  readonly botId: string;
  readonly botName: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export function searchChatMessages(
  db: OpenedDatabase,
  query: string,
  limit: number,
): GlobalSearchMessageHit[] {
  const rows = db.raw
    .prepare(
      "SELECT m.id, m.bot_id, m.session_id, m.role, m.text, m.created_at, b.name AS bot_name " +
        "FROM chat_messages m JOIN bots b ON b.id = m.bot_id " +
        "WHERE m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?;",
    )
    .all(`%${escapeLikePattern(query)}%`, limit) as Array<{
    id: string;
    bot_id: string;
    session_id: string;
    role: string;
    text: string;
    created_at: string;
    bot_name: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    botId: row.bot_id,
    botName: row.bot_name,
    sessionId: row.session_id,
    role: row.role === "assistant" ? "assistant" : "user",
    text: row.text,
    createdAt: row.created_at,
  }));
}

export interface GlobalSearchWorkflowHit {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  readonly createdAt: string;
}

export function searchWorkflowNames(
  db: OpenedDatabase,
  query: string,
  limit: number,
): GlobalSearchWorkflowHit[] {
  const rows = db.raw
    .prepare(
      "SELECT id, name, revision, created_at FROM workflows " +
        "WHERE name LIKE ? ESCAPE '\\' ORDER BY created_at DESC, rowid DESC LIMIT ?;",
    )
    .all(`%${escapeLikePattern(query)}%`, limit) as Array<{
    id: string;
    name: string;
    revision: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.created_at,
  }));
}

export interface GlobalSearchArtifactHit {
  /** Id of the latest version row of the matched file. */
  readonly id: string;
  readonly botId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly size: number;
  readonly updatedAt: string;
}

/**
 * Latest version per matched path. The inner MAX(revision) window keeps
 * one hit per file instead of one hit per historical version.
 */
export function searchArtifactPaths(
  db: OpenedDatabase,
  query: string,
  limit: number,
): GlobalSearchArtifactHit[] {
  const rows = db.raw
    .prepare(
      "SELECT av.id, av.bot_id, av.relative_path, av.media_type, av.size, av.created_at " +
        "FROM artifact_versions av " +
        "JOIN (SELECT bot_id, relative_path, MAX(revision) AS max_revision " +
        "FROM artifact_versions WHERE relative_path LIKE ? ESCAPE '\\' " +
        "GROUP BY bot_id, relative_path) m " +
        "ON av.bot_id = m.bot_id AND av.relative_path = m.relative_path " +
        "AND av.revision = m.max_revision " +
        "ORDER BY av.created_at DESC, av.rowid DESC LIMIT ?;",
    )
    .all(`%${escapeLikePattern(query)}%`, limit) as Array<{
    id: string;
    bot_id: string;
    relative_path: string;
    media_type: string;
    size: number;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    botId: row.bot_id,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    size: row.size,
    updatedAt: row.created_at,
  }));
}
