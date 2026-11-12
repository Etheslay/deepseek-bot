/**
 * Office files a chat turn hands back to the thread.
 *
 * `write_presentation`, `write_document` and `edit_document` already persist
 * the bytes in the bot workspace. This only records the path and size so the
 * desktop can show a card with view and download. The bytes themselves travel
 * later, one slice at a time, through `workspace.export`.
 */
import { DeliveredFileSchema, type DeliveredFile } from "@deepseek-bot/contracts";

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

function formatOf(path: string): DeliveredFile["format"] | null {
  if (/\.pptx$/i.test(path)) return "pptx";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.docx$/i.test(path)) return "docx";
  return null;
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
