/**
 * Backup and restore (FR-09 backend, CONTRACTS.md §3 data.*,
 * docs/SECURITY_DATA.md §5).
 *
 * - Backup refuses to run while runs are active, checkpoints the WAL and
 *   takes a consistent `VACUUM INTO` snapshot of the metadata database.
 * - Backups exclude API key blobs (`credentials/`), the Harness home
 *   (`harness/`), cache and rotating logs by default; the manifest says so.
 * - The backup DOES contain chat content (run snapshots and event payloads),
 *   so the manifest carries a sensitivity note for the UI to surface.
 * - Restore verifies the manifest (kind, schema version, sizes, SHA-256,
 *   path safety), stashes the current database next to the backups so the
 *   original data survives, installs the snapshot, migrates it to the
 *   current schema and rolls back the file moves if anything fails.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { version as STORAGE_PACKAGE_VERSION } from "./version.js";
import type { OpenedDatabase } from "./database.js";
import { MIGRATIONS, openDatabase } from "./database.js";
import type { DataLayout } from "./layout.js";
import {
  dataVersionUnsupported,
  diskFull,
  invalidInput,
  storageErrorFromFsError,
  StorageError,
} from "./errors.js";
import { assertNoActiveRuns } from "./repos/runs.js";
import { FileCredentialBlobStore, listMissingCredentialRefs } from "./credentials.js";

export const BACKUP_MANIFEST_FILE = "manifest.json";
export const BACKUP_DATABASE_FILE = "app.sqlite";
const BACKUP_KIND = "deepseek-bot-backup";
const MANIFEST_VERSION = 1;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export interface BackupManifest {
  readonly kind: typeof BACKUP_KIND;
  readonly manifestVersion: number;
  readonly createdAt: string;
  /** Metadata database schema version at backup time. */
  readonly schemaVersion: number;
  readonly storagePackageVersion: string;
  readonly includes: { readonly database: true; readonly artifacts: boolean };
  readonly files: ReadonlyArray<BackupFileEntry>;
  readonly notes: {
    readonly sensitive: string;
    readonly excluded: ReadonlyArray<string>;
  };
}

export interface BackupFileEntry {
  /** Path relative to the backup directory, always `/`-separated. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CreateBackupOptions {
  readonly db: OpenedDatabase;
  readonly layout: DataLayout;
  /** Must not exist yet; created by this call. */
  readonly destinationDir: string;
  /** Include the artifacts tree (user work products); default false. */
  readonly includeArtifacts?: boolean;
}

export function createBackup(options: CreateBackupOptions): BackupManifest {
  assertNoActiveRuns(options.db);
  if (fs.existsSync(options.destinationDir)) {
    throw invalidInput("backup destination already exists", {
      destinationDir: options.destinationDir,
    });
  }
  checkFreeSpace(options.db.file);

  // Flush the WAL into the main file so the snapshot is complete on its own.
  options.db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  fs.mkdirSync(options.destinationDir, { recursive: true });

  const snapshotFile = path.join(options.destinationDir, BACKUP_DATABASE_FILE);
  try {
    options.db.raw.exec(`VACUUM INTO '${quoteSqlPath(snapshotFile)}';`);
  } catch (error) {
    throw storageErrorFromFsError(error, "writing the backup snapshot");
  }

  const files: BackupFileEntry[] = [
    hashFile(BACKUP_DATABASE_FILE, path.join(options.destinationDir, BACKUP_DATABASE_FILE)),
  ];

  if (options.includeArtifacts === true) {
    copyTreeVerified(options.layout.artifacts, path.join(options.destinationDir, "artifacts"));
    collectFileHashes(
      path.join(options.destinationDir, "artifacts"),
      "artifacts",
      files,
    );
  }

  const manifest: BackupManifest = {
    kind: BACKUP_KIND,
    manifestVersion: MANIFEST_VERSION,
    createdAt: options.db.now().toISOString(),
    schemaVersion: options.db.schemaVersion,
    storagePackageVersion: STORAGE_PACKAGE_VERSION,
    includes: { database: true, artifacts: options.includeArtifacts === true },
    files,
    notes: {
      sensitive:
        "Backup contents include chat and run history; store and share it carefully.",
      excluded: ["credentials/", "harness/", "cache/", "logs/"],
    },
  };
  fs.writeFileSync(
    path.join(options.destinationDir, BACKUP_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8" },
  );
  return manifest;
}

/** Quote a filesystem path for SQLite SQL (single quotes doubled). */
function quoteSqlPath(file: string): string {
  return file.split("'").join("''").split("\\").join("/");
}

function checkFreeSpace(dbFile: string): void {
  let dbSize: number;
  try {
    dbSize = fs.statSync(dbFile).size;
  } catch {
    return; // No size → no prediction possible; VACUUM INTO will fail loudly.
  }
  try {
    const stats = fs.statfsSync(path.dirname(dbFile));
    if (typeof stats.bsize === "number" && typeof stats.bavail === "number") {
      const available = stats.bsize * stats.bavail;
      if (available < dbSize * 2 + 64 * 1024 * 1024) {
        throw diskFull("not enough free space for the backup snapshot");
      }
    }
  } catch (error) {
    if (error instanceof StorageError) {
      throw error;
    }
    // statfs is best-effort; free-space detection is not available everywhere.
  }
}

function hashFile(relativePath: string, absolutePath: string): BackupFileEntry {
  const hash = createHash("sha256");
  const stat = fs.statSync(absolutePath);
  const fd = fs.openSync(absolutePath, "r");
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { path: relativePath, bytes: stat.size, sha256: hash.digest("hex") };
}

function collectFileHashes(
  dir: string,
  prefix: string,
  files: BackupFileEntry[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFileHashes(child, relative, files);
    } else if (entry.isFile()) {
      files.push(hashFile(relative, child));
    }
  }
}

