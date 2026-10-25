import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getNodeRunOutputs,
  listScheduleMisses,
  recordScheduleMiss,
  saveSchedule,
  saveWorkflow,
  setNodeRunOutputs,
} from "./index.js";
import {
  makeLayout,
  makeRun,
  makeSchedule,
  makeTempRoot,
  makeWorkflow,
  openTestDatabase,
} from "./test-support.js";

describe("schedule miss repository (D10)", () => {
  it("records missed occurrences once and lists them newest first", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = saveWorkflow(db, makeWorkflow()).workflow;
    const schedule = saveSchedule(db, makeSchedule(workflow.id));

    const first = recordScheduleMiss(db, {
      id: randomUUID(),
      scheduleId: schedule.id,
      occurrenceUtc: "2026-10-25T08:00:00.000Z",
      reason: "host asleep",
    });
    expect(first.scheduleId).toBe(schedule.id);

    // Same occurrence recorded again (second tick after wake): no duplicate.
    recordScheduleMiss(db, {
      id: randomUUID(),
      scheduleId: schedule.id,
      occurrenceUtc: "2026-10-25T08:00:00.000Z",
      reason: "host asleep",
    });
    recordScheduleMiss(db, {
      id: randomUUID(),
      scheduleId: schedule.id,
      occurrenceUtc: "2026-10-25T08:05:00.000Z",
      reason: "host asleep",
    });

    const misses = listScheduleMisses(db, { scheduleId: schedule.id });
    expect(misses).toHaveLength(2);
    expect(misses[0]?.occurrenceUtc).toBe("2026-10-25T08:05:00.000Z");
    expect(misses.map((miss) => miss.occurrenceUtc)).not.toContain(undefined);
    expect(listScheduleMisses(db)).toHaveLength(2);
    expect(listScheduleMisses(db, { limit: 1 })).toHaveLength(1);
    db.close();
  });

  it("rejects misses for unknown schedules", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() =>
      recordScheduleMiss(db, {
        id: randomUUID(),
        scheduleId: randomUUID(),
        occurrenceUtc: "2026-10-25T08:00:00.000Z",
        reason: "host asleep",
      }),
    ).toThrow(/not found/);
    db.close();
  });
});

describe("node run outputs (D10 resume rehydration)", () => {
  it("persists and reads outputs for a node attempt", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = makeWorkflow();
    saveWorkflow(db, workflow);
    const run = makeRun(workflow);
    db.raw
      .prepare(
        "INSERT INTO runs (id, status, trigger_kind, trigger_json, workflow_snapshot_json, " +
          "bot_snapshots_json, idempotency_key, created_at, finished_at) " +
          "VALUES (?, 'queued', 'manual', '{}', '{}', '[]', ?, ?, NULL);",
      )
      .run(run.id, run.trigger.idempotencyKey, run.createdAt);
    db.raw
      .prepare(
        "INSERT INTO node_runs (id, run_id, node_id, attempt, status, input_refs_json, " +
          "output_refs_json, session_id, created_at, updated_at) " +
          "VALUES (?, ?, 'a', 1, 'succeeded', '[]', '[]', NULL, ?, ?);",
      )
      .run(randomUUID(), run.id, run.createdAt, run.createdAt);

    const nodeRunId = (
      db.raw.prepare("SELECT id FROM node_runs LIMIT 1;").get() as { id: string }
    ).id;
    expect(getNodeRunOutputs(db, nodeRunId)).toEqual({});

    setNodeRunOutputs(db, {
      id: nodeRunId,
      outputs: { answer: "已完成", count: 2 },
    });
    expect(getNodeRunOutputs(db, nodeRunId)).toEqual({ answer: "已完成", count: 2 });
    expect(getNodeRunOutputs(db, randomUUID())).toEqual({});
    expect(() =>
      setNodeRunOutputs(db, { id: randomUUID(), outputs: {} }),
    ).toThrow(/not found/);
    db.close();
  });
});
