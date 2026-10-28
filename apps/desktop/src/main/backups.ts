/**
 * Backup listing for the desktop main process (D24 leftover).
 *
 * The Host contract has no backup-listing method, but the main process owns
 * the data root path and the manifest format is a stable on-disk boundary
 * (packages/storage backup.ts): one directory per backup under
 * `<dataRoot>/backups/<backupId>/` with a manifest.json that carries kind,
 * createdAt, schemaVersion and a hashed file list. This module reads ONLY
 * those manifests — never database or payload files — and skips anything
 * unreadable or foreign instead of failing the whole list.
 */
import fs from "node:fs";
import { join } from "node:path";
import { type BackupSummary } from "../shared/ipc-channels.js";

const BACKUP_KIND = "deepseek-bot-backup";

export const BACKUPS_DIR_NAME = "backups";

interface BackupManifestLike {
  kind?: unknown;
  createdAt?: unknown;
  schemaVersion?: unknown;
  files?: unknown;
}

function readSummary(backupDir: string, backupId: string): BackupSummary | null {
  let raw: string;
  try {
    raw = fs.readFileSync(join(backupDir, "manifest.json"), { encoding: "utf8" });
  } catch {
    return null;
  }
  let manifest: BackupManifestLike;
  try {
    manifest = JSON.parse(raw) as BackupManifestLike;
  } catch {
    return null;
  }
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.kind !== BACKUP_KIND ||
    typeof manifest.createdAt !== "string" ||
    manifest.createdAt === "" ||
    typeof manifest.schemaVersion !== "number" ||
    !Array.isArray(manifest.files)
  ) {
    return null;
  }
  let sizeBytes = 0;
  for (const entry of manifest.files) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { bytes?: unknown }).bytes === "number"
    ) {
      sizeBytes += (entry as { bytes: number }).bytes;
    }
  }
  return {
    backupId,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    sizeBytes,
  };
}

/** Summaries of every readable backup under `<dataRoot>/backups`, newest first. */
export function listBackups(dataRoot: string): BackupSummary[] {
  const backupsDir = join(dataRoot, BACKUPS_DIR_NAME);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(backupsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: BackupSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summary = readSummary(join(backupsDir, entry.name), entry.name);
    if (summary !== null) {
      summaries.push(summary);
    }
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** `data.restore`'s response plus the restart the main process performed. */
export type RestoreOutcome = {
  restored: true;
  /** The Host child was replaced with a fresh process over the restored data. */
  hostRestarted: true;
};
