/**
 * Per-bot knowledge documents (D18 独立知识表). Long-form text lives whole
 * in `knowledge_docs`, separate from the 4k memory notes; there is no chunk
 * table. Retrieval windows ("chunks") and their bag-of-ngrams vectors are
 * computed at query time: CJK bigrams + latin words, TF-IDF weighted,
 * cosine-ranked with a small exact-phrase bonus. This is a local, dependency-
 * free lexical-semantic ranker — NOT neural embeddings; quality is "finds
 * the section that talks about the query terms", not paraphrase matching.
 * Practical bound: scoring walks every window of the bot's docs, so a bot
 * should keep at most a few hundred full-size documents (bound it with the
 * retention policy's knowledgeMaxPerBot).
 */
import { randomUUID } from "node:crypto";
import { TEXT_LIMITS } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";

export const KNOWLEDGE_TEXT_MAX = TEXT_LIMITS.knowledgeText;
export const KNOWLEDGE_TITLE_MAX = TEXT_LIMITS.name;

/** Query-time chunking: 480-char windows, 100-char overlap. */
export const CHUNK_CHARS = 480;
export const CHUNK_STEP = 380;
const SNIPPET_MAX = 400;
/** Exact-phrase bonus on top of the cosine score, capped at 1. */
const PHRASE_BONUS = 0.2;

export interface KnowledgeDocRow {
  readonly id: string;
  readonly botId: string;
  readonly title: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface KnowledgeDocSummary {
  readonly id: string;
  readonly botId: string;
  readonly title: string;
  readonly size: number;
  readonly createdAt: string;
}

export interface KnowledgeHit {
  readonly docId: string;
  readonly title: string;
  readonly score: number;
  readonly snippet: string;
  readonly at: string;
}

type DocSqlRow = {
  id: string;
  bot_id: string;
  title: string;
  text: string;
  created_at: string;
};

function summaryOf(row: DocSqlRow): KnowledgeDocSummary {
  return {
    id: row.id,
    botId: row.bot_id,
    title: row.title,
    size: row.text.length,
    createdAt: row.created_at,
  };
}

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > KNOWLEDGE_TITLE_MAX) {
    throw invalidInput("knowledge title must be between 1 and 200 characters");
  }
  return trimmed;
}

function validateText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > KNOWLEDGE_TEXT_MAX) {
    throw invalidInput(
      `knowledge text must be between 1 and ${KNOWLEDGE_TEXT_MAX} characters`,
    );
  }
  return trimmed;
}

export function writeKnowledgeDoc(
  db: OpenedDatabase,
  input: { id?: string; botId: string; title: string; text: string },
): KnowledgeDocSummary {
  const row = {
    id: input.id ?? randomUUID(),
    botId: input.botId,
    title: validateTitle(input.title),
    text: validateText(input.text),
    createdAt: isoNow(db.now),
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO knowledge_docs (id, bot_id, title, text, created_at) VALUES (?, ?, ?, ?, ?);",
      )
      .run(row.id, row.botId, row.title, row.text, row.createdAt);
  } catch (error) {
    constraintError(error, "write knowledge doc");
  }
  return {
    id: row.id,
    botId: row.botId,
    title: row.title,
    size: row.text.length,
    createdAt: row.createdAt,
  };
}

/** Summaries only — a full library must stay under the 1 MiB message cap. */
export function listKnowledgeDocs(
  db: OpenedDatabase,
  input: { botId: string },
): KnowledgeDocSummary[] {
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, title, text, created_at FROM knowledge_docs WHERE bot_id = ? " +
        "ORDER BY created_at DESC, rowid DESC;",
    )
    .all(input.botId) as unknown as DocSqlRow[];
  return rows.map(summaryOf);
}

/** Deletes only a doc owned by botId. A miss uses the same not-found error. */
export function deleteKnowledgeDoc(
  db: OpenedDatabase,
  input: { botId: string; docId: string },
): void {
  const result = db.raw
    .prepare("DELETE FROM knowledge_docs WHERE id = ? AND bot_id = ?;")
    .run(input.docId, input.botId);
  if (Number(result.changes) !== 1) throw invalidInput("knowledge doc was not found");
}

// ---------------------------------------------------------------------------
// Local vector scoring (pure functions, exported for tests)
// ---------------------------------------------------------------------------

/** One chunk of text with its TF map. */
export interface ChunkVector {
  readonly text: string;
  readonly tf: Map<string, number>;
}

export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_STEP) {
    chunks.push(text.slice(start, start + CHUNK_CHARS));
    if (start + CHUNK_CHARS >= text.length) break;
  }
  return chunks;
}

function isCjk(code: number): boolean {
  // CJK unified + kana + hangul syllables
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

function isWordChar(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) || // a-z (input is lowercased)
    (code >= 0x30 && code <= 0x39) // 0-9
  );
}

