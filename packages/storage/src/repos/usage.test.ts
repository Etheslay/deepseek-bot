/**
 * Token usage accounting: one row per turn, three aggregations, and the
 * estimated flag that keeps a guessed count from passing as billed usage.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBot,
  earliestUsageAt,
  recordUsage,
  summarizeUsage,
  type OpenedDatabase,
  type UsageEventInput,
} from "../index.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "../test-support.js";

type Seeded = ReturnType<typeof seedProfileAndWorkspace>;

function setup(): { db: OpenedDatabase; profile: Seeded["profile"]; workspaceId: string } {
  const db = openTestDatabase(makeLayout(makeTempRoot()));
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  return { db, profile, workspaceId };
}

function row(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    id: randomUUID(),
    botId: null,
    model: "deepseek-chat",
    sessionId: "chat:bot",
    occurredAt: "2026-10-27T10:00:00.000Z",
    inputTokens: 100,
    outputTokens: 40,
    cachedInputTokens: 0,
    source: "harness",
    ...overrides,
  };
}

const dayOf = (iso: string): string => iso.slice(0, 10);

describe("recordUsage", () => {
  it("stores a turn and aggregates totals", () => {
    const { db } = setup();
    recordUsage(db, row());
    recordUsage(db, row({ inputTokens: 50, outputTokens: 10 }));

    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.totals).toEqual({
      inputTokens: 150,
      outputTokens: 50,
      cachedInputTokens: 0,
      turns: 2,
      estimated: false,
    });
  });

  it("flags the whole summary when any row was estimated", () => {
    const { db } = setup();
    recordUsage(db, row());
    recordUsage(db, row({ source: "estimated", model: "unknown" }));

    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.totals.estimated).toBe(true);
    expect(summary.totals.turns).toBe(2);
  });

  it("rejects negative counts, unknown sources and non-UTC timestamps", () => {
    const { db } = setup();
    expect(() => recordUsage(db, row({ inputTokens: -1 }))).toThrow(/non-negative/);
    expect(() => recordUsage(db, row({ source: "guess" as never }))).toThrow(/unknown/);
    expect(() => recordUsage(db, row({ occurredAt: "2026-10-27 10:00" }))).toThrow(/UTC/);
  });

  it("keeps cached input separate from plain input", () => {
    const { db } = setup();
    recordUsage(db, row({ cachedInputTokens: 900 }));
    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.totals.cachedInputTokens).toBe(900);
    expect(summary.totals.inputTokens).toBe(100);
  });
});

describe("summarizeUsage", () => {
  it("splits by model, ordered by tokens consumed", () => {
    const { db } = setup();
    recordUsage(db, row({ model: "small", inputTokens: 10, outputTokens: 5 }));
    recordUsage(db, row({ model: "large", inputTokens: 500, outputTokens: 200 }));

    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.byModel.map((entry) => entry.model)).toEqual(["large", "small"]);
    expect(summary.byModel[0]).toMatchObject({ inputTokens: 500, outputTokens: 200, turns: 1 });
  });

  it("names a model the harness did not report as unknown", () => {
    const { db } = setup();
    recordUsage(db, row({ model: null }));
    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.byModel[0]?.model).toBe("unknown");
  });

  it("buckets days with the caller's local-day function, ascending", () => {
    const { db } = setup();
    recordUsage(db, row({ occurredAt: "2026-10-27T10:00:00.000Z", inputTokens: 10, outputTokens: 4 }));
    recordUsage(db, row({ occurredAt: "2026-10-26T23:30:00.000Z", inputTokens: 30, outputTokens: 5 }));
    recordUsage(db, row({ occurredAt: "2026-10-27T23:59:00.000Z", inputTokens: 7, outputTokens: 2 }));

    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.byDay).toEqual([
      { day: "2026-10-26", inputTokens: 30, outputTokens: 5 },
      { day: "2026-10-27", inputTokens: 17, outputTokens: 6 },
    ]);
  });

  it("filters by bot and joins the bot name", () => {
    const { db, profile, workspaceId } = setup();
    const bot = makeBot(profile, workspaceId);
    createBot(db, { bot });
    recordUsage(db, row({ botId: bot.id, inputTokens: 100 }));
    recordUsage(db, row({ botId: null, inputTokens: 999 }));

    const summary = summarizeUsage(db, {
      sinceIso: "2026-10-01T00:00:00.000Z",
      botId: bot.id,
      dayOf,
    });
    expect(summary.totals.inputTokens).toBe(100);
    expect(summary.byBot).toHaveLength(1);
    expect(summary.byBot[0]).toMatchObject({ botId: bot.id, botName: bot.name, inputTokens: 100 });
  });

  it("excludes rows older than the window", () => {
    const { db } = setup();
    recordUsage(db, row({ occurredAt: "2026-09-01T00:00:00.000Z", inputTokens: 5 }));
    recordUsage(db, row({ occurredAt: "2026-10-27T00:00:00.000Z", inputTokens: 6 }));

    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.totals.inputTokens).toBe(6);
  });

  it("returns empty aggregates for an empty database", () => {
    const { db } = setup();
    const summary = summarizeUsage(db, { sinceIso: "2026-10-01T00:00:00.000Z", dayOf });
    expect(summary.totals.turns).toBe(0);
    expect(summary.byModel).toEqual([]);
    expect(summary.byDay).toEqual([]);
    expect(summary.byBot).toEqual([]);
  });
});

describe("earliestUsageAt", () => {
  it("reports the oldest timestamp so the page can offer an all-time window", () => {
    const { db } = setup();
    expect(earliestUsageAt(db)).toBeNull();
    recordUsage(db, row({ occurredAt: "2026-10-27T10:00:00.000Z" }));
    recordUsage(db, row({ occurredAt: "2026-10-01T10:00:00.000Z" }));
    expect(earliestUsageAt(db)).toBe("2026-10-01T10:00:00.000Z");
  });
});
