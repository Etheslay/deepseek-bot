/**
 * Token usage accounting (docs/CONTRACTS.md §3).
 *
 * The harness reports token counts per model turn. This contract only exposes
 * the aggregate the settings page needs: totals, a per-model table, a daily
 * series for the trend line, and a per-bot breakdown.
 *
 * `estimated` is part of the payload on purpose. A turn whose usage block was
 * missing from the event stream is recorded from a local estimate, and the UI
 * must be able to label those numbers instead of presenting them as billed
 * usage. A summary is `estimated: true` when any contributing row was.
 */
import { z } from "zod";

const TokenCount = z.int().min(0);

export const UsageTotalsSchema = z.object({
  inputTokens: TokenCount,
  outputTokens: TokenCount,
  cachedInputTokens: TokenCount,
  turns: TokenCount,
  estimated: z.boolean(),
});

export const UsageModelRowSchema = z.object({
  /** The model id reported by the harness, or "unknown" when it reported none. */
  model: z.string(),
  inputTokens: TokenCount,
  outputTokens: TokenCount,
  cachedInputTokens: TokenCount,
  turns: TokenCount,
});

export const UsageDailyRowSchema = z.object({
  /** Local calendar day, YYYY-MM-DD. */
  day: z.string(),
  inputTokens: TokenCount,
  outputTokens: TokenCount,
});

export const UsageBotRowSchema = z.object({
  botId: z.string().nullable(),
  botName: z.string().nullable(),
  inputTokens: TokenCount,
  outputTokens: TokenCount,
  turns: TokenCount,
});

/** One `usage.summary` response: everything the usage page draws. */
export const UsageSummarySchema = z.object({
  windowDays: TokenCount,
  totals: UsageTotalsSchema,
  byModel: z.array(UsageModelRowSchema),
  byDay: z.array(UsageDailyRowSchema),
  byBot: z.array(UsageBotRowSchema),
});

export type UsageTotals = z.infer<typeof UsageTotalsSchema>;
export type UsageModelRow = z.infer<typeof UsageModelRowSchema>;
export type UsageDailyRow = z.infer<typeof UsageDailyRowSchema>;
export type UsageBotRow = z.infer<typeof UsageBotRowSchema>;
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const USAGE_METHODS = {
  "usage.summary": {
    request: z
      .object({
        /** Restrict to one bot; omitted means every bot. */
        botId: z.string().uuid().optional(),
        /** Rolling window in days; omitted means the storage default. */
        days: z.int().min(1).max(365).optional(),
      })
      .strict(),
    response: UsageSummarySchema,
  },
} as const;
