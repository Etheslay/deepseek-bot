/**
 * D20': automation status notices in the owner bot's chat.
 *
 * When a local event rule starts a run, skips an event, waits for review, or
 * changes enable/review state (or is deleted), the Host writes one
 * meta-tagged chat row into that bot's chat. The text is authored in the live
 * UI language at write time and replays into model context exactly like the
 * manager-orchestration notices (task-dispatcher). The renderer owns the
 * notice-bar styling; rows with unknown meta kinds are skipped by the thread
 * hydration, so older builds simply do not show them.
 */
import type { ChatMessageMeta } from "@deepseek-bot/contracts";
import { appendChatMessage, type OpenedDatabase } from "@deepseek-bot/storage";
import { chatSessionIdFor } from "./chat.js";
import type { UiLocale } from "./host.js";

export type AutomationOutcome =
  | "started"
  | "skipped"
  | "review"
  | "enabled"
  | "disabled"
  | "deleted";

export interface AutomationNoticeInput {
  readonly ruleId: string;
  readonly botId: string;
  readonly ruleName: string;
  readonly outcome: AutomationOutcome;
  readonly runId: string | null;
  readonly reason: string | undefined;
}

export function automationNoticeText(notice: AutomationNoticeInput, locale: UiLocale): string {
  if (locale === "en") {
    switch (notice.outcome) {
      case "started":
        return `[Automation] Rule "${notice.ruleName}" matched an event and started a run.`;
      case "skipped":
        return `[Automation] Rule "${notice.ruleName}" event was skipped: ${notice.reason ?? "unknown reason"}.`;
      case "review":
        return `[Automation] Rule "${notice.ruleName}" matched an event and is waiting for review.`;
      case "enabled":
        return `[Automation] Rule "${notice.ruleName}" is now enabled.`;
      case "disabled":
        return `[Automation] Rule "${notice.ruleName}" is now disabled.`;
      case "deleted":
        return `[Automation] Rule "${notice.ruleName}" has been deleted.`;
    }
  }
  switch (notice.outcome) {
    case "started":
      return `【自动化】规则「${notice.ruleName}」命中事件，已启动运行。`;
    case "skipped":
      return `【自动化】规则「${notice.ruleName}」命中事件已跳过：${notice.reason ?? "未知原因"}。`;
    case "review":
      return `【自动化】规则「${notice.ruleName}」命中事件，等待评审。`;
    case "enabled":
      return `【自动化】规则「${notice.ruleName}」已启用。`;
    case "disabled":
      return `【自动化】规则「${notice.ruleName}」已停用。`;
    case "deleted":
      return `【自动化】规则「${notice.ruleName}」已删除。`;
  }
}

/**
 * Best-effort: a notice write must never break the scan, the run it reports,
 * or the settings change that triggered it. Failures are swallowed — the
 * durable state/history records remain the source of truth.
 */
export function writeAutomationNotice(
  db: OpenedDatabase,
  notice: AutomationNoticeInput,
  locale: UiLocale,
): void {
  try {
    const meta: ChatMessageMeta = {
      kind: "automation",
      ruleId: notice.ruleId,
      outcome: notice.outcome,
      runId: notice.runId,
      ...(notice.reason !== undefined ? { reason: notice.reason } : {}),
    };
    appendChatMessage(db, {
      botId: notice.botId,
      sessionId: chatSessionIdFor(notice.botId),
      role: "assistant",
      text: automationNoticeText(notice, locale),
      meta,
    });
  } catch {
    /* best-effort by contract */
  }
}
