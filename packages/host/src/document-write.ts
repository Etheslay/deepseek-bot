/**
 * Rewrite a workspace .docx or .pdf from plain text.
 *
 * Word is a minimal OOXML package (UTF-8, so Chinese round-trips through the
 * existing docx reader). PDF is a real text PDF: a system CJK font is subset
 * and embedded when the machine has one, so the text layer stays readable.
 * The written file replaces the path and the parse cache is refreshed.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { EngineError } from "@deepseek-bot/runtime";
import { getBot, getWorkspace, type OpenedDatabase } from "@deepseek-bot/storage";
import type { WrittenDocument } from "@deepseek-bot/agent-tools";
import { resolveInsideWorkspace } from "./artifacts.js";
import { parseAndStoreAttachment } from "./attachment-parse.js";

export const MAX_DOCUMENT_TEXT_CHARS = 100_000;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Songti.ttc",
  "C:\\Windows\\Fonts\\msyh.ttf",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "C:\\Windows\\Fonts\\simsun.ttc",
];

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildDocx(text: string): Uint8Array {
  const paragraphs = text.replaceAll("\r\n", "\n").split("\n").map((line) => {
    return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
  }).join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(documentXml),
    "word/_rels/document.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    ),
  });
}

function findFontCandidates(): Uint8Array[] {
  const found: Uint8Array[] = [];
  for (const candidate of FONT_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      found.push(fs.readFileSync(candidate));
    }
  }
  return found;
}

/**
 * pdf-lib subsets by calling `font.createSubset()`. A TrueType collection
 * (Windows `msyh.ttc`, WenQuanYi) opens as a collection, which has no
 * `createSubset`. Hand back the first face that does.
 */
const subsettingFontkit = {
  create(buffer: Uint8Array): ReturnType<typeof fontkit.create> {
    const opened = fontkit.create(buffer);
    if (typeof opened.createSubset === "function") return opened;
    const faces = (opened as { fonts?: Array<{ createSubset?: () => unknown }> }).fonts;
    const face = faces?.find((item) => typeof item.createSubset === "function");
    if (face === undefined) {
      throw new Error("font cannot be subset");
    }
    return face as ReturnType<typeof fontkit.create>;
  },
};

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll("\r\n", "\n").split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of paragraph) {
      let glyph = ch;
      try {
        font.widthOfTextAtSize(glyph, size);
      } catch {
        glyph = "?";
      }
      const next = current + glyph;
      if (current.length > 0 && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(current);
        current = glyph;
      } else {
        current = next;
      }
    }
    if (current.length > 0) {
      lines.push(current);
    }
  }
  return lines;
}

export async function buildPdf(
  text: string,
  fontBytes?: readonly Uint8Array[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(subsettingFontkit);
  const candidates = fontBytes ?? findFontCandidates();
  const needsCjk = [...text].some((char) => (char.codePointAt(0) ?? 0) > 0xff);
  let font: PDFFont | undefined;
  for (const bytes of candidates) {
    try {
      font = await doc.embedFont(bytes, { subset: true });
      break;
    } catch {
      font = undefined;
    }
  }
  if (font === undefined) {
    if (needsCjk) {
      throw invalid("这台电脑没有可用的中文字体，写不出含中文的 PDF");
    }
    font = await doc.embedFont(StandardFonts.Helvetica);
  }
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 56;
  const size = 12;
  const lineHeight = 18;
  const lines = wrapLines(text, font, size, pageWidth - margin * 2);
  const body = lines.length > 0 ? lines : [""];
  let index = 0;
  while (index < body.length) {
    const page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin - size;
    while (index < body.length && y >= margin) {
      page.drawText(body[index] ?? "", { x: margin, y, size, font });
      y -= lineHeight;
      index += 1;
    }
  }
  return doc.save();
}

function documentFormat(relativePath: string): "pdf" | "docx" | null {
  if (/\.pdf$/i.test(relativePath)) return "pdf";
  if (/\.docx$/i.test(relativePath)) return "docx";
  return null;
}

export async function writeDocumentAt(
  root: string,
  relativePath: string,
  text: string,
): Promise<WrittenDocument> {
  if (text.length > MAX_DOCUMENT_TEXT_CHARS) {
    throw invalid("document text exceeds 100000 characters");
  }
  const format = documentFormat(relativePath);
  if (format === null) {
    throw invalid("path must end with .docx or .pdf");
  }
  const segments = relativePath.split(/[\\/]/);
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw invalid("document path must stay inside the bot workspace");
  }
  const located = resolveInsideWorkspace(root, relativePath);
  const bytes = format === "docx" ? buildDocx(text) : await buildPdf(text);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw invalid("written document exceeds 2 MB");
  }
  fs.mkdirSync(path.dirname(located.absolute), { recursive: true });
  const temporary = `${located.absolute}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, located.absolute);
  const stored = path.relative(root, located.absolute).split(path.sep).join("/");
  return { path: stored, bytes: bytes.byteLength, format };
}

export async function writeBotDocument(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
  text: string,
): Promise<WrittenDocument> {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) throw invalid(`workspace '${bot.workspaceId}' was not found`);
  const written = await writeDocumentAt(workspace.canonicalPath, relativePath, text);
  const checksum = createHash("sha256").update(fs.readFileSync(
    path.resolve(workspace.canonicalPath, ...written.path.split("/")),
  )).digest("hex");
  await parseAndStoreAttachment(db, botId, written.path, checksum);
  return written;
}
