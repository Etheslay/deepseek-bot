/** User-picked .txt/.md file. The renderer cannot supply the path. */
import { dialog, type BrowserWindow } from "electron";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import {
  KNOWLEDGE_IMPORT_MAX_BYTES,
  importKnowledgeText,
  type KnowledgeImportResult,
} from "../shared/knowledge-import.js";

export async function pickKnowledgeFile(parent: BrowserWindow): Promise<KnowledgeImportResult> {
  const picked = await dialog.showOpenDialog(parent, {
    title: "导入知识",
    properties: ["openFile"],
    filters: [{ name: "文本", extensions: ["txt", "md"] }],
  });
  if (picked.canceled || picked.filePaths.length !== 1) return { ok: false, code: "cancelled" };
  const filePath = picked.filePaths[0]!;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, code: "read" };
    if (stat.size > KNOWLEDGE_IMPORT_MAX_BYTES) return { ok: false, code: "size" };
    const bytes = Buffer.alloc(stat.size);
    if (stat.size > 0) {
      const read = await handle.read(bytes, 0, stat.size, 0);
      if (read.bytesRead !== stat.size) return { ok: false, code: "read" };
    }
    return importKnowledgeText(basename(filePath), bytes);
  } catch {
    return { ok: false, code: "read" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
