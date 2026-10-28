/* Hand-authored: token usage page (usage.summary). Edit here, not in the sweep. */
import type { Message } from "../types.js";

export const usageMessages = {
  "usage.allBots": { zh: "全部 bot", en: "All bots" },
  "usage.byModel": { zh: "按模型", en: "By model" },
  "usage.daily": { zh: "每日用量", en: "Daily usage" },
  "usage.dailyHint": { zh: "输入与输出两条线", en: "Input and output" },
  "usage.empty": {
    zh: "还没有用量记录。发一次消息就会开始统计。",
    en: "No usage yet. Send a message and accounting starts.",
  },
  "usage.estimated": { zh: "含估算值", en: "Includes estimates" },
  "usage.estimatedHint": {
    zh: "部分回合上游未上报用量，按字符数估算，不是计费口径。",
    en: "Some turns reported no usage; those counts are estimated from text length, not billed usage.",
  },
  "usage.input": { zh: "输入", en: "Input" },
  "usage.loadFailed": { zh: "用量读取失败", en: "Could not load usage" },
  "usage.modelColumn": { zh: "模型", en: "Model" },
  "usage.output": { zh: "输出", en: "Output" },
  "usage.share": { zh: "占比", en: "Share" },
  "usage.thisBot": { zh: "当前 bot", en: "This bot" },
  "usage.tokens": { zh: "tokens", en: "tokens" },
  "usage.totalLine": { zh: "总计", en: "Total" },
  "usage.turns": { zh: "回合", en: "Turns" },
} satisfies Record<string, Message>;
