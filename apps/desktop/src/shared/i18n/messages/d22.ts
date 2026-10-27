/**
 * Catalogue entries introduced by D22 itself: the bilingual kernel, the per-bot
 * tray, system notifications and the Chrome bookmark import.
 *
 * Hand-authored on purpose. The string sweep generates the other domain files
 * and never touches this one (`d22` is a reserved domain in gen.mjs).
 */
import type { Message } from "../types.js";

export const d22Messages = {
  "d22.language": { zh: "语言", en: "Language" },
  "d22.languageLabel": { zh: "界面语言", en: "Interface language" },
  "d22.languageSystem": { zh: "跟随系统", en: "System default" },
  "d22.languageZh": { zh: "简体中文", en: "简体中文" },
  "d22.languageEn": { zh: "English", en: "English" },
  "d22.defaultAccountName": { zh: "本地用户", en: "Local user" },
  "d22.listSeparator": { zh: "、", en: ", " },
  "d22.newVersionFallback": { zh: "新版本", en: "the new version" },
  "d22.parenthesized": { zh: "（{0}）", en: "({0})" },
  "d22.runFinishedAt": { zh: "{0}（{1}）", en: "{0} · {1}" },

  "d22.trayShow": { zh: "显示窗口", en: "Show window" },
  "d22.trayHide": { zh: "隐藏窗口", en: "Hide window" },
  "d22.traySettings": { zh: "打开设置", en: "Open settings" },
  "d22.trayQuit": { zh: "退出 DeepSeek Bot", en: "Quit DeepSeek Bot" },
  "d22.trayNoBots": { zh: "还没有 Bot", en: "No bots yet" },
  "d22.trayBotsHeader": { zh: "{0} 个 Bot", en: { one: "{0} bot", other: "{0} bots" } },
  "d22.trayUnread": { zh: "{0} 条未读", en: { one: "{0} unread", other: "{0} unread" } },
  "d22.trayRunning": { zh: "正在回答", en: "Answering" },
  "d22.trayWaitingApproval": { zh: "等待你的审批", en: "Waiting for your approval" },
  "d22.trayIdle": { zh: "空闲", en: "Idle" },

  "d22.notifySection": { zh: "通知", en: "Notifications" },
  "d22.notifyEnabled": { zh: "系统通知", en: "System notifications" },
  "d22.notifyEnabledHint": {
    zh: "Bot 完成回复、需要审批或错过定时任务时，在系统通知中心提醒",
    en: "Notify in the system notification centre when a bot replies, needs approval or a schedule is missed",
  },
  "d22.notifyOnlyUnfocused": { zh: "仅窗口不在前台时提醒", en: "Only when the window is not focused" },
  "d22.notifyPerBot": { zh: "按 Bot 静音", en: "Mute per bot" },
  "d22.notifyMute": { zh: "静音", en: "Mute" },
  "d22.notifyUnmute": { zh: "取消静音", en: "Unmute" },
  "d22.notifyNoBots": { zh: "创建 Bot 后可单独静音", en: "Create a bot to mute it individually" },
  "d22.notifyTest": { zh: "发送测试通知", en: "Send test notification" },
  "d22.notifyTestTitle": { zh: "DeepSeek Bot", en: "DeepSeek Bot" },
  "d22.notifyTestBody": { zh: "这是一条测试通知", en: "This is a test notification" },
  "d22.notifyReplyTitle": { zh: "{0} 已回复", en: "{0} replied" },
  "d22.notifyApprovalTitle": { zh: "{0} 等待审批", en: "{0} needs approval" },
  "d22.notifyApprovalBody": {
    zh: "有操作需要你确认后才会执行",
    en: "An action is waiting for your decision",
  },
  "d22.notifyMissedTitle": { zh: "定时任务已错过", en: "Scheduled run was missed" },
  "d22.notifyMissedBody": {
    zh: "{0} 个时刻未执行，已在聊天内标记为错过",
    en: {
      one: "{0} occurrence was skipped and marked as missed in chat",
      other: "{0} occurrences were skipped and marked as missed in chat",
    },
  },
  "d22.notifyUnsupported": { zh: "系统通知不可用", en: "System notifications are unavailable" },
  "d22.notifyUnsupportedHint": {
    zh: "当前系统未提供通知通道；提醒仍会显示在应用内",
    en: "This system has no notification channel; in-app reminders still work",
  },

  "d22.chromeSection": { zh: "Chrome 数据导入", en: "Chrome data import" },
  "d22.chromeScan": { zh: "扫描 Chrome 配置", en: "Scan Chrome profiles" },
  "d22.chromeScanning": { zh: "扫描中…", en: "Scanning…" },
  "d22.chromeNoneFound": { zh: "未找到 Chrome 书签数据", en: "No Chrome bookmark data found" },
  "d22.chromeProfile": { zh: "配置", en: "Profile" },
  "d22.chromeBookmarks": { zh: "{0} 个书签", en: { one: "{0} bookmark", other: "{0} bookmarks" } },
  "d22.chromePreview": { zh: "预览", en: "Preview" },
  "d22.chromeImport": { zh: "导入", en: "Import" },
  "d22.chromeImporting": { zh: "导入中…", en: "Importing…" },
  "d22.chromeImported": {
    zh: "已导入 {0} 个书签",
    en: { one: "Imported {0} bookmark", other: "Imported {0} bookmarks" },
  },
  "d22.chromeExport": { zh: "导出为 Markdown", en: "Export as Markdown" },
  "d22.chromeExported": { zh: "已导出到 {0}", en: "Exported to {0}" },
  "d22.chromeClear": { zh: "删除已导入数据", en: "Delete imported data" },
  "d22.chromeEmpty": { zh: "尚未导入 Chrome 数据", en: "No Chrome data imported yet" },
  "d22.chromePrivacy": {
    zh: "只读取书签文件，不读取 Cookie、密码、支付信息与浏览历史；导入结果保存在本机数据目录",
    en: "Only bookmark files are read — never cookies, passwords, payment data or browsing history. Imports stay in this machine's data directory",
  },
  "d22.chromeImportedAt": { zh: "导入于 {0}", en: "Imported {0}" },
  "d22.chromeFailed": { zh: "导入失败：{0}", en: "Import failed: {0}" },
  "d22.notifyTestHint": {
    zh: "用来确认系统通知通道是否可用",
    en: "Checks whether this system can raise notifications",
  },
  "d22.notifyTestSent": { zh: "已发送", en: "Sent" },
  "d22.notifyTestSkipped": { zh: "被去重或策略拦截", en: "Deduplicated or blocked" },
  "d22.chromeNeedsShell": {
    zh: "需要桌面壳（打包版可用）",
    en: "Requires the desktop shell (available in the packaged app)",
  },
  "d22.chromeSource": { zh: "数据来源", en: "Source" },
  "d22.chromeNotScanned": { zh: "尚未扫描", en: "Not scanned yet" },
  "d22.chromeProfiles": { zh: "Chrome 配置", en: "Chrome profiles" },
  "d22.chromeImportedSection": { zh: "已导入", en: "Imported" },
} satisfies Record<string, Message>;
