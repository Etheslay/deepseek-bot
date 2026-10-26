/**
 * D18 保留策略: retention limits for memory notes and knowledge docs,
 * stored as one settings key. Zero means "keep everything" and is the
 * default; a corrupt or missing value reads as zero, so a broken setting
 * can never widen deletion — deleting is the dangerous direction, keep is
 * the safe one. Applied at host start and after every memory/knowledge
 * write, so limits take effect without a dedicated timer.
 */
import type { OpenedDatabase } from "../database.js";
import { getSettingRaw, setSetting } from "./settings.js";

export const RETENTION_SETTING_KEY = "memory.retention";

export interface RetentionPolicy {
  /** Days a memory note stays; 0 keeps it until deleted by hand. */
  readonly retentionDays: number;
  /** Newest N memory notes kept per bot; 0 is unlimited. */
  readonly memoryMaxPerBot: number;
  /** Newest N knowledge docs kept per bot; 0 is unlimited. */
  readonly knowledgeMaxPerBot: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  retentionDays: 0,
  memoryMaxPerBot: 0,
  knowledgeMaxPerBot: 0,
};

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

export function readRetentionPolicy(db: OpenedDatabase): RetentionPolicy {
  const raw = getSettingRaw(db, RETENTION_SETTING_KEY);
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_RETENTION_POLICY;
  }
  const record = raw as Record<string, unknown>;
  return {
    retentionDays: nonNegativeInt(record.retentionDays),
    memoryMaxPerBot: nonNegativeInt(record.memoryMaxPerBot),
    knowledgeMaxPerBot: nonNegativeInt(record.knowledgeMaxPerBot),
  };
}

export function writeRetentionPolicy(
  db: OpenedDatabase,
  policy: RetentionPolicy,
): RetentionPolicy {
  setSetting(db, RETENTION_SETTING_KEY, {
    retentionDays: policy.retentionDays,
    memoryMaxPerBot: policy.memoryMaxPerBot,
    knowledgeMaxPerBot: policy.knowledgeMaxPerBot,
  });
  return policy;
}

export interface RetentionSweepResult {
  readonly expiredMemories: number;
  readonly trimmedMemories: number;
  readonly trimmedDocs: number;
}

/**
 * Apply the policy across every bot. Age cutoff applies to memory notes
 * only — imported knowledge is a user artifact and never expires by clock,
 * only by the per-bot cap. Runs synchronously inside the caller's context;
 * local data volumes make the per-bot walks negligible.
 */
export function sweepRetention(
  db: OpenedDatabase,
  policy: RetentionPolicy,
  now: Date,
): RetentionSweepResult {
  let expiredMemories = 0;
  let trimmedMemories = 0;
  let trimmedDocs = 0;

  if (policy.retentionDays > 0) {
    const cutoff = new Date(
      now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const result = db.raw
      .prepare("DELETE FROM memories WHERE created_at < ?;")
      .run(cutoff);
    expiredMemories = Number(result.changes);
  }

  trimmedMemories += trimPerBot(db, "memories", policy.memoryMaxPerBot);
  trimmedDocs += trimPerBot(db, "knowledge_docs", policy.knowledgeMaxPerBot);

  return { expiredMemories, trimmedMemories, trimmedDocs };
}

/** Keep the newest `max` rows per bot (0 = unlimited). */
function trimPerBot(
  db: OpenedDatabase,
  table: "memories" | "knowledge_docs",
  max: number,
): number {
  if (max <= 0) return 0;
  const rows = db.raw
    .prepare(
      `SELECT bot_id, id FROM ${table} ORDER BY bot_id ASC, created_at DESC, rowid DESC;`,
    )
    .all() as unknown as Array<{ bot_id: string; id: string }>;
  const seen = new Map<string, number>();
  const deleteStmt = db.raw.prepare(`DELETE FROM ${table} WHERE id = ?;`);
  let removed = 0;
  for (const row of rows) {
    const count = (seen.get(row.bot_id) ?? 0) + 1;
    seen.set(row.bot_id, count);
    if (count > max) {
      deleteStmt.run(row.id);
      removed += 1;
    }
  }
  return removed;
}
