import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Schedule } from "@deepseek-bot/contracts";
import {
  getRun,
  getSchedule,
  listRuns,
  saveWorkflow,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { WorkflowEngine } from "./engine.js";
import { LocalScheduler } from "./scheduler/scheduler.js";
import type { ScheduleMissNotice } from "./scheduler/scheduler.js";
import {
  botNode,
  insertBot,
  makeBot,
  makeWorkflowFixture,
  openTestDatabase,
  ScriptedExecutor,
  seedProfileAndWorkspace,
  waitFor,
} from "./test-support.js";

interface TestClock {
  now: () => Date;
  setIso(iso: string): void;
  advanceMs(ms: number): void;
}

function makeClock(iso: string): TestClock {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    setIso(next: string) {
      current = new Date(next).getTime();
    },
    advanceMs(ms: number) {
      current += ms;
    },
  };
}

interface Harness {
  db: OpenedDatabase;
  clock: TestClock;
  engine: WorkflowEngine;
  executor: ScriptedExecutor;
  scheduler: LocalScheduler;
  workflowId: string;
  missedNotices: ScheduleMissNotice[];
}

function setup(clockIso = "2026-10-25T12:00:00.000Z"): Harness {
  const db = openTestDatabase();
  const clock = makeClock(clockIso);
  const refs = seedProfileAndWorkspace(db);
  const bot = makeBot(refs);
  insertBot(db, bot);
  const executor = new ScriptedExecutor();
  const engine = new WorkflowEngine({ db, executor, now: clock.now });
  const missedNotices: ScheduleMissNotice[] = [];
  const scheduler = new LocalScheduler({
    db,
    engine,
    now: clock.now,
    onMissed: (notices) => missedNotices.push(...notices),
  });
  const workflow = makeWorkflowFixture([botNode("a", bot.id)], []);
  saveWorkflow(db, workflow);
  return { db, clock, engine, executor, scheduler, workflowId: workflow.id, missedNotices };
}

