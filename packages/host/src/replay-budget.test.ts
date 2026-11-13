import { describe, expect, it } from "vitest";
import {
  compressionShrinksReplay,
  replayTokenCount,
  trimReplayToBudget,
  type ReplayRow,
} from "./replay-budget.js";

function row(id: string, role: ReplayRow["role"], text: string): ReplayRow {
  return { id, role, text };
}

describe("trimReplayToBudget", () => {
  it("keeps a short thread intact", () => {
    const rows = [row("u1", "user", "你好"), row("a1", "assistant", "在")];
    expect(trimReplayToBudget(rows, 100)).toEqual(rows);
  });

  it("drops the oldest turn until the newest turns fit", () => {
    const rows = [
      row("u1", "user", "旧".repeat(40)),
      row("a1", "assistant", "旧回复"),
      row("u2", "user", "新问题"),
      row("a2", "assistant", "新回复"),
    ];
    const kept = trimReplayToBudget(rows, 20);
    expect(kept.map((item) => item.id)).toEqual(["u2", "a2"]);
    expect(replayTokenCount(kept)).toBeLessThanOrEqual(20);
  });

  it("keeps the newest line when one turn is still over budget", () => {
    const kept = trimReplayToBudget(
      [row("u1", "user", "问".repeat(40)), row("a1", "assistant", "短答")],
      10,
    );
    expect(kept.map((item) => item.id)).toEqual(["a1"]);
  });

  it("keeps the tail of a single row that is still over budget", () => {
    const kept = trimReplayToBudget([row("a1", "assistant", `头${"中".repeat(80)}尾`)], 8);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.text.endsWith("尾")).toBe(true);
    expect(kept[0]?.text.startsWith("头")).toBe(false);
    expect(replayTokenCount(kept)).toBeLessThanOrEqual(8);
  });
});

describe("compressionShrinksReplay", () => {
  it("skips a fold that would not remove any replayed row", () => {
    expect(compressionShrinksReplay(["old"], new Set(["new"]))).toBe(false);
    expect(compressionShrinksReplay(["old", "mid"], new Set(["mid", "new"]))).toBe(true);
  });
});
