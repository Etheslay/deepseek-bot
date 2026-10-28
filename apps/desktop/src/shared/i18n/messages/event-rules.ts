/**
 * Per-bot event-rule settings copy (D20 desktop review/status).
 *
 * Hand-authored, like `screen.ts`. Keys stay stable; only the values are
 * translated. This panel does not own chat-banner copy.
 */
import type { Message } from "../types.js";

export const eventRuleMessages = {
  "eventrule.sectionTitle": { zh: "本地事件规则", en: "Local event rules" },
  "eventrule.hint": {
    zh: "只显示当前选中的一个 bot。批准一条待评审会启动一次运行；拒绝会记下一次跳过，不会启动。",
    en: "Shows the one selected bot. Approving a pending item starts one run. Denying it records one skip and starts nothing.",
  },
  "eventrule.botLabel": { zh: "机器人", en: "Bot" },
  "eventrule.noBots": { zh: "还没有可选择的 bot", en: "No bots to choose" },
  "eventrule.loading": { zh: "正在读取事件规则", en: "Loading event rules" },
  "eventrule.loadFailed": { zh: "事件规则读取失败", en: "Failed to load event rules" },
  "eventrule.rulesTitle": { zh: "当前状态", en: "Current state" },
  "eventrule.noRules": { zh: "这个 bot 还没有事件规则", en: "This bot has no event rules" },
  "eventrule.ruleSummary": { zh: "{0}（{1}）", en: "{0} · {1}" },
  "eventrule.stateEnabled": { zh: "已启用", en: "Enabled" },
  "eventrule.stateDisabled": { zh: "已停用", en: "Disabled" },
  "eventrule.stateReview": { zh: "评审", en: "Review" },
  "eventrule.stateWithReview": { zh: "{0} · 评审", en: "{0} · Review" },
  "eventrule.reviewTitle": { zh: "待评审", en: "Pending review" },
  "eventrule.reviewEmpty": { zh: "没有待评审项", en: "Nothing is waiting for review" },
  "eventrule.reviewSummary": { zh: "{0} · {1}", en: "{0} · {1}" },
  "eventrule.unknownRule": { zh: "未知规则", en: "Unknown rule" },
  "eventrule.approve": { zh: "批准", en: "Approve" },
  "eventrule.deny": { zh: "拒绝", en: "Deny" },
  "eventrule.approveItem": { zh: "批准 {0}", en: "Approve {0}" },
  "eventrule.denyItem": { zh: "拒绝 {0}", en: "Deny {0}" },
  "eventrule.approved": { zh: "已批准，并启动一次运行", en: "Approved. One run was started" },
  "eventrule.denied": { zh: "已拒绝，并记下一次跳过", en: "Denied. One skip was recorded" },
  "eventrule.reviewFailed": { zh: "评审操作失败", en: "The review action failed" },
  "eventrule.historyTitle": { zh: "状态记录", en: "State history" },
  "eventrule.historyEmpty": { zh: "还没有状态记录", en: "No state history yet" },
} satisfies Record<string, Message>;
