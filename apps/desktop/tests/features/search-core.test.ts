import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  dedupeHostItems,
  filterSearch,
  remoteHitsToItems,
  searchKindLabels,
  type SearchItem,
} from "../../src/renderer/src/features/search/search-core.js";
import type { GlobalSearchHitView } from "../../src/renderer/src/services/desktop-service.js";

const bots = [
  { key: 1, id: "11111111-1111-4111-8111-111111111111", name: "note-summarizer", group: "写作组" },
  { key: 2, id: "22222222-2222-4222-8222-222222222222", name: "research-bot", group: "研究组" },
];
const messages = [
  {
    botKey: 1,
    botId: "11111111-1111-4111-8111-111111111111",
    botName: "note-summarizer",
    text: "把这份报告总结成三段",
    time: 100,
  },
  {
    botKey: 2,
    botId: "22222222-2222-4222-8222-222222222222",
    botName: "research-bot",
    text: "搜索最新的 Electron 安全公告",
    time: 200,
  },
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

  it("carries the bot uuid on local bot and message items", () => {
    const local = index.find((item) => item.kind === "bot" && item.botKey === 1);
    expect(local?.botId).toBe("11111111-1111-4111-8111-111111111111");
    const message = index.find((item) => item.kind === "message" && item.botKey === 2);
    expect(message?.botId).toBe("22222222-2222-4222-8222-222222222222");
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
      {
        bots: [],
        messages: [
          { botKey: 1, botId: "11111111-1111-4111-8111-111111111111", botName: "b", text: "长".repeat(120), time: 1 },
        ],
        actions: [],
      },
    );
    expect(long[0]?.title.length).toBeLessThanOrEqual(61);
    expect(long[0]?.title.endsWith("…")).toBe(true);
  });

  it("returns empty for blank queries", () => {
    expect(filterSearch(index, "   ")).toEqual([]);
  });

  it("labels every kind including the host-only kinds", () => {
    const labels = searchKindLabels();
    expect(labels.bot).toBeTruthy();
    expect(labels.message).toBeTruthy();
    expect(labels.action).toBeTruthy();
    expect(labels.workflow).toBeTruthy();
    expect(labels.artifact).toBeTruthy();
  });
});

describe("remoteHitsToItems (D25 second half)", () => {
  it("maps all four host kinds onto search items", () => {
    const hits: GlobalSearchHitView[] = [
      {
        kind: "bot",
        id: "11111111-1111-4111-8111-111111111111",
        botId: "11111111-1111-4111-8111-111111111111",
        title: "note-summarizer",
        snippet: null,
        at: "2026-10-28T00:00:00.000Z",
      },
      {
        kind: "workflow",
        id: "33333333-3333-4333-8333-333333333333",
        botId: null,
        title: "周报流水线",
        snippet: null,
        at: null,
      },
      {
        kind: "message",
        id: "44444444-4444-4444-8444-444444444444",
        botId: "22222222-2222-4222-8222-222222222222",
        title: "research-bot",
        snippet: "…安全公告的要点…",
        at: "2026-10-27T00:00:00.000Z",
      },
      {
        kind: "artifact",
        id: "55555555-5555-4555-8555-555555555555",
        botId: "22222222-2222-4222-8222-222222222222",
        title: "notes/weekly.md",
        snippet: null,
        at: "2026-10-26T00:00:00.000Z",
      },
    ];
    const items = remoteHitsToItems(hits);
    expect(items.map((item) => item.kind)).toEqual(["bot", "workflow", "message", "artifact"]);
    expect(items[1]?.botId).toBeUndefined();
    expect(items[2]?.subtitle).toBe("…安全公告的要点…");
    expect(items[2]?.botId).toBe("22222222-2222-4222-8222-222222222222");
    expect(items[3]?.path).toBe("notes/weekly.md");
    expect(items[3]?.title).toBe("notes/weekly.md");
    expect(items.every((item) => item.id.startsWith("host-"))).toBe(true);
  });
});

describe("dedupeHostItems", () => {
  const localBots: SearchItem[] = [
    { id: "bot-1", kind: "bot", title: "note-summarizer", botKey: 1, botId: "11111111-1111-4111-8111-111111111111" },
  ];

  it("drops host bot hits that duplicate a local bot by uuid", () => {
    const host: SearchItem[] = [
      { id: "host-bot-1", kind: "bot", title: "note-summarizer", botId: "11111111-1111-4111-8111-111111111111" },
      { id: "host-message-1", kind: "message", title: "research-bot", subtitle: "旧会话内容", botId: "22222222-2222-4222-8222-222222222222" },
    ];
    const kept = dedupeHostItems(localBots, host);
    expect(kept.map((item) => item.id)).toEqual(["host-message-1"]);
  });

  it("keeps host bot hits for bots the local index does not show", () => {
    const host: SearchItem[] = [
      { id: "host-bot-2", kind: "bot", title: "archived-bot", botId: "66666666-6666-4666-8666-666666666666" },
    ];
    expect(dedupeHostItems(localBots, host)).toEqual(host);
  });
});
