/**
 * Desktop knowledge import. One .txt or .md file becomes one existing memory
 * note. There is no separate knowledge table and no size setting.
 *
 * The plan states a format limit and that an import has a size limit, but it
 * does not name a byte cap. 16 KiB is the file cap for this slice. The note
 * still has to fit the existing 4000-character memory row. Over either limit,
 * nothing is written.
 */
export const KNOWLEDGE_IMPORT_MAX_BYTES = 16 * 1024;
export const KNOWLEDGE_IMPORT_MAX_CHARS = 4_000;

export type KnowledgeImportCode = "format" | "size" | "empty" | "encoding" | "cancelled" | "read";

export type KnowledgeImportResult =
  | { ok: true; text: string }
  | { ok: false; code: KnowledgeImportCode };

const EXTENSIONS = new Set([".txt", ".md"]);

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
  return { ok: true, text };
}
