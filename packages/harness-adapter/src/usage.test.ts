/**
 * Usage capture from harness session events.
 *
 * The point of these tests is the tolerance: the harness has reported usage in
 * more than one shape, so every recognised shape must be read, an absent block
 * must fall back to an estimate, and the accumulator must not double count the
 * cumulative frames a turn sends.
 */
import { describe, expect, it } from "vitest";
import type { SessionEventEnvelope } from "./harness-attempt.js";
import {
  TurnUsageAccumulator,
  estimateTokens,
  extractUsageFromEvent,
} from "./usage.js";

function event(type: string, data: unknown): SessionEventEnvelope {
  return { type, data } as unknown as SessionEventEnvelope;
}

describe("extractUsageFromEvent", () => {
  it("reads snake_case counts off the data payload", () => {
    expect(extractUsageFromEvent(event("turn/usage", { input_tokens: 120, output_tokens: 30 }))).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 0,
      model: null,
    });
  });

  it("reads camelCase counts", () => {
    expect(extractUsageFromEvent(event("turn/usage", { inputTokens: 12, outputTokens: 3 }))).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cachedInputTokens: 0,
      model: null,
    });
  });

  it("reads a nested usage object with cached tokens and the model", () => {
    expect(
      extractUsageFromEvent(
        event("session/update", {
          usage: { input_tokens: 900, output_tokens: 100, cache_read_input_tokens: 800, model: "deepseek-chat" },
        }),
      ),
    ).toEqual({ inputTokens: 900, outputTokens: 100, cachedInputTokens: 800, model: "deepseek-chat" });
  });

  it("treats an all-zero block as no usage", () => {
    expect(extractUsageFromEvent(event("turn/usage", { input_tokens: 0, output_tokens: 0 }))).toBeNull();
  });

  it("returns null for events without usage", () => {
    expect(extractUsageFromEvent(event("tool/call", { name: "read_file" }))).toBeNull();
    expect(extractUsageFromEvent(event("turn/end", undefined))).toBeNull();
    expect(extractUsageFromEvent(event("turn/end", "completed"))).toBeNull();
  });

  it("ignores negative or non-numeric values instead of trusting them", () => {
    expect(extractUsageFromEvent(event("turn/usage", { input_tokens: -5, output_tokens: "10" }))).toBeNull();
  });
});

describe("estimateTokens", () => {
  it("counts about four characters per token and never zero for text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("12345678")).toBe(2);
  });
});

describe("TurnUsageAccumulator", () => {
  it("keeps the highest cumulative frame instead of summing them", () => {
    const accumulator = new TurnUsageAccumulator();
    accumulator.observe(event("turn/usage", { input_tokens: 100, output_tokens: 10 }));
    accumulator.observe(event("turn/usage", { input_tokens: 100, output_tokens: 40 }));
    expect(accumulator.hasUsage).toBe(true);
    expect(accumulator.finish("prompt", "reply")).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cachedInputTokens: 0,
      model: null,
      estimated: false,
    });
  });

  it("carries the model forward from any frame that named it", () => {
    const accumulator = new TurnUsageAccumulator();
    accumulator.observe(event("turn/usage", { input_tokens: 5, output_tokens: 1, model: "deepseek-reasoner" }));
    accumulator.observe(event("turn/usage", { input_tokens: 5, output_tokens: 9 }));
    expect(accumulator.finish("p", "r").model).toBe("deepseek-reasoner");
  });

  it("collects a whole attempt's events the way the workflow executor does", () => {
    const accumulator = new TurnUsageAccumulator();
    for (const frame of [
      event("turn/start", { turn: 1 }),
      event("turn/usage", { input_tokens: 321, output_tokens: 45 }),
      event("turn/end", { reason: { kind: "completed" } }),
    ]) {
      accumulator.observe(frame);
    }
    expect(accumulator.finish("ignored", "ignored")).toEqual({
      inputTokens: 321,
      outputTokens: 45,
      cachedInputTokens: 0,
      model: null,
      estimated: false,
    });
  });

  it("falls back to an estimate and says so when no frame carried usage", () => {
    const accumulator = new TurnUsageAccumulator();
    accumulator.observe(event("turn/end", { kind: "completed" }));
    expect(accumulator.hasUsage).toBe(false);
    const usage = accumulator.finish("12345678", "abcd");
    expect(usage).toEqual({
      inputTokens: 2,
      outputTokens: 1,
      cachedInputTokens: 0,
      model: null,
      estimated: true,
    });
  });
});
