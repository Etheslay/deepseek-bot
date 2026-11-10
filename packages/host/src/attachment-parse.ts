/**
 * Attachment body extraction (B4' 附件正文解析).
 *
 * After `attachment.commit` lands a binary attachment in the bot workspace,
 * the Host extracts its body — the PDF text layer via pdf.js (through unpdf)
 * and the docx OOXML body via fflate — and caches the result in
 * `attachment_parses` (migration 0025). The chat.send assembly later reads
 * the cache and injects the body as a text attachment block, mirroring the
 * small-text attachment rules.
 *
 * Hard bounds, per the task's safety table:
 * - input files ≤ MAX_ATTACHMENT_BYTES (the D26 upload cap already enforced
 *   at commit; re-checked before any read);
 * - docx reads ONLY the central-directory entry `word/document.xml` and
 *   refuses a declared decompressed size above DOCX_DECOMPRESSED_MAX before
 *   inflating (zip-bomb guard); nothing is written to disk;
 * - PDFs above MAX_PARSE_PAGES pages take the first MAX_PARSE_PAGES pages
 *   and mark the result truncated;
 * - every extraction runs under PARSE_TIMEOUT_MS: the page loop checks the
 *   timeout signal between pages and the pdf.js document is destroyed on
 *   deadline, so a hostile file cannot pin the Host;
 * - extraction failures become `parse_failed` rows with the reason, never
 *   thrown at the conversation.
 */
import fs from "node:fs";
import { unzipSync } from "fflate";
import { getDocumentProxy } from "unpdf";
import { MAX_ATTACHMENT_BYTES } from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";
import {
  getAttachmentParse,
  getBot,
  getWorkspace,
  upsertAttachmentParse,
  type AttachmentParseRow,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { resolveInsideWorkspace } from "./artifacts.js";

function invalidEngineError(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

export const PARSE_TIMEOUT_MS = 10_000;
export const DOCX_DECOMPRESSED_MAX = 16 * 1024 * 1024;
export const MAX_PARSE_PAGES = 200;
/** Storage bound for one cached body (the injection cap is smaller). */
export const MAX_STORED_PARSE_CHARS = 256 * 1024;
/** The chat prompt inlines at most this many bytes of a body (16 KiB — the
 *  same budget the small-text attachment rule uses). */
export const PARSE_INLINE_BYTES = 16 * 1024;

const DOCX_BODY_ENTRY = "word/document.xml";

export type AttachmentParseInput = {
  readonly path: string;
  readonly mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
};

export class ParseTimeoutError extends Error {
  constructor() {
    super("附件解析超时（10 秒上限）");
    this.name = "ParseTimeoutError";
  }
}

interface PdfDocHandle {
  numPages: number;
  destroy(): void;
  getPage(
    page: number,
  ): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }>;
}

interface ExtractedBody {
  text: string;
  pages: number | null;
  paragraphs: number | null;
  truncated: boolean;
}

/** Race an extraction against the deadline. `start` receives a signal object
 *  and must check `signal.aborted` between await points; `cancel` runs once
 *  on deadline so the caller can destroy the underlying document. */
export async function withParseTimeout<T>(
  start: (signal: { aborted: boolean }) => Promise<T>,
  cancel: () => void,
  limitMs: number = PARSE_TIMEOUT_MS,
): Promise<T> {
  const signal = { aborted: false };
  const work = start(signal);
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    signal.aborted = true;
    cancel();
  }, limitMs);
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        // Resolved by the signal checks inside `start`; this rejection only
        // fires if `start` ignores the signal for the whole deadline.
        const giveUp = (): void => {
          if (signal.aborted) {
            reject(new ParseTimeoutError());
          }
        };
        const poll = setInterval(giveUp, 500);
        work.finally(() => clearInterval(poll)).catch(() => undefined);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/** Extract the PDF text layer, page by page, under the timeout signal. */
export async function extractPdfBody(
  bytes: Uint8Array,
  signal: { aborted: boolean },
): Promise<ExtractedBody> {
  const pdf = (await getDocumentProxy(new Uint8Array(bytes))) as unknown as PdfDocHandle;
  const pageLimit = Math.min(pdf.numPages, MAX_PARSE_PAGES);
  const pages: string[] = [];
  for (let page = 1; page <= pageLimit; page += 1) {
    if (signal.aborted) {
      throw new ParseTimeoutError();
    }
    const pageProxy = await pdf.getPage(page);
    const content = await pageProxy.getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join(" "));
  }
  const joined = pages.join("\n\n").replaceAll("\u0000", "").trim();
  return { text: joined, pages: pdf.numPages, paragraphs: null, truncated: pdf.numPages > MAX_PARSE_PAGES };
}

/** Minimal OOXML body extraction: `<w:t>` runs with tab/br/paragraph
 *  boundaries and entity decoding, from the single body entry. */
