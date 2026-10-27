/**
 * Screen-capture settings copy (D21 desktop).
 *
 * Hand-authored, like `d22.ts`. The string sweep generates the other domain
 * files and does not own this one. Keys stay stable data; only the values
 * are translated.
 */
import type { Message } from "../types.js";

export const screenMessages = {
  "screen.botLabel": { zh: "采集目标", en: "Capture target" },
  "screen.noBots": { zh: "还没有可选择的 bot", en: "No bots to choose" },
  "screen.loadFailed": { zh: "屏幕设置读取失败", en: "Failed to load screen settings" },
  "screen.enableHint": {
    zh: "默认关闭。打开后每次截图或 OCR 都要单独批准，只有「仅本次」，不能始终允许，也不能给本会话或永久授权。缩略图和识别文本只留在这台电脑上，不写入聊天。",
    en: "Off by default. Each screenshot or OCR asks for its own approval, and only for this time. Always allow, this session, and permanent are not available. The thumbnail and recognized text stay on this computer and are not written into the chat.",
  },
  "screen.enabledNotice": {
    zh: "已保存：屏幕与窗口感知 → 每次询问",
    en: "Saved: screen and window awareness → Ask every time",
  },
  "screen.disabledNotice": {
    zh: "已保存：屏幕与窗口感知 → 从不允许",
    en: "Saved: screen and window awareness → Never allow",
  },
  "screen.unsupported": {
    zh: "这台电脑不能采集窗口。开关会保留，但刷新、截图和 OCR 不可用。",
    en: "This computer cannot capture windows. The switch is kept, but refresh, screenshot, and OCR are unavailable.",
  },
  "screen.windowLabel": { zh: "目标窗口", en: "Target window" },
  "screen.noWindow": { zh: "未选择", en: "None selected" },
  "screen.refreshWindows": { zh: "刷新窗口", en: "Refresh windows" },
  "screen.refreshing": { zh: "正在刷新…", en: "Refreshing…" },
  "screen.windowsRefreshed": { zh: "已刷新窗口列表", en: "Window list refreshed" },
  "screen.windowSelected": { zh: "已选择窗口", en: "Window selected" },
  "screen.windowCleared": { zh: "已清除目标窗口", en: "Target window cleared" },
  "screen.actionsLabel": { zh: "单次采集", en: "Single capture" },
  "screen.captureImage": { zh: "截图", en: "Screenshot" },
  "screen.captureOcr": { zh: "截图并识别", en: "Screenshot and OCR" },
  "screen.modeImage": { zh: "截图", en: "Screenshot" },
  "screen.modeOcr": { zh: "截图并识别", en: "Screenshot and OCR" },
  "screen.approvalLoadFailed": {
    zh: "审批请求读取失败",
    en: "Failed to load the approval request",
  },
  "screen.approvedOnce": { zh: "已允许本次采集", en: "This capture was approved" },
  "screen.resultsTitle": { zh: "本机结果", en: "Local results" },
  "screen.noResults": { zh: "还没有结果", en: "No results yet" },
  "screen.resultSize": { zh: "{0} × {1}", en: "{0} × {1}" },
  "screen.review": { zh: "查看", en: "Review" },
  "screen.delete": { zh: "删除", en: "Delete" },
  "screen.confirmDelete": { zh: "确认删除", en: "Confirm delete" },
  "screen.keep": { zh: "保留", en: "Keep" },
  "screen.deleted": { zh: "已删除本机结果", en: "Local result deleted" },
  "screen.previewLabel": { zh: "本机预览", en: "Local preview" },
  "screen.ocrTextLabel": { zh: "识别文本", en: "Recognized text" },
  "screen.noOcrText": { zh: "这次没有识别文本", en: "This result has no recognized text" },
  "screen.previewInvalid": { zh: "预览无法显示", en: "The preview cannot be shown" },
  "screen.captured": {
    zh: "采集已完成，只在本机预览",
    en: "Capture finished. Preview stays on this computer",
  },
  "screen.cancelled": { zh: "已取消", en: "Cancelled" },
  "screen.nothingToCancel": { zh: "没有正在进行的采集", en: "No capture is in progress" },
  "screen.unavailable": { zh: "当前不能采集窗口", en: "Window capture is unavailable" },
  "screen.rateLimited": { zh: "已有一次采集在进行", en: "A capture is already in progress" },
  "screen.notApproved": { zh: "这次采集没有被批准", en: "This capture was not approved" },
  "screen.targetChanged": {
    zh: "目标窗口已变化，这次采集已取消",
    en: "The target window changed, so this capture was cancelled",
  },
  "screen.needTarget": { zh: "先选择一个窗口", en: "Select a window first" },
  "screen.resultsFull": {
    zh: "结果已满，先删除一条再采集",
    en: "The result list is full. Delete one before capturing again",
  },
  "screen.failed": { zh: "操作失败", en: "The action failed" },
} satisfies Record<string, Message>;
