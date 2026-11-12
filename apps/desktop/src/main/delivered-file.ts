/**
 * Open or save a file the chat card already downloaded from the Host.
 * The renderer sends the name and the bytes. This process never takes a path.
 */
import { dialog, shell, type BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeDeliveredHandoff } from "../shared/delivered-handoff.js";

export async function openDeliveredFile(input: unknown): Promise<{ ok: true }> {
  const file = decodeDeliveredHandoff(input);
  const dir = mkdtempSync(join(tmpdir(), "dsb-file-"));
  const target = join(dir, file.name);
  writeFileSync(target, file.bytes);
  const error = await shell.openPath(target);
  if (error.length > 0) {
    throw new Error(error);
  }
  return { ok: true };
}

export async function saveDeliveredFile(
  parent: BrowserWindow,
  input: unknown,
): Promise<{ ok: true; cancelled?: boolean }> {
  const file = decodeDeliveredHandoff(input);
  const picked = await dialog.showSaveDialog(parent, { defaultPath: file.name });
  if (picked.canceled || picked.filePath.length === 0) {
    return { ok: true, cancelled: true };
  }
  writeFileSync(picked.filePath, file.bytes);
  return { ok: true };
}
