import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  filterSearch,
  SEARCH_KIND_LABELS,
} from "../../src/renderer/src/features/search/search-core.js";

const bots = [
  { key: 1, name: "note-summarizer", group: "写作组" },
  { key: 2, name: "research-bot", group: "研究组" },
];
const messages = [
  { botKey: 1, botName: "note-summarizer", text: "把这份报告总结成三段", time: 100 },
  { botKey: 2, botName: "research-bot", text: "搜索最新的 Electron 安全公告", time: 200 },
];
const actions = [
  { id: "a-settings", kind: "action", title: "打开设置", action: "settings" },
] as const;

describe("global search core", () => {
  const index = buildSearchIndex({
    bots,
    messages,
    actions: [...actions],
  });

  it("indexes bots, messages and actions with stable ids", () => {
    expect(index.filter((item) => item.kind === "bot")).toHaveLength(2);
    expect(index.filter((item) => item.kind === "message")).toHaveLength(2);
    expect(index.filter((item) => item.kind === "action")).toHaveLength(1);
    expect(index.every((item) => item.id.length > 0)).toBe(true);
  });

  it("matches case-insensitively across title and subtitle", () => {
    const hits = filterSearch(index, "RESEARCH");
    expect(hits.some((item) => item.kind === "bot")).toBe(true);
    const byGroup = filterSearch(index, "写作组");
    expect(byGroup.some((item) => item.kind === "bot" && item.botKey === 1)).toBe(true);
  });

  it("matches message content and keeps the bot link", () => {
    const hits = filterSearch(index, "总结");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.botKey).toBe(1);
  });

  it("truncates long message excerpts", () => {
    const long = buildSearchIndex(
      { bots: [], messages: [{ botKey: 1, botName: "b", text: "长".repeat(120), time: 1 }], actions: [] },
    );
    expect(long[0]?.title.length).toBeLessThanOrEqual(61);
    expect(long[0]?.title.endsWith("…")).toBe(true);
  });

  it("returns empty for blank queries", () => {
    expect(filterSearch(index, "   ")).toEqual([]);
  });

  it("labels all three kinds", () => {
    expect(SEARCH_KIND_LABELS.bot).toBeTruthy();
    expect(SEARCH_KIND_LABELS.message).toBeTruthy();
    expect(SEARCH_KIND_LABELS.action).toBeTruthy();
  });
});
