/**
 * Chat replay budget.
 *
 * Each turn used to paste the oldest 20 stored rows into the prompt. A long
 * thread either paid for stale text or, once a summary watermark fell
 * outside that window, paid for the digest and those stale rows together.
 * Replay now takes the newest rows and drops whole turns from the oldest
 * end until the history block fits a token budget. Short threads that
 * already fit are unchanged.
 */
import { estimateTokens } from "./usage-capture.js";

/** History block only. Persona, digest, and the current message sit outside it. */
export const REPLAY_HISTORY_TOKEN_BUDGET = 6_000;

/** Newest rows read before the token trim. The budget, not this cap, decides the prompt. */
export const REPLAY_ROW_SCAN = 80;

export interface ReplayRow {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export function replayTokenCount(rows: readonly ReplayRow[]): number {
  if (rows.length === 0) return 0;
  return estimateTokens(rows.map((row) => row.text).join("\n"));
}

function dropOldestTurn(rows: ReplayRow[]): void {
  rows.shift();
  while (rows[0]?.role === "assistant") rows.shift();
}

/** Keep a marked tail of `text` whose token estimate fits `budget`. */
function tailWithinBudget(text: string, budget: number): string {
  if (budget < 1 || text.length === 0) return "";
  if (estimateTokens(text) <= budget) return text;
  const fits = (chars: number): boolean =>
    estimateTokens(`…${text.slice(text.length - chars)}`) <= budget;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  if (low === 0) return "";
  return `…${text.slice(text.length - low)}`;
}

function countTurns(rows: readonly ReplayRow[]): number {
  let count = 0;
  let index = 0;
  while (index < rows.length) {
    if (rows[index]?.role === "assistant") {
      while (rows[index]?.role === "assistant") index += 1;
    } else {
      index += 1;
      while (rows[index]?.role === "assistant") index += 1;
    }
    count += 1;
  }
  return count;
}

/**
 * Drop oldest turns until the remaining rows fit `budget`.
 * The newest turn stays: its oldest lines go first, and a last line that
 * is still too long keeps its tail.
 */
export function trimReplayToBudget(
  rows: readonly ReplayRow[],
  budget = REPLAY_HISTORY_TOKEN_BUDGET,
): ReplayRow[] {
  const kept = rows.slice();
  while (kept.length > 0 && replayTokenCount(kept) > budget && countTurns(kept) > 1) {
    const before = kept.length;
    dropOldestTurn(kept);
    if (kept.length >= before) break;
  }
  while (kept.length > 1 && replayTokenCount(kept) > budget) {
    kept.shift();
  }
  const only = kept[0];
  if (only !== undefined && replayTokenCount(kept) > budget) {
    kept[0] = { ...only, text: tailWithinBudget(only.text, budget) };
  }
  return kept;
}

/**
 * A compression turn is worth its model call only when it removes rows the
 * next prompt would still send. Rows the budget already dropped are not
 * waiting on a digest.
 */
export function compressionShrinksReplay(
  compressIds: readonly string[],
  replayIds: ReadonlySet<string>,
): boolean {
  return compressIds.some((id) => replayIds.has(id));
}
