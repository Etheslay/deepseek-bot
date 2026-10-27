/**
 * Desktop knowledge import. One .txt or .md file becomes one knowledge
 * document (D18 独立知识表) owned by the open bot. There is no size setting.
 *
 * The plan states a format limit and that an import has a size limit, but it
 * does not name a byte cap. 256 KiB is the file cap; the text must still fit
 * the contract's knowledge document limit. Over either limit, nothing is
 * written.
 */
import { TEXT_LIMITS } from "@deepseek-bot/contracts";

export const KNOWLEDGE_IMPORT_MAX_BYTES = 256 * 1024;
export const KNOWLEDGE_IMPORT_MAX_CHARS = TEXT_LIMITS.knowledgeText;
const TITLE_MAX = 200;

export type KnowledgeImportCode = "format" | "size" | "empty" | "encoding" | "cancelled" | "read";

export type KnowledgeImportResult =
  | { ok: true; title: string; text: string }
  | { ok: false; code: KnowledgeImportCode };

const EXTENSIONS = new Set([".txt", ".md"]);

function titleFrom(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : "").trim();
  const title = stem.length === 0 ? "未命名知识" : stem;
  return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) : title;
}

export function importKnowledgeText(fileName: string, bytes: Uint8Array): KnowledgeImportResult {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  if (!EXTENSIONS.has(extension)) return { ok: false, code: "format" };
  if (bytes.byteLength > KNOWLEDGE_IMPORT_MAX_BYTES) return { ok: false, code: "size" };
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "encoding" };
  }
  if (decoded.charCodeAt(0) === 0xfeff) decoded = decoded.slice(1);
  const text = decoded.trim();
  if (text.length === 0) return { ok: false, code: "empty" };
  if (text.length > KNOWLEDGE_IMPORT_MAX_CHARS) return { ok: false, code: "size" };
  return { ok: true, title: titleFrom(fileName), text };
}
