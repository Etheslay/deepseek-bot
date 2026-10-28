/**
 * `usage.summary` aggregation (host side of the token usage page).
 *
 * The window is a rolling number of days ending now; the daily buckets are
 * local calendar days because the page shows them to a person, not to a log.
 */
import type { UsageSummary } from "@deepseek-bot/contracts";
import { summarizeUsage, type OpenedDatabase } from "@deepseek-bot/storage";

export const DEFAULT_USAGE_DAYS = 30;
const MAX_USAGE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day for a UTC timestamp, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildUsageSummary(
  db: OpenedDatabase,
  input: { botId?: string | undefined; days?: number | undefined; now: () => Date },
): UsageSummary {
  const requested = input.days ?? DEFAULT_USAGE_DAYS;
  const days = Math.min(Math.max(Math.trunc(requested), 1), MAX_USAGE_DAYS);
  const sinceIso = new Date(input.now().getTime() - days * DAY_MS).toISOString();
  const summary = summarizeUsage(db, {
    sinceIso,
    ...(input.botId !== undefined ? { botId: input.botId } : {}),
    dayOf: localDay,
  });
  return {
    windowDays: days,
    totals: summary.totals,
    byModel: summary.byModel,
    byDay: summary.byDay,
    byBot: summary.byBot,
  };
}