/**
 * Tokenize into latin/digit words plus CJK bigrams (a lone CJK char becomes
 * a unigram). Single lowercase pass, no allocations per character.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = "";
  let cjkRun = "";
  const flushWord = (): void => {
    if (word.length > 0) {
      tokens.push(word);
      word = "";
    }
  };
  const flushCjk = (): void => {
    if (cjkRun.length === 1) {
      tokens.push(cjkRun);
    } else if (cjkRun.length > 1) {
      for (let i = 0; i < cjkRun.length - 1; i += 1) {
        tokens.push(cjkRun.slice(i, i + 2));
      }
    }
    cjkRun = "";
  };
  for (const ch of text.toLocaleLowerCase()) {
    const code = ch.codePointAt(0) ?? 0;
    if (isWordChar(code)) {
      flushCjk();
      word += ch;
    } else if (isCjk(code)) {
      flushWord();
      cjkRun += ch;
    } else {
      flushWord();
      flushCjk();
    }
  }
  flushWord();
  flushCjk();
  return tokens;
}

export function chunkVector(text: string): ChunkVector {
  const tf = new Map<string, number>();
  for (const token of tokenize(text)) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return { text, tf };
}

/** Cosine over L2-normalized TF vectors (IDF weighting applied by caller). */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const value of a.values()) na += value * value;
  for (const value of b.values()) nb += value * value;
  if (na === 0 || nb === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, value] of small) {
    const other = large.get(token);
    if (other !== undefined) dot += value * other;
  }
  return dot / Math.sqrt(na * nb);
}

/**
 * Rank windows of the bot's documents against one query. IDF comes from the
 * window corpus itself, so rare query terms dominate; an exact query phrase
 * inside a window adds a fixed bonus. Score 0 never returns.
 */
export function rankChunks(
  query: string,
  docs: ReadonlyArray<{ docId: string; title: string; at: string; text: string }>,
  limit: number,
): KnowledgeHit[] {
  const queryVector = chunkVector(query);
  if (queryVector.tf.size === 0) return [];
  const phrase = query.trim().toLocaleLowerCase();

  const windows: Array<{
    docId: string;
    title: string;
    at: string;
    chunk: ChunkVector;
  }> = [];
  for (const doc of docs) {
    for (const piece of chunkText(doc.text)) {
      windows.push({
        docId: doc.docId,
        title: doc.title,
        at: doc.at,
        chunk: chunkVector(piece),
      });
    }
  }
  if (windows.length === 0) return [];

  const docFrequency = new Map<string, number>();
  for (const window of windows) {
    for (const token of window.chunk.tf.keys()) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }
  const idf = (token: string): number =>
    Math.log((windows.length + 1) / ((docFrequency.get(token) ?? 0) + 1)) + 1;
  const weighted = (vector: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [token, tf] of vector) out.set(token, tf * idf(token));
    return out;
  };
  const queryWeighted = weighted(queryVector.tf);

  const hits: KnowledgeHit[] = [];
  for (const window of windows) {
    const score = cosine(queryWeighted, weighted(window.chunk.tf));
    if (score <= 0) continue;
    const windowLower = window.chunk.text.toLocaleLowerCase();
    const bonus = phrase.length >= 2 && windowLower.includes(phrase) ? PHRASE_BONUS : 0;
    hits.push({
      docId: window.docId,
      title: window.title,
      score: Math.min(1, score + bonus),
      snippet: snippetFor(window.chunk.text, phrase),
      at: window.at,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function snippetFor(chunk: string, phrase: string): string {
  const lower = chunk.toLocaleLowerCase();
  const at = phrase.length >= 2 ? lower.indexOf(phrase) : -1;
  const text = at < 0 ? chunk : chunk.slice(Math.max(0, at - 80));
  const trimmed = text.trim();
  return trimmed.length > SNIPPET_MAX ? trimmed.slice(0, SNIPPET_MAX) : trimmed;
}

/**
 * Hybrid search: rank every window of the bot's docs. Empty result on no
 * overlap; the caller validates the bot and the query shape.
 */
export function searchKnowledge(
  db: OpenedDatabase,
  input: { botId: string; query: string; limit: number },
): KnowledgeHit[] {
  const rows = db.raw
    .prepare(
      "SELECT id, bot_id, title, text, created_at FROM knowledge_docs WHERE bot_id = ? " +
        "ORDER BY created_at DESC, rowid DESC;",
    )
    .all(input.botId) as unknown as DocSqlRow[];
  return rankChunks(
    input.query,
    rows.map((row) => ({
      docId: row.id,
      title: row.title,
      at: row.created_at,
      text: row.text,
    })),
    input.limit,
  );
}
