/**
 * D25 host-side global search assembly (trusted desktop surface).
 *
 * One literal-substring query fans out over the four local corpora the
 * renderer index cannot see and returns contract-shaped hits sorted by
 * recency. This is display metadata only: message bodies appear solely as
 * bounded snippets, artifact hits carry no file-system paths or contents,
 * and opening a hit routes through the existing per-bot methods — the
 * search grants nothing by itself. It is not a model tool and never
 * reaches the tool registry.
 */
import {
  searchArtifactPaths,
  searchBotNames,
  searchChatMessages,
  searchWorkflowNames,
  type OpenedDatabase,
} from "@deepseek-bot/storage";

export interface GlobalSearchHit {
  readonly kind: "bot" | "workflow" | "message" | "artifact";
  readonly id: string;
  readonly botId: string | null;
  readonly title: string;
  readonly snippet: string | null;
  readonly at: string | null;
}

/** Collapse whitespace and keep a bounded excerpt around the first match. */
export function buildMessageSnippet(text: string, query: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0) {
    return flat.slice(0, max);
  }
  const half = Math.floor((max - 2) / 2);
  const start = Math.max(0, at - half);
  const end = Math.min(flat.length, at + query.trim().length + half);
  let snippet = flat.slice(start, end);
  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < flat.length) {
    snippet = `${snippet}…`;
  }
  // A long query can inflate the window; keep the trailing ellipsis visible.
  if (snippet.length > max) {
    snippet = `${snippet.slice(0, max - 1)}…`;
  }
  return snippet;
}

function recency(hit: GlobalSearchHit): number {
  if (hit.at === null) {
    return 0;
  }
  const parsed = Date.parse(hit.at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function globalSearch(db: OpenedDatabase, query: string, limit: number): GlobalSearchHit[] {
  const perKind = limit;
  const hits: GlobalSearchHit[] = [
    ...searchBotNames(db, query, perKind).map(
      (row): GlobalSearchHit => ({
        kind: "bot",
        id: row.id,
        botId: row.id,
        title: row.name,
        snippet: row.archivedAt === null ? null : "archived",
        at: row.createdAt,
      }),
    ),
    ...searchWorkflowNames(db, query, perKind).map(
      (row): GlobalSearchHit => ({
        kind: "workflow",
        id: row.id,
        botId: null,
        title: row.name,
        snippet: null,
        at: row.createdAt,
      }),
    ),
    ...searchChatMessages(db, query, perKind).map(
      (row): GlobalSearchHit => ({
        kind: "message",
        id: row.id,
        botId: row.botId,
        title: row.botName,
        snippet: buildMessageSnippet(row.text, query),
        at: row.createdAt,
      }),
    ),
    ...searchArtifactPaths(db, query, perKind).map(
      (row): GlobalSearchHit => ({
        kind: "artifact",
        id: row.id,
        botId: row.botId,
        title: row.relativePath.slice(0, 200),
        snippet: null,
        at: row.updatedAt,
      }),
    ),
  ];
  return hits.sort((a, b) => recency(b) - recency(a)).slice(0, limit * 4);
}
