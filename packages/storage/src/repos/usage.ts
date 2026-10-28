/**
 * Token usage accounting (docs/CONTRACTS.md §3, usage.summary).
 *
 * The harness reports token counts per model turn. This module stores one row
 * per turn and aggregates it three ways: per model (the table), per local day
 * (the trend line) and per bot (the breakdown).
 *
 * `source` distinguishes a count the harness actually reported from a local
 * estimate for a turn whose usage block never arrived. Aggregates keep that
 * distinction: a bucket containing any estimated row is flagged, so the page can
 * label an estimate instead of passing it off as billed usage.
 */
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";

export const USAGE_SOURCES = ["harness", "estimated"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

/** One recorded turn. */
export interface UsageEventInput {
  readonly id: string;
  readonly botId: string | null;
  readonly model: string | null;
  readonly sessionId: string | null;
  readonly occurredAt: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly source: UsageSource;
}

export interface UsageTotalsRow {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  turns: number;
  estimated: boolean;
}

export interface UsageModelAggregate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  turns: number;
}

export interface UsageBotAggregate {
  botId: string | null;
  botName: string | null;
  inputTokens: number;
  outputTokens: number;
  turns: number;
}

export interface UsageDayAggregate {
  day: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummaryRows {
  totals: UsageTotalsRow;
  byModel: UsageModelAggregate[];
  byDay: UsageDayAggregate[];
  byBot: UsageBotAggregate[];
}

function requireCount(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidInput(`usage ${field} must be a non-negative integer`, { field, value });
  }
  return value;
}

function requireSource(source: string): UsageSource {
  if (source === "harness" || source === "estimated") return source;
  throw invalidInput("usage source is unknown", { source });
}

/** Persist one turn. Counts are validated before the insert. */
export function recordUsage(db: OpenedDatabase, input: UsageEventInput): void {
  if (typeof input.occurredAt !== "string" || !input.occurredAt.endsWith("Z")) {
    throw invalidInput("usage occurredAt must be a UTC ISO timestamp", {
      occurredAt: input.occurredAt,
    });
  }
  db.raw
    .prepare(
      `INSERT INTO usage_events (
         id, bot_id, model, session_id, occurred_at,
         input_tokens, output_tokens, cached_input_tokens, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    )
    .run(
      input.id,
      input.botId,
      input.model,
      input.sessionId,
      input.occurredAt,
      requireCount(input.inputTokens, "inputTokens"),
      requireCount(input.outputTokens, "outputTokens"),
      requireCount(input.cachedInputTokens, "cachedInputTokens"),
      requireSource(input.source),
    );
}

interface SqlAggregateRow {
  key: string | null;
  name: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  turns: number;
}

interface SqlDayRow {
  occurred_at: string;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Aggregate everything at or after `sinceIso`, optionally for one bot.
 * `dayOf` turns a UTC timestamp into the local calendar day the caller wants to
 * bucket by — the repository does not guess a timezone.
 */
export function summarizeUsage(
  db: OpenedDatabase,
  options: { sinceIso: string; botId?: string | undefined; dayOf: (iso: string) => string },
): UsageSummaryRows {
  const where = options.botId === undefined ? "occurred_at >= ?" : "occurred_at >= ? AND bot_id = ?";
  /* the bot join needs its own qualified predicate; keep the two explicit */
  const whereQualified =
    options.botId === undefined ? "u.occurred_at >= ?" : "u.occurred_at >= ? AND u.bot_id = ?";
  const params: string[] = [options.sinceIso];
  if (options.botId !== undefined) params.push(options.botId);

  const modelRows = db.raw
    .prepare(
      `SELECT COALESCE(model, 'unknown') AS key, NULL AS name,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens,
              COUNT(*) AS turns
         FROM usage_events
        WHERE ${where}
        GROUP BY COALESCE(model, 'unknown')
        ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC;`,
    )
    .all(...params) as unknown as SqlAggregateRow[];

  const botRows = db.raw
    .prepare(
      `SELECT u.bot_id AS key, b.name AS name,
              SUM(u.input_tokens) AS input_tokens,
              SUM(u.output_tokens) AS output_tokens,
              SUM(u.cached_input_tokens) AS cached_input_tokens,
              COUNT(*) AS turns
         FROM usage_events u
         LEFT JOIN bots b ON b.id = u.bot_id
        WHERE ${whereQualified}
        GROUP BY u.bot_id
        ORDER BY (SUM(u.input_tokens) + SUM(u.output_tokens)) DESC;`,
    )
    .all(...params) as unknown as SqlAggregateRow[];

  const totalsRow = db.raw
    .prepare(
      `SELECT SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens,
              COUNT(*) AS turns,
              SUM(CASE WHEN source = 'estimated' THEN 1 ELSE 0 END) AS estimated_turns
         FROM usage_events
        WHERE ${where};`,
    )
    .get(...params) as unknown as
    | { input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; turns: number; estimated_turns: number | null }
    | undefined;

  const dayRows = db.raw
    .prepare(
      `SELECT occurred_at, input_tokens, output_tokens
         FROM usage_events
        WHERE ${where}
        ORDER BY occurred_at ASC;`,
    )
    .all(...params) as unknown as SqlDayRow[];

  const days = new Map<string, UsageDayAggregate>();
  for (const row of dayRows) {
    const day = options.dayOf(row.occurred_at);
    const bucket = days.get(day) ?? { day, inputTokens: 0, outputTokens: 0 };
    bucket.inputTokens += row.input_tokens;
    bucket.outputTokens += row.output_tokens;
    days.set(day, bucket);
  }

  return {
    totals: {
      inputTokens: totalsRow?.input_tokens ?? 0,
      outputTokens: totalsRow?.output_tokens ?? 0,
      cachedInputTokens: totalsRow?.cached_input_tokens ?? 0,
      turns: totalsRow?.turns ?? 0,
      estimated: (totalsRow?.estimated_turns ?? 0) > 0,
    },
    byModel: modelRows.map((row) => ({
      model: row.key ?? "unknown",
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
      turns: row.turns,
    })),
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byBot: botRows.map((row) => ({
      botId: row.key,
      botName: row.name,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      turns: row.turns,
    })),
  };
}

/** Earliest recorded timestamp, for the "all time" window. */
export function earliestUsageAt(db: OpenedDatabase): string | null {
  const row = db.raw
    .prepare("SELECT MIN(occurred_at) AS first FROM usage_events;")
    .get() as unknown as { first: string | null } | undefined;
  return row?.first ?? null;
}
