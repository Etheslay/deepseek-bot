/**
 * Office files a chat turn hands back to the thread.
 *
 * `write_presentation`, `write_document` and `edit_document` already persist
 * the bytes in the bot workspace. A turn can also leave a pptx, docx, pdf, or
 * xlsx by another write. This records the path and size so the desktop can
 * show a card with view and download. The bytes themselves travel later, one
 * slice at a time, through `workspace.export`.
 */
import { readdirSync, statSync, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import {
  DeliveredFileSchema,
  WORKSPACE_EXPORT_MAX_BYTES,
  type DeliveredFile,
} from "@deepseek-bot/contracts";

function fileName(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? relativePath;
}

function accept(path: unknown, bytes: unknown, format: DeliveredFile["format"]): DeliveredFile | null {
  if (typeof path !== "string" || typeof bytes !== "number") return null;
  const parsed = DeliveredFileSchema.safeParse({
    path,
    name: fileName(path),
    bytes,
    format,
  });
  return parsed.success ? parsed.data : null;
}

function formatOf(filePath: string): DeliveredFile["format"] | null {
  if (/\.pptx$/i.test(filePath)) return "pptx";
  if (/\.pdf$/i.test(filePath)) return "pdf";
  if (/\.docx$/i.test(filePath)) return "docx";
  if (/\.xlsx$/i.test(filePath)) return "xlsx";
  return null;
}

const WALK_SKIP = new Set(["node_modules", ".git", "attachments"]);
const WALK_MAX_VISITS = 400;
const WALK_MAX_DEPTH = 8;

function formatOnDisk(name: string, includeHtml: boolean): DeliveredFile["format"] | null {
  const fromOffice = formatOf(name);
  if (fromOffice !== null) return fromOffice;
  if (includeHtml && /\.html?$/i.test(name)) return "html";
  return null;
}

/**
 * Office files written or replaced during this turn, newest first.
 * `attachments/` is the user's own uploads, so those stay out.
 * HTML is kept only when the caller asked for it and the turn wrote no
 * pptx, docx, pdf, or xlsx.
 */
export function officeFilesWrittenSince(
  root: string,
  sinceMs: number,
  already: readonly DeliveredFile[],
  includeHtml: boolean,
): DeliveredFile[] {
  const taken = new Set(already.map((file) => file.path));
  const found: { file: DeliveredFile; mtime: number }[] = [];
  let visits = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > WALK_MAX_DEPTH || visits >= WALK_MAX_VISITS) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visits >= WALK_MAX_VISITS) return;
      visits += 1;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name)) walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const format = formatOnDisk(entry.name, includeHtml);
      if (format === null) continue;
      let stat: Stats;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      // Directory timestamps can be coarser than Date.now(). A file this turn
      // wrote still counts when its stamp is a couple of seconds early.
      if (!stat.isFile() || stat.mtimeMs < sinceMs - 2_000) continue;
      if (stat.size <= 0 || stat.size > WORKSPACE_EXPORT_MAX_BYTES) continue;
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      if (relativePath.startsWith("../") || relativePath === ".." || taken.has(relativePath)) continue;
      if (relativePath === "attachments" || relativePath.startsWith("attachments/")) continue;
      const parsed = DeliveredFileSchema.safeParse({
        path: relativePath,
        name: entry.name,
        bytes: stat.size,
        format,
      });
      if (parsed.success) found.push({ file: parsed.data, mtime: stat.mtimeMs });
    }
  };
  try {
    walk(root, 0);
  } catch {
    return [];
  }
  const officeAlready = already.some((file) => file.format !== "html");
  const office = found
    .filter((row) => row.file.format !== "html")
    .sort((left, right) => right.mtime - left.mtime);
  const html =
    office.length > 0 || officeAlready
      ? []
      : found.filter((row) => row.file.format === "html").sort((left, right) => right.mtime - left.mtime);
  const room = Math.max(0, 4 - already.length);
  return [...office, ...html].slice(0, room).map((row) => row.file);
}

/** Files named by one successful tool result. Unknown shapes contribute nothing. */
export function deliveredFilesFromTool(tool: string, result: unknown): DeliveredFile[] {
  if (result === null || typeof result !== "object") return [];
  const row = result as Record<string, unknown>;
  const found: DeliveredFile[] = [];
  const push = (file: DeliveredFile | null): void => {
    if (file !== null && !found.some((have) => have.path === file.path)) found.push(file);
  };
  if (tool === "write_presentation") {
    push(accept(row.path, row.bytes, "pptx"));
    push(accept(row.pdfPath, row.pdfBytes, "pdf"));
    return found;
  }
  if (tool === "write_document" || tool === "edit_document") {
    const produced = typeof row.outputPath === "string" ? row.outputPath : row.path;
    const format = typeof produced === "string" ? formatOf(produced) : null;
    if (format !== null) push(accept(produced, row.bytes, format));
  }
  return found;
}