export function extractDocxBody(bytes: Uint8Array): ExtractedBody {
  const entries = unzipSync(bytes, {
    filter: (file) =>
      file.name === DOCX_BODY_ENTRY && file.originalSize <= DOCX_DECOMPRESSED_MAX,
  });
  const xmlBuffer = entries[DOCX_BODY_ENTRY];
  if (xmlBuffer === undefined) {
    throw new Error("docx 中没有可读的 word/document.xml 正文条目");
  }
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(xmlBuffer);
  const bodyStart = xml.indexOf("<w:body");
  const body = bodyStart === -1 ? xml : xml.slice(bodyStart);
  let out = "";
  let paragraphs = 0;
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(body)) !== null) {
    if (match[1] !== undefined) {
      out += decodeXmlEntities(match[1]);
    } else if (match[0].startsWith("<w:tab")) {
      out += "\t";
    } else if (match[0].startsWith("<w:br")) {
      out += "\n";
    } else {
      out += "\n";
      paragraphs += 1;
    }
  }
  const text = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, pages: null, paragraphs, truncated: false };
}

/** Slide text from `ppt/slides/slideN.xml` `<a:t>` runs, in slide order. */
export function extractPptxBody(bytes: Uint8Array): ExtractedBody {
  const entries = unzipSync(bytes, {
    filter: (file) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(file.name) &&
      file.originalSize <= DOCX_DECOMPRESSED_MAX,
  });
  const names = Object.keys(entries).sort((left, right) => slideNumber(left) - slideNumber(right));
  if (names.length === 0) {
    throw new Error("pptx 里没有可读的幻灯片");
  }
  const slides = names
    .map((name) => slideText(new TextDecoder("utf-8", { fatal: false }).decode(entries[name])))
    .filter((slide) => slide.length > 0);
  return {
    text: slides.join("\n\n").trim(),
    pages: names.length,
    paragraphs: null,
    truncated: false,
  };
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/i.exec(name);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

function slideText(xml: string): string {
  const lines: string[] = [];
  let current = "";
  const token = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<\/a:p>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml)) !== null) {
    if (match[1] !== undefined) {
      current += decodeXmlEntities(match[1]);
    } else {
      const line = current.trim();
      if (line.length > 0) lines.push(line);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail.length > 0) lines.push(tail);
  return lines.join("\n");
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : "";
}

function workspaceRootOf(db: OpenedDatabase, botId: string): string {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalidEngineError(`bot '${botId}' was not found`);
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) {
    throw invalidEngineError(`workspace '${bot.workspaceId}' was not found`);
  }
  return workspace.canonicalPath;
}

export function attachmentParseKind(path: string): "pdf" | "docx" | "pptx" | null {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.docx$/i.test(path)) return "docx";
  if (/\.pptx$/i.test(path)) return "pptx";
  return null;
}

export function attachmentParseMediaType(kind: "pdf" | "docx" | "pptx"): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/**
 * Parse one committed attachment and cache the result. Never throws: every
 * failure lands as a `parse_failed` row carrying the reason, so a bad file
 * degrades the injection block — never the conversation, never the upload.
 * Re-parse only when the stored checksum differs from the committed one.
 */
