import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@deepseek-bot/contracts";
import { isSequenceMonotonic } from "@deepseek-bot/contracts";
import {
  applyEvents,
  applySubscribeResult,
  initEventStream,
  rebuildFromSnapshot,
  resumeFrom,
} from "../../src/renderer/src/features/run-monitor/events/event-stream.js";

const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function envelope(
  sequence: number,
  eventId: string,
  type: EventEnvelope["type"] = "run.created",
): EventEnvelope {
  return {
    eventId,
    runId: RUN,
    sequence,
    timestamp: "2026-10-24T10:00:00Z",
    type,
    payload: { workflowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", triggerKind: "manual" },
  };
}

describe("event stream consumption", () => {
  it("accepts a strictly increasing stream and tracks lastSequence", () => {
    let state = initEventStream(RUN);
    const result = applyEvents(state, [envelope(0, "a"), envelope(1, "b"), envelope(2, "c")]);
    expect(result.accepted).toHaveLength(3);
    expect(result.duplicates).toBe(0);
    expect(result.state.lastSequence).toBe(2);
    expect(isSequenceMonotonic(result.state.events)).toBe(true);
    state = result.state;
    expect(state).toBeDefined();
  });

  it("drops a redelivered eventId (at-least-once delivery)", () => {
    const state = initEventStream(RUN);
    const first = applyEvents(state, [envelope(0, "a"), envelope(1, "b")]).state;
    const second = applyEvents(first, [envelope(1, "b"), envelope(2, "c")]);
    expect(second.accepted.map((event) => event.sequence)).toEqual([2]);
    expect(second.duplicates).toBe(1);
    expect(second.state.duplicatesDropped).toBe(1);
  });

  it("drops an old sequence even under a fresh eventId (sequences never replay)", () => {
    const state = applyEvents(initEventStream(RUN), [envelope(0, "a"), envelope(1, "b")]).state;
    const result = applyEvents(state, [envelope(1, "z")]);
    expect(result.accepted).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });

  it("marks a gap as snapshotRequired instead of faking a backfill", () => {
    const state = applyEvents(initEventStream(RUN), [envelope(0, "a"), envelope(1, "b")]).state;
    const result = applyEvents(state, [envelope(4, "d")]);
    expect(result.accepted).toHaveLength(0);
    expect(result.gapDetected).toBe(true);
    expect(result.state.gap).toEqual({ missingFrom: 2, missingTo: 3 });
    expect(result.state.snapshotRequired).toBe(true);
    expect(result.state.lastSequence).toBe(1);
  });

  it("latches a host snapshotRequired flag until an explicit rebuild", () => {
    const state = applyEvents(initEventStream(RUN), [envelope(0, "a")]).state;
    const flagged = applySubscribeResult(state, { events: [], snapshotRequired: true });
    expect(flagged.state.snapshotRequired).toBe(true);
    const rebuilt = rebuildFromSnapshot(flagged.state);
    expect(rebuilt.snapshotRequired).toBe(false);
    expect(rebuilt.events).toHaveLength(0);
    expect(rebuilt.lastSequence).toBeNull();
    expect(rebuilt.rebuildCount).toBe(1);
  });

  it("resumeFrom rewinds the consumer for the reconnect replay path", () => {
    const state = applyEvents(initEventStream(RUN), [envelope(0, "a"), envelope(1, "b"), envelope(2, "c")]).state;
    const resumed = resumeFrom(state, 1);
    expect(resumed.lastSequence).toBe(1);
    expect(resumed.events.map((event) => event.sequence)).toEqual([0, 1]);
    const replay = applyEvents(resumed, [envelope(2, "c")]);
    expect(replay.accepted).toHaveLength(1);
  });

  it("drops envelopes that belong to another run", () => {
    const state = initEventStream(RUN);
    const foreign = { ...envelope(0, "x"), runId: "dddddddd-dddd-4ddd-8ddd-dddddddddd0a" };
    const result = applyEvents(state, [foreign]);
    expect(result.accepted).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });
});