function upsertEvery5Min(
  harness: Harness,
  options: { enabled?: boolean; workflowId?: string } = {},
): Schedule {
  return harness.scheduler.upsertSchedule({
    workflowId: options.workflowId ?? harness.workflowId,
    timezone: "UTC",
    recurrence: "*/5 * * * *",
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

function scheduleById(harness: Harness, id: string): Schedule {
  const schedule = getSchedule(harness.db, id);
  if (schedule === undefined) {
    throw new Error("schedule missing from storage");
  }
  return schedule;
}

async function runsToTerminal(harness: Harness): Promise<void> {
  await waitFor(() => {
    const active = listRuns(harness.db, { statuses: ["queued", "running", "waiting_approval", "cancelling"] });
    return active.length === 0;
  });
}

describe("local scheduler: schedule facade (D10)", () => {
  it("computes nextRunAt from now when saving an enabled schedule", () => {
    const harness = setup("2026-10-25T12:03:00.000Z");
    const schedule = upsertEvery5Min(harness);
    expect(schedule.enabled).toBe(true);
    expect(schedule.nextRunAt).toBe("2026-10-25T12:05:00.000Z");
    harness.db.close();
  });

  it("leaves nextRunAt unset for disabled schedules and computes it on enable", () => {
    const harness = setup("2026-10-25T12:03:00.000Z");
    const schedule = upsertEvery5Min(harness, { enabled: false });
    expect(schedule.nextRunAt).toBeNull();
    expect(schedule.enabled).toBe(false);

    const enabled = harness.scheduler.setEnabled({ id: schedule.id, enabled: true });
    expect(enabled.nextRunAt).toBe("2026-10-25T12:05:00.000Z");
    harness.db.close();
  });

  it("rejects malformed recurrence and unknown workflows", () => {
    const harness = setup();
    expect(() =>
      harness.scheduler.upsertSchedule({
        workflowId: harness.workflowId,
        timezone: "UTC",
        recurrence: "every five minutes",
      }),
    ).toThrow(/cron/);
    expect(() =>
      harness.scheduler.upsertSchedule({
        workflowId: randomUUID(),
        timezone: "UTC",
        recurrence: "* * * * *",
      }),
    ).toThrow(/workflow/);
    expect(() =>
      harness.scheduler.upsertSchedule({
        workflowId: harness.workflowId,
        timezone: "Not/AZone",
        recurrence: "* * * * *",
      }),
    ).toThrow(/IANA/);
    harness.db.close();
  });

  it("recomputes a stale nextRunAt when re-enabled", () => {
    const harness = setup("2026-10-25T12:03:00.000Z");
    const schedule = upsertEvery5Min(harness);
    harness.scheduler.setEnabled({ id: schedule.id, enabled: false });
    harness.clock.setIso("2026-10-25T18:41:00.000Z");
    const enabled = harness.scheduler.setEnabled({ id: schedule.id, enabled: true });
    // Elapsed occurrences stay gone: enabling is not a catch-up (FR-08).
    expect(enabled.nextRunAt).toBe("2026-10-25T18:45:00.000Z");
    harness.db.close();
  });
});

describe("local scheduler: due occurrence triggering", () => {
  it("starts a schedule run with the occurrence as dedup key", async () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    const schedule = upsertEvery5Min(harness);
    harness.clock.advanceMs(40_000); // 12:05:10 — due (30s late, within grace)

    const results = harness.scheduler.tick();
    await runsToTerminal(harness);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("triggered");
    const runId = results[0]?.runId;
    expect(runId).toBeDefined();
    const run = getRun(harness.db, runId!);
    expect(run?.trigger).toMatchObject({
      kind: "schedule",
      scheduleId: schedule.id,
      occurrenceUtc: "2026-10-25T12:05:00.000Z",
    });
    // nextRunAt advanced to the following occurrence.
    expect(scheduleById(harness, schedule.id).nextRunAt).toBe("2026-10-25T12:10:00.000Z");
    harness.db.close();
  });

  it("ignores schedules that are not due yet", () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    upsertEvery5Min(harness);
    expect(harness.scheduler.tick()).toEqual([]);
    expect(harness.missedNotices).toEqual([]);
    harness.db.close();
  });

  it("does not duplicate the occurrence on a second tick", async () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    upsertEvery5Min(harness);
    harness.clock.advanceMs(40_000);
    harness.scheduler.tick();
    await runsToTerminal(harness);
    harness.clock.advanceMs(1_000);
    expect(harness.scheduler.tick()).toEqual([]);
    expect(listRuns(harness.db, {})).toHaveLength(1);
    harness.db.close();
  });

  it("survives a crash between trigger and advance as a duplicate", async () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    const schedule = upsertEvery5Min(harness);
    // Simulate the pre-crash state: the run was persisted but nextRunAt was
    // never advanced (host died right after startRun).
    harness.clock.advanceMs(40_000);
    const { run } = harness.engine.startRun({
      workflowId: harness.workflowId,
      trigger: {
        kind: "schedule",
        idempotencyKey: randomUUID(),
        scheduleId: schedule.id,
        occurrenceUtc: "2026-10-25T12:05:00.000Z",
      },
    });
    await runsToTerminal(harness);

    const results = harness.scheduler.tick();
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("duplicate");
    expect(results[0]?.runId).toBe(run.id);
    expect(listRuns(harness.db, {})).toHaveLength(1);
    expect(scheduleById(harness, schedule.id).nextRunAt).toBe("2026-10-25T12:10:00.000Z");
    harness.db.close();
  });

  it("computes nextRunAt when a tick finds it unset", () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    const schedule = upsertEvery5Min(harness, { enabled: false });
    // State that bypasses the facade (e.g. an imported or legacy row):
    // enabled with no computed time.
    harness.db.raw
      .prepare("UPDATE schedules SET enabled = 1 WHERE id = ?;")
      .run(schedule.id);

    expect(harness.scheduler.tick()).toEqual([]);
    expect(scheduleById(harness, schedule.id).nextRunAt).toBe("2026-10-25T12:05:00.000Z");
    harness.db.close();
  });
});

