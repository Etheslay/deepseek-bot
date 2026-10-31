/**
 * Tool result cap (single-result budget for outputs that feed the model
 * prompt): short results pass through untouched, oversized ones keep head and
 * tail around the marker, and the assembled text stays within the budget.
 */
import { describe, expect, it } from "vitest";
import { estimateTokens } from "./usage-capture.js";
import {
  MAX_TOOL_RESULT_TOKENS,
  capToolResultValue,
  truncationMarker,
} from "./tool-result-cap.js";

describe("capToolResultValue", () => {
  it("passes short results through untouched", () => {
    const value = { ok: true, rows: ["只有一小段输出"] };
    const capped = capToolResultValue(value);
    expect(capped.truncated).toBe(false);
    expect(capped.value).toBe(value);
    expect(capped.originalTokens).toBe(estimateTokens(JSON.stringify(value)));
  });

  it("cuts oversized results to head and tail around the marker", () => {
    const value = `HEAD-START${"日".repeat(30_000)}TAIL-END`;
    const capped = capToolResultValue(value);
    expect(capped.truncated).toBe(true);
    expect(capped.originalTokens).toBeGreaterThan(MAX_TOOL_RESULT_TOKENS);
    const text = capped.value as string;
    expect(typeof text).toBe("string");
    // Within budget: head + tail + marker never exceed the cap.
    expect(estimateTokens(text)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
    // Both ends survive: the cut keeps the head 60% and tail 40% (of the
    // serialized text — a plain string value keeps its JSON quotes).
    expect(text.startsWith('"HEAD-START')).toBe(true);
    expect(text.endsWith('TAIL-END"')).toBe(true);
    expect(text).toContain(truncationMarker(capped.originalTokens));
  });

  it("caps structured results at their serialized size", () => {
    const value = { log: "x".repeat(80_000), tail: "末尾数据" };
    const capped = capToolResultValue(value);
    expect(capped.truncated).toBe(true);
    const text = capped.value as string;
    expect(estimateTokens(text)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
    expect(text).toContain("工具输出已截断");
    expect(text.endsWith('末尾数据"}')).toBe(true);
  });

  it("honors a custom budget and keeps the marker line intact", () => {
    const value = "a".repeat(4_000);
    const capped = capToolResultValue(value, 200);
    expect(capped.truncated).toBe(true);
    const text = capped.value as string;
    expect(estimateTokens(text)).toBeLessThanOrEqual(200);
    expect(text).toContain("read_workspace_file");
    expect(text.startsWith('"aaa')).toBe(true);
  });
});
