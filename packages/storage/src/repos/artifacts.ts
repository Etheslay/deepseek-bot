/**
 * Artifact repository (CONTRACTS.md §2 Artifact).
 *
 * Rows are metadata only; files live under the artifacts directory and are
 * verified by checksum before being opened (enforcement by the Host).
 */
import { ArtifactSchema, type Artifact } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { isoNow } from "./shared.js";

interface ArtifactRow {
  id: string;
  run_id: string;
  node_run_id: string;
  relative_path: string;
  media_type: string;
  size: number;
  checksum_algorithm: string;
  checksum_value: string;
  created_at: string;
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return ArtifactSchema.parse({
    id: row.id,
    runId: row.run_id,
    nodeRunId: row.node_run_id,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    size: row.size,
    checksum: { algorithm: row.checksum_algorithm, value: row.checksum_value },
  });
}

export function registerArtifact(db: OpenedDatabase, artifact: Artifact): Artifact {
  const parsed = ArtifactSchema.parse(artifact);
  if (db.raw.prepare("SELECT id FROM runs WHERE id = ?;").get(parsed.runId) === undefined) {
    throw invalidInput("run does not exist", { runId: parsed.runId });
  }
  if (
    db.raw.prepare("SELECT id FROM node_runs WHERE id = ?;").get(parsed.nodeRunId) === undefined
  ) {
    throw invalidInput("node run does not exist", { nodeRunId: parsed.nodeRunId });
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO artifacts (id, run_id, node_run_id, relative_path, media_type, size, " +
          "checksum_algorithm, checksum_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.runId,
        parsed.nodeRunId,
        parsed.relativePath,
        parsed.mediaType,
        parsed.size,
        parsed.checksum.algorithm,
        parsed.checksum.value,
        now,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw invalidInput("artifact id already exists", { artifactId: parsed.id });
    }
    throw error;
  }
  return parsed;
}

export function getArtifact(db: OpenedDatabase, id: string): Artifact | undefined {
  const row = db.raw.prepare("SELECT * FROM artifacts WHERE id = ?;").get(id) as
    | ArtifactRow
    | undefined;
  return row === undefined ? undefined : rowToArtifact(row);
}

export function listArtifacts(
  db: OpenedDatabase,
  options: { runId?: string; nodeRunId?: string } = {},
): Artifact[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (options.runId !== undefined) {
    conditions.push("run_id = ?");
    params.push(options.runId);
  }
  if (options.nodeRunId !== undefined) {
    conditions.push("node_run_id = ?");
    params.push(options.nodeRunId);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.raw
    .prepare(`SELECT * FROM artifacts${where} ORDER BY created_at ASC, id ASC;`)
    .all(...params) as unknown as ArtifactRow[];
  return rows.map(rowToArtifact);
}
