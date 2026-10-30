/**
 * Single-result cap for tool outputs that feed the model prompt.
 *
 * Every Host-executed tool result crosses `app-tool-channel.ts` back to the
 * harness bridge, whose render step (`packages/harness-bridge/src/app-tools.ts`)
 * JSON.stringify's the value into the tool_result text the harness assembles
 * into its next prompt. One long log line used to be able to eat half the
 * window; an oversized result is now cut to head + tail around a marker.
 *
 * The cap only shrinks the copy that enters the prompt. Original data stays
 * wherever the tool already persisted it (workspace files on disk, run events
 * in the database, attachment bytes under the data root) — nothing here writes
 * or deletes persisted data, so the marker can point the model at
 * `read_workspace_file` to re-read the full content when one exists.
 */
import { estimateTokens, tokenWeight } from "./usage-capture.js";

/** Default single-result budget, measured with the P1 weighted estimate. */
export const MAX_TOOL_RESULT_TOKENS = 8_000;
/** Head share of the retained budget; the rest goes to the tail. */
const HEAD_SHARE = 0.6;

/** The one-line notice inserted between the retained head and tail. */
export function truncationMarker(originalTokens: number): string {
  return `…（工具输出已截断：原始 ${originalTokens} tokens，此处保留首尾；完整内容可用 read_workspace_file 读取）`;
}

export interface ToolResultCap {
  /** The (possibly replaced) tool result value sent back to the harness. */
  readonly value: unknown;
  readonly truncated: boolean;
  readonly originalTokens: number;
}

/**
 * Cap one tool result by its serialized size: results at or under the budget
 * pass through untouched; oversized ones become a plain string of head +
 * marker + tail, because the bridge renders the value with JSON.stringify.
 */
export function capToolResultValue(
  value: unknown,
  maxTokens: number = MAX_TOOL_RESULT_TOKENS,
): ToolResultCap {
  const serialized = JSON.stringify(value) ?? "null";
  const originalTokens = estimateTokens(serialized);
  if (originalTokens <= maxTokens) {
    return { value, truncated: false, originalTokens };
  }
  const marker = truncationMarker(originalTokens);
  const markerTokens = estimateTokens(marker);
  const retained = maxTokens - markerTokens - 1; // slack for the joiner newlines
  if (retained < 2) {
    // Budget too small to keep anything around the marker — marker only.
    return { value: marker, truncated: true, originalTokens };
  }
  const headBudget = Math.floor(retained * HEAD_SHARE);
  const tailBudget = retained - headBudget;
  const head = sliceWithinBudget(serialized, headBudget, true);
  const tail = sliceWithinBudget(serialized, tailBudget, false);
  return { value: `${head}\n${marker}\n${tail}`, truncated: true, originalTokens };
}

/**
 * Longest prefix (head) or suffix (tail) of `text` whose weighted token
 * estimate stays within `budget`. Same weights as `estimateTokens`, without
 * the trim (slices never span the trimmed edges alone).
 */
function sliceWithinBudget(text: string, budget: number, head: boolean): string {
  if (budget <= 0 || text.length === 0) return "";
  let total = 0;
  if (head) {
    let end = 0;
    while (end < text.length) {
      const weight = tokenWeight(text.charCodeAt(end));
      if (total + weight > budget) break;
      total += weight;
      end += 1;
    }
    return text.slice(0, end);
  }
  let start = text.length;
  while (start > 0) {
    const weight = tokenWeight(text.charCodeAt(start - 1));
    if (total + weight > budget) break;
    total += weight;
    start -= 1;
  }
  return text.slice(start);
}
