import { describe, expect, it } from "vitest";
import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  REPLAY_MAX_MS,
  SHORT_REPLY_MAX_CHARS,
  planPacing,
} from "../../src/renderer/src/features/chat/stream-pacer.js";

const join = (chunks: readonly string[]): string => chunks.join("");

describe("planPacing", () => {
  it("keeps a short reply as sentence chunks and rejoins losslessly", () => {
    const text = "第一句。第二句？第三句！";
    const plan = planPacing(text);
    expect(plan.mode).toBe("sentence");
    expect(plan.chunks.length).toBe(3);
    expect(join(plan.chunks)).toBe(text);
  });

  it("streams a long reply line by line", () => {
    const text = [
      "## 结论",
      "第一段说明这个方案为什么可行，包含足够多的字符。",
      "第二段继续解释边界与风险，长度也足够。",
      "第三段给出后续行动项与负责人。",
    ].join("\n");
    const plan = planPacing(text);
    expect(plan.mode).toBe("line");
    expect(join(plan.chunks)).toBe(text);
    // Line mode keeps the newline at the end of each chunk.
    expect(plan.chunks.slice(0, -1).every((chunk) => chunk.endsWith("\n"))).toBe(true);
  });

  it("switches to line mode past the short-reply length even with one line", () => {
    const text = "很".repeat(SHORT_REPLY_MAX_CHARS + 1);
    expect(planPacing(text).mode).toBe("line");
    expect(planPacing("很".repeat(SHORT_REPLY_MAX_CHARS)).mode).toBe("sentence");
  });

  it("merges a run of tiny lines instead of flickering per line", () => {
    const text = Array.from({ length: 12 }, () => "短").join("\n");
    const plan = planPacing(text);
    expect(join(plan.chunks)).toBe(text);
    expect(plan.chunks.length).toBeLessThan(text.split("\n").length);
  });

  it("advances faster as the reply grows (adaptive interval)", () => {
    const medium = "行".repeat(200);
    const long = "行".repeat(2_000);
    // A single line still has to stream: it is split instead of arriving whole.
    expect(planPacing(long).chunks.length).toBeGreaterThan(planPacing(medium).chunks.length);
    expect(planPacing(long).intervalMs).toBeLessThanOrEqual(planPacing(medium).intervalMs);
  });

  it("streams a very long reply faster instead of longer", () => {
    const manyLines = Array.from(
      { length: 1_200 },
      (_, index) => `第 ${index} 行内容，这一行长度足够因此不会被合并处理。`,
    ).join("\n");
    const plan = planPacing(manyLines);
    expect(join(plan.chunks)).toBe(manyLines);
    expect(plan.intervalMs).toBeLessThanOrEqual(20);
    expect(plan.expectedMs).toBeLessThanOrEqual(REPLAY_MAX_MS);
  });

  it("keeps the interval inside the readable bounds", () => {
    for (const text of ["a", "a".repeat(10), "a\nb\nc", "a".repeat(5_000)]) {
      const plan = planPacing(text);
      expect(plan.intervalMs).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
      expect(plan.intervalMs).toBeLessThanOrEqual(MAX_INTERVAL_MS);
    }
  });

  it("bounds the total replay time for very long replies", () => {
    const plan = planPacing("行\n".repeat(3_000));
    expect(plan.expectedMs).toBeLessThanOrEqual(REPLAY_MAX_MS);
  });

  it("keeps code fences as their own lines", () => {
    const text = "看这段代码：\n```ts\nconst a = 1;\n```\n结束。";
    const plan = planPacing(text);
    expect(join(plan.chunks)).toBe(text);
    expect(plan.chunks.some((chunk) => chunk.includes("```ts"))).toBe(true);
  });

  it("handles the empty reply", () => {
    const plan = planPacing("");
    expect(plan.chunks).toEqual([""]);
    expect(plan.expectedMs).toBe(0);
  });
});