export async function parseAndStoreAttachment(
  db: OpenedDatabase,
  botId: string,
  relPath: string,
  sourceChecksum: string,
): Promise<AttachmentParseRow> {
  const existing = getAttachmentParse(db, botId, relPath);
  if (existing !== undefined && existing.sourceChecksum === sourceChecksum) {
    return existing;
  }
  const kind = attachmentParseKind(relPath);
  const mediaType = kind === null ? "application/octet-stream" : attachmentParseMediaType(kind);
  const finish = (
    status: "ok" | "parse_failed",
    body: {
      text: string;
      truncated: boolean;
      originalChars: number;
      pages?: number | null;
      paragraphs?: number | null;
      errorReason?: string | null;
    },
  ): AttachmentParseRow =>
    upsertAttachmentParse(db, {
      botId,
      path: relPath,
      mediaType,
      sourceChecksum,
      status,
      ...body,
    });
  if (kind === null) {
    return finish("parse_failed", {
      text: "",
      truncated: false,
      originalChars: 0,
      errorReason: "不支持的附件类型，只有 PDF、Word 与 PPT 可以提取正文",
    });
  }
  try {
    const root = workspaceRootOf(db, botId);
    const { absolute, exists } = resolveInsideWorkspace(root, relPath);
    if (!exists) {
      throw new Error("工作区里找不到这份附件");
    }
    const bytes = new Uint8Array(fs.readFileSync(absolute));
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`附件大小超出可解析范围（${bytes.byteLength} 字节）`);
    }
    let pdfDoc: PdfDocHandle | undefined;
    const extracted: ExtractedBody = await withParseTimeout(
      async (signal) => {
        if (kind === "pdf") {
          const pdf = (await getDocumentProxy(new Uint8Array(bytes))) as unknown as PdfDocHandle;
          pdfDoc = pdf;
          const pageLimit = Math.min(pdf.numPages, MAX_PARSE_PAGES);
          const pages: string[] = [];
          for (let page = 1; page <= pageLimit; page += 1) {
            if (signal.aborted) {
              throw new ParseTimeoutError();
            }
            const pageProxy = await pdf.getPage(page);
            const content = await pageProxy.getTextContent();
            pages.push(content.items.map((item) => item.str ?? "").join(" "));
          }
          const joined = pages.join("\n\n").replaceAll("\u0000", "").trim();
          return {
            text: joined,
            pages: pdf.numPages,
            paragraphs: null,
            truncated: pdf.numPages > MAX_PARSE_PAGES,
          };
        }
        if (kind === "docx") return extractDocxBody(bytes);
        return extractPptxBody(bytes);
      },
      () => {
        // Deadline hit: destroy the pdf.js document so its worker stops
        // parsing a hostile file.
        try {
          pdfDoc?.destroy();
        } catch {
          // Best-effort teardown; the deadline already bounds Host impact.
        }
      },
    );
    const trimmed = extracted.text.trim();
    if (trimmed.length === 0) {
      return finish("parse_failed", {
        text: "",
        truncated: false,
        originalChars: 0,
        pages: extracted.pages ?? null,
        paragraphs: extracted.paragraphs ?? null,
        errorReason: "PDF 没有文本层，可能是扫描件",
      });
    }
    const originalChars = trimmed.length;
    const bounded =
      originalChars > MAX_STORED_PARSE_CHARS ? trimmed.slice(0, MAX_STORED_PARSE_CHARS) : trimmed;
    return finish("ok", {
      text: bounded,
      truncated: extracted.truncated || originalChars > MAX_STORED_PARSE_CHARS,
      originalChars,
      pages: extracted.pages ?? null,
      paragraphs: extracted.paragraphs ?? null,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    return finish("parse_failed", {
      text: "",
      truncated: false,
      originalChars: 0,
      errorReason: reason,
    });
  }
}

/**
 * The chat.send assembly: collect the attachment paths the renderer already
 * named in the prompt (`attachments/…`, deterministic format from
 * buildAttachmentContext), then append one body block per parse result —
 * inline ≤ 16 KiB inside a fence, else the first 16 KiB plus the truncation
 * marker; `parse_failed` answers 「无法提取正文：<原因>」. Bounded at four
 * documents per turn; a path with no cache row parses inline (first send
 * after the cache was lost, e.g. restore) and re-caches.
 */
export function collectAttachmentParsePaths(promptText: string): string[] {
  const paths: string[] = [];
  // Filenames keep the user's spelling, including spaces and non-ASCII.
  // The renderer always closes the path with 】, a space, or the end of the line.
  const pattern = /attachments\/([^/\\【】\n]+?\.(?:pdf|docx|pptx))(?=】|\s|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(promptText)) !== null) {
    paths.push(match[0]);
    if (paths.length >= 4) break;
  }
  return paths;
}

export async function composeAttachmentParseBlocks(
  db: OpenedDatabase,
  botId: string,
  paths: readonly string[],
): Promise<string> {
  if (paths.length === 0) {
    return "";
  }
  const blocks: string[] = [];
  for (const relPath of paths) {
    const cached = getAttachmentParse(db, botId, relPath);
    const body: AttachmentParseRow =
      cached ??
      (await parseAndStoreAttachment(
        db,
        botId,
        relPath,
        // No cached row: the file exists from an earlier commit whose cache
        // row is absent (restore, migration); the on-disk checksum is
        // unknown here, so an empty checksum simply parses fresh.
        "",
      ));
    const name = relPath.split("/").pop() ?? relPath;
    if (body.status === "parse_failed") {
      blocks.push(`【附件正文 ${name}】无法提取正文：${body.errorReason ?? "原因未知"}`);
      continue;
    }
    const encoded = new TextEncoder().encode(body.text);
    const truncatedHere = encoded.byteLength > PARSE_INLINE_BYTES;
    const inline = truncatedHere ? sliceToByteBudget(body.text, PARSE_INLINE_BYTES) : body.text;
    const marker = truncatedHere
      ? `（附件正文已截断：原始 ${body.originalChars} 字符；完整内容可用 read_workspace_file 读取 ${relPath}）`
      : "";
    blocks.push(
      `【附件正文 ${name}】${marker}\n\`\`\`\n${inline.replaceAll("```", "``\u200b`")}\n\`\`\``,
    );
  }
  return blocks.join("\n\n");
}

function sliceToByteBudget(text: string, budget: number): string {
  const encoder = new TextEncoder();
  let end = text.length;
  while (end > 0 && encoder.encode(text.slice(0, end)).byteLength > budget) {
    end = Math.floor(end * 0.9);
  }
  return text.slice(0, end);
}
