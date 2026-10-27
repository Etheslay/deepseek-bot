/**
 * Copy the D24 settings slice introduces by hand: the usage counters, the API
 * key status block and the whole backup vault. Modelled on `d22.ts` — the
 * generated domains are rewritten by the sweep, so new hand-written copy lives
 * in its own file and survives a re-run.
 */
import type { Message } from "../types.js";

export const d24Messages = {
  "d24.accessState": { zh: "接入状态", en: "Access status" },
  "d24.apiKeyStatus": { zh: "API Key 状态", en: "API key status" },
  "d24.backupFailed": { zh: "备份失败：{0}", en: "Backup failed: {0}" },
  "d24.backupList": { zh: "备份列表", en: "Backups" },
  "d24.backupMissing": {
    zh: "备份不存在或已被删除。",
    en: "That backup is missing or was deleted.",
  },
  "d24.backupNow": { zh: "立即备份", en: "Back up now" },
  "d24.backedUp": { zh: "已备份 {0}…", en: "Backed up {0}…" },
  "d24.createBackup": { zh: "创建备份", en: "Create backup" },
  "d24.dbVersion": { zh: "数据库版本", en: "Database version" },
  "d24.doneInGeneralAccess": {
    zh: "在「通用 → 接入」分区完成",
    en: "Handled under General → Access",
  },
  "d24.githubReleasesSource": { zh: "（GitHub Releases）", en: "(GitHub Releases)" },
  "d24.hardwareAccelNotBoolean": {
    zh: "硬件加速开关必须是布尔值",
    en: "The hardware-acceleration flag must be a boolean",
  },
  "d24.hwAccelOffRestart": {
    zh: "已关闭，重启应用后生效",
    en: "Off — restart the app to apply",
  },
  "d24.hwAccelOnDefault": { zh: "开启（默认）", en: "On (default)" },
  "d24.keyConfiguredWriteOnly": {
    zh: "已配置（只写不读）",
    en: "Configured (write-only)",
  },
  "d24.keyNotConfigured": { zh: "未配置", en: "Not configured" },
  "d24.messagesUnit": { zh: "条消息", en: "messages" },
  "d24.noBackupsYet": { zh: "还没有备份。", en: "No backups yet." },
  "d24.permissionsHeading": {
    zh: "工具授权（策略 / 已发授权 / 撤销）",
    en: "Tool authorisation (policy / issued grants / revoke)",
  },
  "d24.permissionsSection": { zh: "权限", en: "Permissions" },
  "d24.restore": { zh: "恢复", en: "Restore" },
  "d24.restoreConfirm": {
    zh: "恢复会用这份备份覆盖当前数据（当前数据先自动暂存，恢复后应用重载数据并可能要求重新输入 Key）。继续？",
    en: "Restoring overwrites the current data with this backup (the current data is staged first; the app reloads afterwards and may ask for your key again). Continue?",
  },
  "d24.restoreDoneReloading": {
    zh: "恢复完成，正在重载数据…",
    en: "Restored — reloading data…",
  },
  "d24.restoreFailed": { zh: "恢复失败：{0}", en: "Restore failed: {0}" },
  "d24.runsTitle": { zh: "运行记录", en: "Runs" },
  "d24.schedulesTitle": { zh: "定时任务", en: "Schedules" },
  "d24.savedRestartToApply": {
    zh: "已保存，重启应用后生效",
    en: "Saved — restart the app to apply",
  },
  "d24.saveAndTest": { zh: "保存与测试", en: "Save and test" },
  "d24.settingFailed": { zh: "设置失败：{0}", en: "Could not change the setting: {0}" },
  "d24.settingUnchanged": { zh: "设置未变化", en: "No change" },
  "d24.sessionsUnit": { zh: "个会话", en: "sessions" },
  "d24.sessionCountThisLaunch": {
    zh: "本次启动会话",
    en: "Sessions this launch",
  },
  "d24.switchAction": { zh: "切换", en: "Toggle" },
  "d24.vaultNote": {
    zh: "备份包含聊天与运行历史，请妥善保管。备份只含数据库，不含产物文件、版本快照与 API Key；恢复后需要重新输入 Key 才能继续对话。",
    en: "Backups hold chat and run history, so keep them safe. A backup covers the database only — not artifacts, version snapshots or the API key — and you will need to enter your key again after a restore.",
  },
  "d24.vaultSection": { zh: "备份与恢复", en: "Backup & restore" },
  "d24.working": { zh: "处理中…", en: "Working…" },
} as const satisfies Record<string, Message>;
