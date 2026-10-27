/**
 * "Thinking" status copy (task-aware placeholder with timed phases).
 *
 * The chat pipeline is one-shot: `chat.send` returns the final text only, so the
 * model's reasoning is not available while it works. The only task information
 * on hand is the user's own request, so the copy is an intent guess from that
 * text with an honest echo fallback — never invented content. While the wait
 * goes on, generic phase copy advances on a fixed cadence (深度思考 → 查阅文档
 * → 完成). The phases are a clock, not tool telemetry — they narrate that the
 * app is still working, never claim a specific tool ran. Real reasoning
 * streaming is a separate change in the adapter/host.
 *
 * Two copy layers come back separately:
 * - `announce` is the task-aware sentence for the `aria-live` region. It never
 *   changes while pending, so screen readers hear it once.
 * - `text` is the visible phase copy; it may tick freely because the component
 *   keeps it out of the live region.
 */

import { t, type MessageKey } from "../../i18n.js";
export type ThinkingStatus = {
  /** Task-aware sentence, stable for the whole wait; goes to aria-live. */
  readonly announce: string;
  /** Visible copy for the current phase; advances with elapsedMs. */
  readonly text: string;
  readonly hint: string | null;
};

export type ThinkingStatusInput = {
  /** The user's request, before any skill context is composed onto it. */
  request: string;
  /** How long the placeholder has been on screen. */
  elapsedMs: number;
  /** First reply chunk arrived: the bubble switches to the real text. */
  hasText: boolean;
};

/** Summary length cap for the echo fallback (characters, not bytes). */
export const MAX_SUMMARY_CHARS = 24;
/** Seconds become visible only once the wait is long enough to feel stuck. */
export const ELAPSED_HINT_AFTER_MS = 10_000;
/** The opening copy holds this long, then the phase ladder advances per step. */
export const PHASE_ADVANCE_MS = 1_000;

type Intent = { readonly pattern: RegExp; readonly copyKey: MessageKey };

/**
 * Ordered: the first match wins. Review comes before the search family because
 * "检查一下" contains "查"; matching runs on the cleaned text so an @mention such
 * as @设计师 cannot fire the "设计" intent.
 */
const INTENTS: readonly Intent[] = [
  { pattern: /工作流|workflow|编排/i, copyKey: "chat.intentWorkflow" },
  { pattern: /记忆|笔记|知识/i, copyKey: "chat.intentMemory" },
  { pattern: /代码|实现|重构|测试|函数|bug|报错/i, copyKey: "chat.intentCode" },
  { pattern: /评审|检查|审阅|复查/i, copyKey: "chat.intentReview" },
  { pattern: /搜索|搜一下|查询|资料|联网|上网/i, copyKey: "chat.intentResearch" },
  { pattern: /计划|方案|设计|架构/i, copyKey: "chat.intentPlan" },
  { pattern: /文件|文档|整理|总结|周报|纪要/i, copyKey: "chat.intentDocs" },
];

/**
 * Ordered wait phases after the opening copy; the last one holds. Generic on
 * purpose: they run for every request, including the echo fallback.
 */
const PHASE_KEYS: readonly MessageKey[] = [
  "chat.thinkingPhaseReasoning",
  "chat.thinkingPhaseDocs",
  "chat.thinkingPhaseFinishing",
];

/** Mentions stripped and whitespace collapsed, before the length cap. */
function cleanRequest(request: string): string {
  return request
    .replace(/@[^\s，。！？、,.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function capSummary(cleaned: string): string {
  const characters = Array.from(cleaned);
  if (characters.length <= MAX_SUMMARY_CHARS) {
    return cleaned;
  }
  return `${characters.slice(0, MAX_SUMMARY_CHARS).join("")}…`;
}

/** Drop @mentions, collapse whitespace and cap the length with an ellipsis. */
export function summarizeRequest(request: string): string {
  return capSummary(cleanRequest(request));
}

export function formatElapsed(ms: number): string {
  return `${Math.floor(Math.max(0, ms) / 1000)}s`;
}

/** Visible copy: the opening sentence first, then the phase ladder. */
function visibleText(elapsedMs: number, opening: string): string {
  if (elapsedMs < PHASE_ADVANCE_MS) {
    return opening;
  }
  const step = Math.floor((elapsedMs - PHASE_ADVANCE_MS) / PHASE_ADVANCE_MS);
  const key = PHASE_KEYS[Math.min(step, PHASE_KEYS.length - 1)];
  return key === undefined ? opening : t(key);
}

/**
 * Null once the reply starts arriving; otherwise the task-aware sentence (for
 * the aria-live region), the visible phase copy, and an optional elapsed hint.
 */
export function thinkingStatus(
  input: ThinkingStatusInput,
): ThinkingStatus | null {
  if (input.hasText) {
    return null;
  }
  const hint =
    input.elapsedMs >= ELAPSED_HINT_AFTER_MS ? formatElapsed(input.elapsedMs) : null;
  const cleaned = cleanRequest(input.request);
  const intent = INTENTS.find((entry) => entry.pattern.test(cleaned));
  const summary = capSummary(cleaned);
  const announce = intent
    ? t(intent.copyKey)
    : summary.length === 0
      ? t("chat.thinkingBusy")
      : t("chat.thinkingBusyWith", [summary]);
  return { announce, text: visibleText(input.elapsedMs, announce), hint };
}
