import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import type { Run } from "@deepseek-bot/contracts";
import {
  appendEvent,
  createApproval,
  createNodeRun,
  createRun,
  getApproval,
  getRun,
  listEvents,
  listNodeRuns,
  transitionNodeRun,
  transitionRun,
} from "@deepseek-bot/storage";import { isSequenceMonotonic } from "@deepseek-bot/contracts";
import { WorkflowEngine } from "./engine.js";
import {
  AbortHangingExecutor,
  approvalNode,
  botNode,
  insertBot,
  insertWorkflow,
  makeBot,
  makeEdge,
  makeWorkflowFixture,
  openTestDatabase,
  ScriptedExecutor,
  seedProfileAndWorkspace,
  waitFor,
} from "./test-support.js";

interface Harness {
  db: OpenedDatabase;
  bot: ReturnType<typeof makeBot>;
}

function setup(): Harness {
  const db = openTestDatabase();
  const refs = seedProfileAndWorkspace(db);
  const bot = makeBot(refs);
  insertBot(db, bot);
  return { db, bot };
}

function latestAttempt(harness: Harness, runId: string, nodeId: string) {
  const attempts = listNodeRuns(harness.db, runId).filter(
    (nodeRun) => nodeRun.nodeId === nodeId,
  );
  const latest = attempts.at(-1);
  if (latest === undefined) {
    throw new Error(`no node run recorded for ${nodeId}`);
  }
  return latest;
}

describe("host-restart recovery", () => {
  it("interrupts active runs and their unfinished node attempts", async () => {
    const harness = setup();
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id), botNode("b", harness.bot.id)],
      [makeEdge("a", "o", "b", "i")],
    );
    insertWorkflow(harness.db, workflow);
    const deadHost = new WorkflowEngine({
      db: harness.db,
      executor: new AbortHangingExecutor(),
    });
    const { run } = deadHost.startRun({
      workflowId: workflow.id,
      trigger: { kind: "manual", idempotencyKey: randomUUID() },
    });
    await waitFor(() => latestAttempt(harness, run.id, "a").status === "running");

    // Simulated restart: a new engine over the same storage.
    const restarted = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    const results = restarted.recoverInterruptedRuns();

    expect(results).toEqual([
      { runId: run.id, interruptedNodeRuns: 2, expiredApprovals: 0 },
    ]);
    expect(getRun(harness.db, run.id)?.status).toBe("interrupted");
    expect(getRun(harness.db, run.id)?.finishedAt).not.toBeNull();
    expect(latestAttempt(harness, run.id, "a").status).toBe("interrupted");
    expect(latestAttempt(harness, run.id, "b").status).toBe("interrupted");
    const events = listEvents(harness.db, run.id);
    expect(events.at(-1)?.type).toBe("run.interrupted");
    expect(events.some((event) => event.type === "run.interrupted")).toBe(true);

    // A second recovery pass finds nothing left to do.
    expect(restarted.recoverInterruptedRuns()).toEqual([]);
    harness.db.close();
  });

  it("interrupts queued runs that never started", () => {
    const harness = setup();
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    const queued: Run = {
      id: randomUUID(),
      workflowSnapshot: workflow,
      botSnapshots: [],
      status: "queued",
      trigger: { kind: "manual", idempotencyKey: randomUUID() },
      createdAt: harness.db.now().toISOString(),
      finishedAt: null,
    };
    createRun(harness.db, queued);

    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    expect(engine.recoverInterruptedRuns()).toEqual([
      { runId: queued.id, interruptedNodeRuns: 0, expiredApprovals: 0 },
    ]);
    expect(getRun(harness.db, queued.id)?.status).toBe("interrupted");
    harness.db.close();
  });

  it("expires pending approvals of interrupted runs", async () => {
    const harness = setup();
    const snapshot = makeWorkflowFixture([approvalNode("gate")], []);
    const run = createRun(harness.db, {
      id: randomUUID(),
      workflowSnapshot: snapshot,
      botSnapshots: [],
      status: "queued",
      trigger: { kind: "manual", idempotencyKey: randomUUID() },
      createdAt: harness.db.now().toISOString(),
      finishedAt: null,
    }).run;
    transitionRun(harness.db, { id: run.id, to: "running" });
    const nodeRun = createNodeRun(harness.db, {
      id: randomUUID(),
      runId: run.id,
      nodeId: "gate",
      attempt: 1,
      status: "pending",
      inputRefs: [],
      outputRefs: [],
      sessionId: null,
    });
    transitionNodeRun(harness.db, { id: nodeRun.id, to: "running" });
    transitionNodeRun(harness.db, { id: nodeRun.id, to: "waiting_approval" });
    const approval = createApproval(harness.db, {
      id: randomUUID(),
      runId: run.id,
      nodeRunId: nodeRun.id,
      actionDigest: "a".repeat(64),
      resource: "workflow-run/x/node/gate",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "pending",
    });

    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    expect(engine.recoverInterruptedRuns()).toEqual([
      { runId: run.id, interruptedNodeRuns: 1, expiredApprovals: 1 },
    ]);
    expect(getApproval(harness.db, approval.id)?.status).toBe("expired");
    expect(
      listEvents(harness.db, run.id).some(
        (event) =>
          event.type === "approval.resolved" &&
          (event.payload as { decision?: string }).decision === "expired",
      ),
    ).toBe(true);
    harness.db.close();
  });

  it("continues event sequences after recovery and replays by afterSequence", async () => {
    const harness = setup();
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id), botNode("b", harness.bot.id)],
      [makeEdge("a", "o", "b", "i")],
    );
    insertWorkflow(harness.db, workflow);
    const deadHost = new WorkflowEngine({
      db: harness.db,
      executor: new AbortHangingExecutor(),
    });
    const { run } = deadHost.startRun({
      workflowId: workflow.id,
      trigger: { kind: "manual", idempotencyKey: randomUUID() },
    });
    await waitFor(() => latestAttempt(harness, run.id, "a").status === "running");

    const restarted = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    restarted.recoverInterruptedRuns();

    const events = listEvents(harness.db, run.id);
    expect(isSequenceMonotonic(events)).toBe(true);
    // Pre-crash: run.created, run.statusChanged, a pending→running (0..2);
    // recovery appends from the next sequence without reuse.
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const replay = listEvents(harness.db, run.id, { afterSequence: 3 });
    expect(replay.map((event) => event.sequence)).toEqual([4, 5, 6]);

    // At-least-once redelivery: the same eventId is recorded only once.
    const interrupted = events.at(-1);
    if (interrupted === undefined) {
      throw new Error("expected a persisted run.interrupted event");
    }
    const duplicate = appendEvent(harness.db, interrupted);
    expect(duplicate.recorded).toBe(false);
    expect(duplicate.sequence).toBe(interrupted.sequence);
    harness.db.close();
  });
});
