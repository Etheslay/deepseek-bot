/**
 * Chat automation notice copy (D20').
 *
 * Hand-authored, like `event-rules.ts`. The bar reuses the state words from
 * `event-rules.ts` (`stateEnabled`/`stateDisabled`/`stateReview`) and only
 * owns its own summary, row and reason-mapping copy. Host record reasons are
 * stable English constants; the `noticeReason*` keys are display mappings —
 * the stored data is never rewritten.
 */
import type { Message } from "../types.js";

export const automationNoticeMessages = {
  "eventrule.noticeTitle": { zh: "自动化动态", en: "Automation activity" },
  "eventrule.noticeSummaryMissed": { zh: "错过 {0}", en: "{0} missed" },
  "eventrule.noticeSummaryPending": { zh: "待评审 {0}", en: "{0} pending review" },
  "eventrule.noticeSummaryStates": { zh: "状态变更 {0}", en: "{0} status changes" },
  "eventrule.noticePendingLine": {
    zh: "{0} 条匹配事件待评审",
    en: "{0} matched event(s) waiting for review",
  },
  "eventrule.noticeOpenSettings": { zh: "去设置处理", en: "Open settings" },
  "eventrule.noticeRecordSkipped": { zh: "已跳过", en: "Skipped" },
  "eventrule.noticeRecordDuplicate": { zh: "重复已去重", en: "Duplicate deduplicated" },
  "eventrule.noticeStateTo": { zh: "{0} → {1}", en: "{0} → {1}" },
  "eventrule.noticeReasonRuleDisabled": { zh: "规则已停用", en: "rule disabled" },
  "eventrule.noticeReasonReviewDenied": { zh: "评审已拒绝", en: "review denied" },
  "eventrule.noticeReasonDuplicate": { zh: "重复事件", en: "duplicate event" },
  "eventrule.noticeReasonSourceRunAuto": {
    zh: "来源运行由事件规则启动",
    en: "source run was started by an event rule",
  },
  "eventrule.noticeReasonTriggerFailed": { zh: "触发失败：{0}", en: "trigger failed: {0}" },
} satisfies Record<string, Message>;
