/**
 * usage.summary windowing: the page asks for a rolling number of days and gets
 * local-day buckets plus per-model/per-bot aggregates.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDataLayout, openDatabase, recordUsage, type OpenedDatabase } from "@deepseek-bot/storage";
import { describe, expect, it } from "vitest";
import { DEFAULT_USAGE_DAYS, buildUsageSummary, localDay } from "./usage-summary.js";

function setup(): { db: OpenedDatabase; root: string } {
  const root = mkdtempSync(join(tmpdir(), "dsb-usage-"));
  const db = openDatabase(ensureDataLayout(root).dbFile);
  return { db, root };
}

function addTurn(db: OpenedDatabase, occurredAt: string, input: number, output: number, model = "deepseek-chat") {
  recordUsage(db, {
    id: randomUUID(),
    botId: null,
    model,
    sessionId: null,
    occurredAt,
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: 0,
    source: "harness",
  });
}

describe("localDay", () => {
  it("formats the local calendar day of a UTC timestamp", () => {
    const noon = new Date(2026, 9, 27, 12, 0, 0);
    expect(localDay(noon.toISOString())).toBe("2026-10-27");
  });
});

describe("buildUsageSummary", () => {
  it("defaults to the 30 day window", () => {
    const { db } = setup();
    const now = new Date(2026, 9, 27, 12, 0, 0);
    const summary = buildUsageSummary(db, { now: () => now });
    expect(summary.windowDays).toBe(DEFAULT_USAGE_DAYS);
  });

  it("excludes turns older than the window and keeps newer ones", () => {
    const { db } = setup();
    const now = new Date(2026, 9, 27, 12, 0, 0);
    addTurn(db, new Date(2026, 9, 26, 12, 0, 0).toISOString(), 10, 2);
    addTurn(db, new Date(2026, 7, 1, 12, 0, 0).toISOString(), 999, 999);

    const week = buildUsageSummary(db, { days: 7, now: () => now });
    expect(week.windowDays).toBe(7);
    expect(week.totals.inputTokens).toBe(10);
    expect(week.byDay).toHaveLength(1);
  });

  it("clamps an out-of-range window instead of trusting the renderer", () => {
    const { db } = setup();
    const now = () => new Date(2026, 9, 27, 12, 0, 0);
    expect(buildUsageSummary(db, { days: 9999, now }).windowDays).toBe(365);
    expect(buildUsageSummary(db, { days: 0, now }).windowDays).toBe(1);
  });

  it("aggregates by model and by bot for the page tables", () => {
    const { db } = setup();
    const now = new Date(2026, 9, 27, 12, 0, 0);
    addTurn(db, new Date(2026, 9, 27, 9, 0, 0).toISOString(), 300, 100, "deepseek-reasoner");
    addTurn(db, new Date(2026, 9, 27, 10, 0, 0).toISOString(), 30, 10, "deepseek-chat");

    const summary = buildUsageSummary(db, { now: () => now });
    expect(summary.totals).toMatchObject({ inputTokens: 330, outputTokens: 110, turns: 2, estimated: false });
    expect(summary.byModel[0]).toMatchObject({ model: "deepseek-reasoner", inputTokens: 300 });
    expect(summary.byBot).toHaveLength(1);
    expect(summary.byBot[0]?.botId).toBeNull();
  });
});
