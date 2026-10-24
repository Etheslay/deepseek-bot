import { describe, expect, it } from "vitest";
import {
  applyCancelled,
  applyDelta,
  applyFailure,
  applyTool,
  emptyStream,
  replayTimeline,
} from "../../src/renderer/src/features/chat/chat-reducer.js";

describe("chat stream reducer", () => {
  it("appends deltas in order", () => {
    let s = emptyStream();
    s = applyDelta(s, "你");
    s = applyDelta(s, "好");
    expect(s.text).toBe("你好");
    expect(s.tools).toHaveLength(0);
    expect(s.failure).toBeNull();
  });

  it("tracks tool cards by name, updating state", () => {
    let s = emptyStream();
    s = applyTool(s, { toolName: "read", state: "requested" });
    s = applyTool(s, { toolName: "read", state: "succeeded", summary: "ok" });
    expect(s.tools).toEqual([
      { toolName: "read", state: "succeeded", summary: "ok" },
    ]);
  });

  it("cancel freezes text and blocks further deltas", () => {
    let s = emptyStream();
    s = applyDelta(s, "部分");
    s = applyCancelled(s);
    s = applyDelta(s, "不该出现");
    expect(s.cancelled).toBe(true);
    expect(s.text).toBe("部分");
  });

  it("failure surfaces a stable error and blocks further deltas", () => {
    let s = emptyStream();
    s = applyFailure(s, {
      code: "RATE_LIMITED",
      message: "请求过于频繁",
      retryable: true,
    });
    s = applyDelta(s, "不该出现");
    expect(s.failure?.code).toBe("RATE_LIMITED");
    expect(s.failure?.retryable).toBe(true);
    expect(s.text).toBe("");
  });

  it("failure wins over cancel (first terminal state sticks)", () => {
    let s = emptyStream();
    s = applyCancelled(s);
    s = applyFailure(s, { code: "AUTH_FAILED", message: "x", retryable: false });
    expect(s.cancelled).toBe(true);
    expect(s.failure).toBeNull();
  });
});

describe("replayTimeline", () => {
  const mkEvent = (
    n: number,
    type: "run.created" | "run.statusChanged" | "node.statusChanged",
    timestamp: string,
    payload: object,
  ) => ({
    eventId: `e-${n}`,
    runId: "r",
    sequence: n,
    timestamp,
    type,
    payload,
  });

  it("builds replay items with deduped time labels", () => {
    const items = replayTimeline([
      mkEvent(0, "run.created", "2026-10-24T10:00:00Z", {}),
      mkEvent(1, "run.statusChanged", "2026-10-24T10:00:00Z", { from: "queued", to: "running" }),
      mkEvent(2, "node.statusChanged", "2026-10-24T10:00:02Z", {
        nodeId: "n1",
        from: "pending",
        to: "running",
      }),
    ]);
    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({ kind: "time", text: new Date("2026-10-24T10:00:00Z").toLocaleString() });
    expect(items[1]).toEqual({ kind: "event", label: "任务已创建", detail: "#0" });
    expect(items[2]).toEqual({
      kind: "event",
      label: "任务状态：queued → running",
      detail: "#1",
    });
    expect(items[3]).toEqual({
      kind: "time",
      text: new Date("2026-10-24T10:00:02Z").toLocaleString(),
    });
    expect(items[4]).toEqual({
      kind: "event",
      label: "节点 n1：pending → running",
      detail: "#2",
    });
  });

  it("returns empty for empty events", () => {
    expect(replayTimeline([])).toEqual([]);
  });
});