function copyTreeVerified(sourceDir: string, destinationDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return;
    }
    throw storageErrorFromFsError(error, `reading ${sourceDir}`);
  }
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeVerified(source, destination);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, destination);
    }
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  readonly layout: DataLayout;
  readonly sourceDir: string;
  readonly now?: () => Date;
  readonly maxTotalBytes?: number;
  readonly maxFileBytes?: number;
}

export interface RestoreResult {
  readonly manifest: BackupManifest;
  /** Open handle to the restored (and migrated) database. */
  readonly db: OpenedDatabase;
  /** Where the previous database was stashed (kept, not deleted). */
  readonly stashDir: string;
  /** Credential refs that need re-entry after restore (blobs are excluded). */
  readonly missingCredentialRefs: string[];
  /** Artifact files that already existed with different content. */
  readonly artifactConflicts: string[];
}

/**
 * Restore a verified backup. Rejects unknown/newer versions, tampered files
 * and unsafe paths before touching the current data. The pre-restore
 * database is preserved under `<root>/backups/pre-restore-<ts>/`.
 */
export function restoreBackup(options: RestoreOptions): RestoreResult {
  const maxTotal = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFile = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const manifest = readBackupManifest(options.sourceDir);
  const latestKnown = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.id), 0);
  if (manifest.schemaVersion > latestKnown) {
    throw dataVersionUnsupported(
      "backup was created by a newer application version and cannot be restored",
      { backupSchemaVersion: manifest.schemaVersion, latestKnown },
    );
  }

  verifyBackupFiles(options.sourceDir, manifest, maxTotal, maxFile);

  // Precondition: no active runs in the database that is about to be replaced.
  const current = openDatabase(options.layout.dbFile, {
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  try {
    assertNoActiveRuns(current);
  } finally {
    current.close();
  }

  const stashDir = stashCurrentDatabase(options.layout, options.now ?? (() => new Date()));
  let reopened: OpenedDatabase | undefined;
  try {
    installRestoredDatabase(options.layout, options.sourceDir, manifest.files);
    reopened = openDatabase(options.layout.dbFile, {
      ...(options.now !== undefined ? { now: options.now } : {}),
      verifyIntegrity: true,
    });
    const artifactConflicts = installRestoredArtifacts(options.layout, options.sourceDir, manifest);
    const missingCredentialRefs = listMissingCredentialRefs(
      reopened,
      new FileCredentialBlobStore(options.layout.credentials),
    );
    return { manifest, db: reopened, stashDir, missingCredentialRefs, artifactConflicts };
  } catch (error) {
    if (reopened !== undefined) {
      reopened.close();
    }
    rollbackRestore(options.layout, stashDir);
    throw error;
  }
}

/**
 * Parse and structurally validate a backup manifest without touching the
 * payload files (for UI preview before data.restore).
 */
export function readBackupManifest(sourceDir: string): BackupManifest {
  const file = path.join(sourceDir, BACKUP_MANIFEST_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, { encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      throw invalidInput("backup directory has no manifest", { sourceDir });
    }
    throw storageErrorFromFsError(error, "reading the backup manifest");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidInput("backup manifest is not valid JSON");
  }
  const manifest = parsed as BackupManifest;
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.kind !== BACKUP_KIND ||
    typeof manifest.manifestVersion !== "number"
  ) {
    throw invalidInput("file is not a DeepSeekBot backup manifest");
  }
  if (manifest.manifestVersion > MANIFEST_VERSION) {
    throw dataVersionUnsupported(
      "backup manifest version is newer than this application supports",
      { manifestVersion: manifest.manifestVersion, supportedVersion: MANIFEST_VERSION },
    );
  }
  if (typeof manifest.schemaVersion !== "number" || manifest.schemaVersion < 1) {
    throw invalidInput("backup manifest has an invalid schemaVersion");
  }
  if (!Array.isArray(manifest.files)) {
    throw invalidInput("backup manifest has no file list");
  }
  return manifest;
}

