import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./backoff.js";

describe("backoffDelayMs", () => {
  it("doubles exponentially per failed attempt", () => {
    expect(backoffDelayMs({ attempt: 1, baseDelayMs: 500, maxDelayMs: 30_000 })).toBe(500);
    expect(backoffDelayMs({ attempt: 2, baseDelayMs: 500, maxDelayMs: 30_000 })).toBe(1_000);
    expect(backoffDelayMs({ attempt: 3, baseDelayMs: 500, maxDelayMs: 30_000 })).toBe(2_000);
  });

  it("clamps at the configured maximum", () => {
    expect(
      backoffDelayMs({ attempt: 10, baseDelayMs: 500, maxDelayMs: 30_000 }),
    ).toBe(30_000);
  });

  it("respects a server-provided Retry-After as a floor", () => {
    expect(
      backoffDelayMs({
        attempt: 1,
        baseDelayMs: 500,
        maxDelayMs: 30_000,
        retryAfterMs: 5_000,
      }),
    ).toBe(5_000);
    // A hint below the computed delay does not shorten the backoff.
    expect(
      backoffDelayMs({
        attempt: 3,
        baseDelayMs: 500,
        maxDelayMs: 30_000,
        retryAfterMs: 100,
      }),
    ).toBe(2_000);
  });

  it("treats attempt numbers below 1 as the first attempt", () => {
    expect(backoffDelayMs({ attempt: 0, baseDelayMs: 500, maxDelayMs: 30_000 })).toBe(500);
  });
});
