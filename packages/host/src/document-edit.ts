/**
 * Word document operations for `edit_document`.
 *
 * Create, append, replace, and delete_text rebuild a plain .docx from the
 * extracted text. convert writes the other format beside it: a .docx becomes
 * a text PDF, and a PDF's text layer becomes a .docx. Paths stay inside the
 * bot workspace.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_ATTACHMENT_BYTES } from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";
import type { DocumentEditInput, DocumentEditResult } from "@deepseek-bot/agent-tools";
import { getBot, getWorkspace, type OpenedDatabase } from "@deepseek-bot/storage";
import { resolveInsideWorkspace } from "./artifacts.js";
import { extractDocxBody, extractPdfBody, parseAndStoreAttachment } from "./attachment-parse.js";
import { buildDocx } from "./document-write.js";
import { convertOfficeToPdf } from "./office-pdf.js";

const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_READ_CHARS = 20_000;

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

function formatOf(relativePath: string): "docx" | "pdf" | null {
  if (/\.docx$/i.test(relativePath)) return "docx";
  if (/\.pdf$/i.test(relativePath)) return "pdf";
  return null;
}

function assertInside(relativePath: string): void {
  const segments = relativePath.split(/[\\/]/);
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw invalid("document path must stay inside the bot workspace");
  }
}

function locate(root: string, relativePath: string): { absolute: string; exists: boolean } {
  assertInside(relativePath);
  return resolveInsideWorkspace(root, relativePath);
}

function readFileBytes(absolute: string): Uint8Array {
  const size = fs.statSync(absolute).size;
  if (size > MAX_ATTACHMENT_BYTES) {
    throw invalid("document exceeds 20 MB");
  }
  return fs.readFileSync(absolute);
}

function storeFile(absolute: string, bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_WRITE_BYTES) {
    throw invalid("written document exceeds 2 MB");
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, absolute);
}

async function textOf(format: "docx" | "pdf", bytes: Uint8Array): Promise<string> {
  if (format === "docx") return extractDocxBody(bytes).text;
  return (await extractPdfBody(bytes, { aborted: false })).text;
}

function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_READ_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_READ_CHARS)}\n…(truncated)`, truncated: true };
}

function replaceAll(body: string, find: string, replacement: string): { text: string; count: number } {
  const parts = body.split(find);
  return { text: parts.join(replacement), count: parts.length - 1 };
}

async function remember(
  db: OpenedDatabase,
  botId: string,
  root: string,
  relativePath: string,
): Promise<void> {
  const absolute = path.resolve(root, ...relativePath.split("/"));
  const checksum = createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  await parseAndStoreAttachment(db, botId, relativePath, checksum);
}

export async function editDocumentAt(
  root: string,
  input: DocumentEditInput,
): Promise<DocumentEditResult> {
  const format = formatOf(input.path);
  if (format === null) throw invalid("path must end with .docx or .pdf");
  const target = locate(root, input.path);
  const stored = path.relative(root, target.absolute).split(path.sep).join("/");

  if (input.action === "delete_file") {
    if (!target.exists) throw invalid("document does not exist");
    fs.unlinkSync(target.absolute);
    return { action: "delete_file", path: stored, format, deleted: true };
  }

  if (input.action === "create") {
    if (format !== "docx") throw invalid("create only writes a .docx");
    if (input.text === undefined) throw invalid("text is required");
    if (target.exists) throw invalid("document already exists");
    const bytes = buildDocx(input.text);
    storeFile(target.absolute, bytes);
    return { action: "create", path: stored, format: "docx", bytes: bytes.byteLength };
  }

  if (!target.exists) throw invalid("document does not exist");
  if (input.action === "convert" && input.to !== undefined && formatOf(input.to) === "pdf") {
    if (format !== "docx") throw invalid("converting a .docx writes a .pdf");
    const output = locate(root, input.to);
    if (output.absolute === target.absolute) throw invalid("convert target must be a different file");
    const bytes = await convertOfficeToPdf(target.absolute, output.absolute);
    const outputPath = path.relative(root, output.absolute).split(path.sep).join("/");
    return { action: "convert", path: stored, format: "pdf", outputPath, bytes };
  }
  const current = readFileBytes(target.absolute);
  const body = await textOf(format, current);

  if (input.action === "read") {
    const selected = input.find === undefined
      ? body
      : body.split("\n").filter((line) => line.includes(input.find ?? "")).join("\n");
    const shown = clip(selected);
    return {
      action: "read",
      path: stored,
      format,
      text: shown.text,
      ...(input.find !== undefined ? { matches: selected.length === 0 ? 0 : selected.split("\n").length } : {}),
    };
  }

  if (input.action === "convert") {
    if (input.to === undefined) throw invalid("to is required");
    const outputFormat = formatOf(input.to);
    if (outputFormat === null || outputFormat === format) {
      throw invalid(format === "docx" ? "converting a .docx writes a .pdf" : "converting a .pdf writes a .docx");
    }
    const output = locate(root, input.to);
    if (output.absolute === target.absolute) throw invalid("convert target must be a different file");
    const built = buildDocx(body);
    storeFile(output.absolute, built);
    const outputPath = path.relative(root, output.absolute).split(path.sep).join("/");
    return {
      action: "convert",
      path: stored,
      format: outputFormat,
      outputPath,
      bytes: built.byteLength,
    };
  }

  if (format !== "docx") throw invalid("text edits only apply to a .docx");
  let next = body;
  let matches: number | undefined;
  if (input.action === "append") {
    if (input.text === undefined || input.text.length === 0) throw invalid("text is required");
    next = body.length > 0 ? `${body}\n${input.text}` : input.text;
  } else if (input.action === "delete_text") {
    if (input.find === undefined) throw invalid("find is required");
    const replaced = replaceAll(body, input.find, "");
    if (replaced.count === 0) throw invalid("text to delete was not found");
    next = replaced.text;
    matches = replaced.count;
  } else if (input.action === "replace") {
    if (input.text === undefined) throw invalid("text is required");
    if (input.find === undefined) {
      next = input.text;
    } else {
      const replaced = replaceAll(body, input.find, input.text);
      if (replaced.count === 0) throw invalid("text to replace was not found");
      next = replaced.text;
      matches = replaced.count;
    }
  } else {
    throw invalid("unsupported document action");
  }
  const bytes = buildDocx(next);
  storeFile(target.absolute, bytes);
  return {
    action: input.action,
    path: stored,
    format: "docx",
    bytes: bytes.byteLength,
    ...(matches !== undefined ? { matches } : {}),
  };
}

export async function editBotDocument(
  db: OpenedDatabase,
  botId: string,
  input: DocumentEditInput,
): Promise<DocumentEditResult> {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) throw invalid(`workspace '${bot.workspaceId}' was not found`);
  const result = await editDocumentAt(workspace.canonicalPath, input);
  if (result.deleted !== true) {
    await remember(db, botId, workspace.canonicalPath, result.outputPath ?? result.path);
  }
  return result;
}