describe("local scheduler: misfire (skip-and-notify)", () => {
  it("marks a past-due occurrence missed without running it", () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    const schedule = upsertEvery5Min(harness);
    // Sleep scenario: the host wakes up 2 minutes late (> 60s grace); the
    // 12:05 occurrence fell into the sleep (12:10 is still in the future).
    harness.clock.advanceMs(2 * 60_000);

    const results = harness.scheduler.tick();
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("missed");
    expect(listRuns(harness.db, {})).toEqual([]);
    expect(harness.missedNotices).toHaveLength(1);
    expect(harness.missedNotices[0]).toMatchObject({
      scheduleId: schedule.id,
      occurrenceUtc: "2026-10-25T12:05:00.000Z",
      workflowId: harness.workflowId,
    });
    const misses = harness.scheduler.listMisses(schedule.id);
    expect(misses).toHaveLength(1);
    expect(misses[0]?.reason).toContain("skip-and-notify");
    expect(scheduleById(harness, schedule.id).nextRunAt).toBe("2026-10-25T12:10:00.000Z");
    harness.db.close();
  });

  it("records every missed occurrence of a long sleep individually", () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    upsertEvery5Min(harness);
    // Woke at 12:17:00 — the 12:05, 12:10 and 12:15 occurrences were missed.
    harness.clock.setIso("2026-10-25T12:17:00.000Z");

    harness.scheduler.tick();
    const misses = harness.scheduler.listMisses();
    expect(misses.map((miss) => miss.occurrenceUtc)).toEqual([
      "2026-10-25T12:15:00.000Z",
      "2026-10-25T12:10:00.000Z",
      "2026-10-25T12:05:00.000Z",
    ]);
    expect(harness.missedNotices).toHaveLength(3);
    expect(listRuns(harness.db, {})).toEqual([]);
    harness.db.close();
  });

  it("still triggers the next occurrence after a misfire", async () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    upsertEvery5Min(harness);
    harness.clock.advanceMs(3 * 60_000); // 12:07:30 — 12:05 missed
    harness.scheduler.tick();

    harness.clock.setIso("2026-10-25T12:10:10.000Z");
    const results = harness.scheduler.tick();
    expect(results[0]?.outcome).toBe("triggered");
    await runsToTerminal(harness);
    harness.db.close();
  });

  it("records a failed trigger as a visible miss and moves on", () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    // Corrupt the bot reference so startRun fails deterministically.
    const broken = makeWorkflowFixture([botNode("a", randomUUID())], []);
    saveWorkflow(harness.db, broken);
    const schedule = harness.scheduler.upsertSchedule({
      workflowId: broken.id,
      timezone: "UTC",
      recurrence: "*/5 * * * *",
    });
    harness.clock.advanceMs(40_000);

    const results = harness.scheduler.tick();
    expect(results[0]?.outcome).toBe("trigger-failed");
    expect(results[0]?.reason).toContain("schedule trigger failed");
    expect(harness.missedNotices).toHaveLength(1);
    expect(harness.scheduler.listMisses(schedule.id)).toHaveLength(1);
    // The broken occurrence is not retried forever.
    expect(scheduleById(harness, schedule.id).nextRunAt).toBe("2026-10-25T12:10:00.000Z");
    harness.db.close();
  });

  it("does not misfire an occurrence observed within the grace window", async () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    upsertEvery5Min(harness);
    harness.clock.advanceMs(60_000); // 12:05:30 — exactly at the grace edge

    const results = harness.scheduler.tick();
    expect(results[0]?.outcome).toBe("triggered");
    expect(harness.scheduler.listMisses()).toEqual([]);
    await runsToTerminal(harness);
    harness.db.close();
  });
});

describe("local scheduler: host lifecycle (D10 重启中断状态)", () => {
  it("evaluates restart misfires on the first tick after start()", () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    const schedule = upsertEvery5Min(harness);
    harness.clock.advanceMs(10 * 60_000); // host slept through 12:05..12:10

    expect(harness.scheduler.isRunning).toBe(false);
    harness.scheduler.start();
    expect(harness.scheduler.isRunning).toBe(true);
    expect(harness.scheduler.listMisses(schedule.id).map((m) => m.occurrenceUtc)).toEqual([
      "2026-10-25T12:10:00.000Z",
      "2026-10-25T12:05:00.000Z",
    ]);
    expect(scheduleById(harness, schedule.id).nextRunAt).toBe("2026-10-25T12:15:00.000Z");

    harness.scheduler.stop();
    expect(harness.scheduler.isRunning).toBe(false);
    harness.scheduler.stop(); // idempotent
    harness.db.close();
  });

  it("keeps ticking on its own timer and stops cleanly", async () => {
    const harness = setup("2026-10-25T12:04:30.000Z");
    upsertEvery5Min(harness);
    const ticking = new LocalScheduler({
      db: harness.db,
      engine: harness.engine,
      now: harness.clock.now,
      tickIntervalMs: 20,
    });
    ticking.start();
    harness.clock.advanceMs(40_000); // 12:05:10 — due without any manual tick
    await waitFor(() => listRuns(harness.db, {}).length === 1);
    await runsToTerminal(harness);
    ticking.stop();
    // A stopped scheduler must not fire on later occurrences (real time
    // passes, no timer remains).
    harness.clock.advanceMs(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(listRuns(harness.db, {})).toHaveLength(1);
    harness.db.close();
  });

  it("does not start twice", () => {
    const harness = setup();
    harness.scheduler.start();
    harness.scheduler.start();
    expect(harness.scheduler.isRunning).toBe(true);
    harness.scheduler.stop();
    harness.db.close();
  });
});