function verifyBackupFiles(
  sourceDir: string,
  manifest: BackupManifest,
  maxTotal: number,
  maxFile: number,
): void {
  let total = 0;
  for (const entry of manifest.files) {
    assertSafeBackupPath(entry.path);
    if (entry.bytes > maxFile) {
      throw invalidInput("backup file exceeds the size limit", { path: entry.path });
    }
    total += entry.bytes;
    if (total > maxTotal) {
      throw invalidInput("backup exceeds the total size limit");
    }
    const absolute = path.join(sourceDir, ...entry.path.split("/"));
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      throw invalidInput("backup file listed in the manifest is missing", {
        path: entry.path,
      });
    }
    if (!stat.isFile() || stat.size !== entry.bytes) {
      throw invalidInput("backup file size does not match the manifest", {
        path: entry.path,
      });
    }
    const actual = hashFile(entry.path, absolute).sha256;
    if (actual !== entry.sha256) {
      throw invalidInput("backup file checksum does not match the manifest", {
        path: entry.path,
      });
    }
  }
}

/**
 * Manifest paths must stay inside the backup directory: `/`-separated,
 * relative, no traversal, no drive letters. Only the database file and the
 * artifacts tree are accepted.
 */
function assertSafeBackupPath(entryPath: string): void {
  if (entryPath === "") {
    throw invalidInput("backup manifest contains an empty path");
  }
  if (entryPath.includes("\\") || entryPath.includes("\0")) {
    throw invalidInput("backup manifest path contains invalid separators", {
      path: entryPath,
    });
  }
  const segments = entryPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw invalidInput("backup manifest path contains traversal segments", {
      path: entryPath,
    });
  }
  if (/^[a-zA-Z]:/.test(entryPath)) {
    throw invalidInput("backup manifest path must be relative", { path: entryPath });
  }
  if (segments[0] !== "app.sqlite" && segments[0] !== "artifacts") {
    throw invalidInput("backup manifest references an unexpected file", {
      path: entryPath,
    });
  }
}

function stashCurrentDatabase(layout: DataLayout, now: () => Date): string {
  const stamp = now()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+Z$/, "Z");
  const stashDir = path.join(layout.backups, `pre-restore-${stamp}`);
  if (fs.existsSync(stashDir)) {
    throw invalidInput("a pre-restore stash already exists for this timestamp", {
      stashDir,
    });
  }
  fs.mkdirSync(stashDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = `${layout.dbFile}${suffix}`;
    if (fs.existsSync(file)) {
      fs.renameSync(file, path.join(stashDir, `app.sqlite${suffix}`));
    }
  }
  return stashDir;
}

function installRestoredDatabase(
  layout: DataLayout,
  sourceDir: string,
  files: ReadonlyArray<BackupFileEntry>,
): void {
  const entry = files.find((candidate) => candidate.path === BACKUP_DATABASE_FILE);
  if (entry === undefined) {
    throw invalidInput("backup manifest does not include the database file");
  }
  const source = path.join(sourceDir, BACKUP_DATABASE_FILE);
  fs.copyFileSync(source, layout.dbFile);
  const copied = hashFile(BACKUP_DATABASE_FILE, layout.dbFile);
  if (copied.sha256 !== entry.sha256) {
    throw invalidInput("restored database copy is corrupt", {
      path: BACKUP_DATABASE_FILE,
    });
  }
}

function installRestoredArtifacts(
  layout: DataLayout,
  sourceDir: string,
  manifest: BackupManifest,
): string[] {
  const conflicts: string[] = [];
  for (const entry of manifest.files) {
    if (!entry.path.startsWith("artifacts/")) {
      continue;
    }
    const destination = path.join(layout.artifacts, ...entry.path.split("/").slice(1));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) {
      const existing = hashFile(entry.path, destination);
      if (existing.sha256 === entry.sha256) {
        continue;
      }
      conflicts.push(entry.path);
      continue;
    }
    fs.copyFileSync(path.join(sourceDir, ...entry.path.split("/")), destination);
    const copied = hashFile(entry.path, destination);
    if (copied.sha256 !== entry.sha256) {
      throw invalidInput("restored artifact copy is corrupt", { path: entry.path });
    }
  }
  return conflicts;
}

/** Undo a failed restore: remove the installed copy and move the stash back. */
function rollbackRestore(layout: DataLayout, stashDir: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const installed = `${layout.dbFile}${suffix}`;
    try {
      fs.rmSync(installed, { force: true });
    } catch {
      // Best-effort cleanup; the stash still holds the original.
    }
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const stashed = path.join(stashDir, `app.sqlite${suffix}`);
    if (fs.existsSync(stashed)) {
      try {
        fs.renameSync(stashed, `${layout.dbFile}${suffix}`);
      } catch {
        // Leave the stash in place; recovery keeps the original data.
      }
    }
  }
}
