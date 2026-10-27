/**
 * Artifact version repository (D28 co-edit sidecar, migration 0010).
 *
 * Metadata rows only — the version content lives as a file whose absolute
 * path is stored in `content_path` (Host-owned `<root>/artifacts/
 * coedit-versions/` tree). Rows are append-only by design: saves, reverts
 * and reconciled bot writes always INSERT; the only DELETE is pruning the
 * oldest rows beyond the per-file version cap, together with their files.
 */
import { ArtifactVersionSchema, type ArtifactVersion } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { isoNow } from "./shared.js";

interface ArtifactVersionRow {
  id: string;
  bot_id: string;
  relative_path: string;
  revision: number;
  author: string;
  media_type: string;
  size: number;
  checksum_algorithm: string;
  checksum_value: string;
  content_path: string;
  created_at: string;
}

function rowToVersion(row: ArtifactVersionRow): ArtifactVersion {
  return ArtifactVersionSchema.parse({
    id: row.id,
    botId: row.bot_id,
    relativePath: row.relative_path,
    revision: row.revision,
    author: row.author,
    mediaType: row.media_type,
    size: row.size,
    checksum: { algorithm: row.checksum_algorithm, value: row.checksum_value },
    createdAt: row.created_at,
  });
}

export interface NewArtifactVersion {
  readonly id: string;
  readonly botId: string;
  readonly relativePath: string;
  readonly revision: number;
  readonly author: "user" | "bot";
  readonly mediaType: string;
  readonly size: number;
  readonly checksumValue: string;
  readonly contentPath: string;
}

export function insertArtifactVersion(db: OpenedDatabase, version: NewArtifactVersion): ArtifactVersion {
  if (db.raw.prepare("SELECT id FROM bots WHERE id = ?;").get(version.botId) === undefined) {
    throw invalidInput("bot does not exist", { botId: version.botId });
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO artifact_versions (id, bot_id, relative_path, revision, author, media_type, " +
          "size, checksum_algorithm, checksum_value, content_path, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'sha256', ?, ?, ?);",
      )
      .run(
        version.id,
        version.botId,
        version.relativePath,
        version.revision,
        version.author,
        version.mediaType,
        version.size,
        version.checksumValue,
        version.contentPath,
        now,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw invalidInput("artifact version revision already exists", {
        botId: version.botId,
        path: version.relativePath,
        revision: version.revision,
      });
    }
    throw error;
  }
  const stored = getArtifactVersion(db, version.id);
  if (stored === undefined) {
    throw invalidInput("artifact version vanished after insert", { id: version.id });
  }
  return stored;
}

export function getArtifactVersion(db: OpenedDatabase, id: string): ArtifactVersion | undefined {
  const row = db.raw.prepare("SELECT * FROM artifact_versions WHERE id = ?;").get(id) as
    | ArtifactVersionRow
    | undefined;
  return row === undefined ? undefined : rowToVersion(row);
}

/**
 * Absolute path of one version's snapshot file. Host-internal: the contract
 * type deliberately omits the storage location, but reading a version back
 * (preview, revert) needs the file.
 */
export function getArtifactVersionContentPath(db: OpenedDatabase, id: string): string | undefined {
  const row = db.raw
    .prepare("SELECT content_path FROM artifact_versions WHERE id = ?;")
    .get(id) as { content_path: string } | undefined;
  return row === undefined ? undefined : row.content_path;
}

export function listArtifactVersions(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
): ArtifactVersion[] {
  const rows = db.raw
    .prepare(
      "SELECT * FROM artifact_versions WHERE bot_id = ? AND relative_path = ? ORDER BY revision DESC, id ASC;",
    )
    .all(botId, relativePath) as unknown as ArtifactVersionRow[];
  return rows.map(rowToVersion);
}

export function latestArtifactVersion(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
): ArtifactVersion | undefined {
  const row = db.raw
    .prepare(
      "SELECT * FROM artifact_versions WHERE bot_id = ? AND relative_path = ? " +
        "ORDER BY revision DESC, id ASC LIMIT 1;",
    )
    .get(botId, relativePath) as ArtifactVersionRow | undefined;
  return row === undefined ? undefined : rowToVersion(row);
}

export function nextArtifactRevision(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
): number {
  const row = db.raw
    .prepare(
      "SELECT MAX(revision) AS max_revision FROM artifact_versions WHERE bot_id = ? AND relative_path = ?;",
    )
    .get(botId, relativePath) as { max_revision: number | null };
  return (row.max_revision ?? 0) + 1;
}

/**
 * Drop the oldest rows of one file beyond `keep` versions. Returns the
 * content paths of the pruned rows so the caller can delete the snapshot
 * files after the transaction succeeded.
 */
export function pruneArtifactVersions(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
  keep: number,
): string[] {
  const rows = db.raw
    .prepare(
      "SELECT id, content_path FROM artifact_versions WHERE bot_id = ? AND relative_path = ? " +
        "ORDER BY revision DESC, id ASC LIMIT -1 OFFSET ?;",
    )
    .all(botId, relativePath, keep) as unknown as Array<{ id: string; content_path: string }>;
  if (rows.length === 0) {
    return [];
  }
  const placeholders = rows.map(() => "?").join(", ");
  db.raw
    .prepare(`DELETE FROM artifact_versions WHERE id IN (${placeholders});`)
    .run(...rows.map((row) => row.id));
  return rows.map((row) => row.content_path);
}

export function countArtifactVersions(db: OpenedDatabase): number {
  const row = db.raw.prepare("SELECT COUNT(*) AS total FROM artifact_versions;").get() as {
    total: number;
  };
  return row.total;
}
