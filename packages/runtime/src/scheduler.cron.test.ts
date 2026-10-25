import { describe, expect, it } from "vitest";
import { nextCronOccurrence, parseCronExpression } from "./scheduler/cron.js";

function next(
  expression: string,
  timezone: string,
  afterIso: string,
): string | null {
  const occurrence = nextCronOccurrence(
    parseCronExpression(expression),
    timezone,
    new Date(afterIso),
  );
  return occurrence?.toISOString() ?? null;
}

describe("cron parsing", () => {
  it("accepts the documented grammar", () => {
    const cron = parseCronExpression("*/15 8-11 1,15 * 1-5");
    expect(cron.minutes.has(0)).toBe(true);
    expect(cron.minutes.has(45)).toBe(true);
    expect(cron.minutes.has(50)).toBe(false);
    expect(cron.hours.has(8)).toBe(true);
    expect(cron.hours.has(11)).toBe(true);
    expect(cron.hours.has(12)).toBe(false);
    expect(cron.daysOfMonth.has(1)).toBe(true);
    expect(cron.daysOfMonth.has(15)).toBe(true);
    expect(cron.daysOfWeek.has(1)).toBe(true);
    expect(cron.domRestricted).toBe(true);
    expect(cron.dowRestricted).toBe(true);
  });

  it("normalizes Sunday as both 0 and 7", () => {
    expect(parseCronExpression("0 0 * * 7").daysOfWeek.has(0)).toBe(true);
    expect(parseCronExpression("0 0 * * 0").daysOfWeek.has(0)).toBe(true);
    expect(parseCronExpression("0 0 * * 7").daysOfWeek.has(7)).toBe(false);
  });

  it("rejects malformed expressions with field details", () => {
    for (const expression of ["* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "a * * * *", "*/0 * * * *", "1,,2 * * * *", "5-1 * * * *"]) {
      expect(() => parseCronExpression(expression), expression).toThrow();
    }
  });
});

describe("next occurrence in fixed-offset zones", () => {
  it("computes wall-clock times in Asia/Shanghai (UTC+8)", () => {
    expect(next("30 8 * * *", "Asia/Shanghai", "2026-10-25T00:00:00.000Z")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    // 08:30 local already passed that day: the next day's occurrence.
    expect(next("30 8 * * *", "Asia/Shanghai", "2026-10-25T00:31:00.000Z")).toBe(
      "2026-10-26T00:30:00.000Z",
    );
  });

  it("handles half-hour offsets in Asia/Kolkata (UTC+5:30)", () => {
    expect(next("0 9 * * *", "Asia/Kolkata", "2026-01-01T00:00:00.000Z")).toBe(
      "2026-01-01T03:30:00.000Z",
    );
  });

  it("is strictly after the reference instant, never equal", () => {
    // * * * * * one second into a minute: next is the following minute.
    expect(next("* * * * *", "UTC", "2026-10-25T12:00:01.000Z")).toBe(
      "2026-10-25T12:01:00.000Z",
    );
    expect(next("* * * * *", "UTC", "2026-10-25T12:00:00.000Z")).toBe(
      "2026-10-25T12:01:00.000Z",
    );
  });

  it("returns null for calendars that never match", () => {
    expect(next("0 0 30 2 *", "UTC", "2026-01-01T00:00:00.000Z")).toBeNull();
  });

  it("finds leap days", () => {
    expect(next("0 0 29 2 *", "UTC", "2026-01-01T00:00:00.000Z")).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("rejects unknown zones", () => {
    expect(() =>
      nextCronOccurrence(parseCronExpression("* * * * *"), "Mars/Olympus", new Date()),
    ).toThrow(/IANA/);
  });
});

describe("vixie DOM/DOW restriction semantics", () => {
  // November 2026: Sundays 1/8/15/22/29, Fridays 6/13/20/27; the 13th is a
  // Friday (both restrictions match the same day exactly once).
  it("matches OR of restricted day-of-month and day-of-week", () => {
    expect(next("0 0 13 * 5", "UTC", "2026-11-01T00:00:00.000Z")).toBe(
      "2026-11-06T00:00:00.000Z",
    );
    expect(next("0 0 13 * 5", "UTC", "2026-11-06T00:00:01.000Z")).toBe(
      "2026-11-13T00:00:00.000Z",
    );
    // The 13th matches both fields but occurs once, not twice.
    expect(next("0 0 13 * 5", "UTC", "2026-11-13T00:00:01.000Z")).toBe(
      "2026-11-20T00:00:00.000Z",
    );
  });

  it("matches only day-of-month when day-of-week is *", () => {
    expect(next("0 0 1 * *", "UTC", "2026-11-02T00:00:00.000Z")).toBe(
      "2026-12-01T00:00:00.000Z",
    );
  });
});

describe("DST handling in America/New_York", () => {
  it("skips wall minutes that do not exist on spring-forward day", () => {
    // 2026-03-08: 02:00 EST becomes 03:00 EDT; wall 02:30 never happens.
    expect(next("30 2 * * *", "America/New_York", "2026-03-08T05:00:00.000Z")).toBe(
      "2026-03-09T06:30:00.000Z",
    );
    // The day before, 02:30 EST exists as usual.
    expect(next("30 2 * * *", "America/New_York", "2026-03-07T05:00:00.000Z")).toBe(
      "2026-03-07T07:30:00.000Z",
    );
  });

  it("steps from 01:59 EST straight to 03:00 EDT for minute-level crons", () => {
    expect(next("* * * * *", "America/New_York", "2026-03-08T06:59:30.000Z")).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });

  it("fires both passes of a repeated wall minute on fall-back day", () => {
    // 2026-11-01: 01:00 EDT (05:00Z) happens again as 01:00 EST (06:00Z).
    expect(next("0 1 * * *", "America/New_York", "2026-11-01T05:00:00.000Z")).toBe(
      "2026-11-01T06:00:00.000Z",
    );
    expect(next("0 1 * * *", "America/New_York", "2026-11-01T06:00:00.000Z")).toBe(
      "2026-11-02T06:00:00.000Z",
    );
  });

  it("returns a later minute's first pass over an earlier minute's second pass", () => {
    // After 01:30 EDT (05:30Z), the next minute-level occurrence is 01:31
    // EDT (05:31Z) — not the second pass of 01:30 (06:30Z).
    expect(next("* * * * *", "America/New_York", "2026-11-01T05:30:30.000Z")).toBe(
      "2026-11-01T05:31:00.000Z",
    );
    // With only minute 30 of hour 1 enabled, after its EDT pass fires the
    // EST pass of the same wall minute is next.
    expect(next("30 1 * * *", "America/New_York", "2026-11-01T05:30:30.000Z")).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    // Minute 15 only: its EDT pass (05:15Z) is in the past, so the EST pass
    // of an earlier minute (01:00 EST = 06:00Z)... does not match minute 15;
    // the next match is 01:15 EST (06:15Z).
    expect(next("15 1 * * *", "America/New_York", "2026-11-01T05:30:30.000Z")).toBe(
      "2026-11-01T06:15:00.000Z",
    );
  });
});
