import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import { getRun, listNodeRuns, listRuns } from "@deepseek-bot/storage";
import { WorkflowEngine } from "./engine.js";
import {
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
  botId: string;
}

function setup(): Harness {
  const db = openTestDatabase();
  const refs = seedProfileAndWorkspace(db);
  const bot = makeBot(refs);
  insertBot(db, bot);
  return { db, botId: bot.id };
}

function nodeRunOf(db: OpenedDatabase, runId: string, nodeId: string) {
  const attempts = listNodeRuns(db, runId).filter(
    (nodeRun) => nodeRun.nodeId === nodeId,
  );
  const latest = attempts.at(-1);
  if (latest === undefined) {
    throw new Error(`no node run recorded for ${nodeId}`);
  }
  return latest;
}

async function runToTerminal(db: OpenedDatabase, runId: string): Promise<void> {
  await waitFor(() => {
    const status = getRun(db, runId)?.status;
    return (
      status === "succeeded" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "interrupted"
    );
  });
}

interface ResumeScenario {
  harness: Harness;
  interruptedRunId: string;
}

/**
 * Start a → b on a host that dies while b is in flight; recover on a new
 * engine over the same storage. Node a has succeeded (with a session and
 * outputs persisted), node b was interrupted mid-attempt.
 */
async function interruptedRunWithCarriedWork(): Promise<ResumeScenario> {
  const harness = setup();
  const workflow = makeWorkflowFixture(
    [botNode("a", harness.botId), botNode("b", harness.botId)],
    [makeEdge("a", "out", "b", "i")],
  );
  insertWorkflow(harness.db, workflow);

  const deadHost = new WorkflowEngine({
    db: harness.db,
    executor: new ScriptedExecutor()
      .enqueue(async () => ({ outputs: { out: "v1" }, sessionId: "sess-a-1" }))
      .enqueue(async () => {
        await new Promise<void>(() => {});
        throw new Error("unreachable");
      }),
  });
  const { run } = deadHost.startRun({
    workflowId: workflow.id,
    trigger: { kind: "manual", idempotencyKey: randomUUID() },
  });
  await waitFor(() => nodeRunOf(harness.db, run.id, "a").status === "succeeded");
  await waitFor(() => nodeRunOf(harness.db, run.id, "b").status === "running");

  const restarted = new WorkflowEngine({
    db: harness.db,
    executor: new ScriptedExecutor(),
  });
  restarted.recoverInterruptedRuns();
  expect(getRun(harness.db, run.id)?.status).toBe("interrupted");
  return { harness, interruptedRunId: run.id };
}

describe("resume of restart-interrupted runs (D10)", () => {
  it("creates a new run that carries succeeded work and finishes the rest", async () => {
    const { harness, interruptedRunId } = await interruptedRunWithCarriedWork();

    const executor = new ScriptedExecutor();
    const resumedHost = new WorkflowEngine({ db: harness.db, executor });
    const { run: resumed, created } = resumedHost.resumeRun({ runId: interruptedRunId });
    expect(created).toBe(true);
    expect(resumed.resumedFromRunId).toBe(interruptedRunId);
    expect(resumed.trigger.kind).toBe("manual");
    expect(resumed.workflowSnapshot.id).toBe(
      getRun(harness.db, interruptedRunId)?.workflowSnapshot.id,
    );

    // Node a is NOT re-executed: no executor call, succeeded state with the
    // original session and outputs rehydrated from storage.
    await waitFor(() => getRun(harness.db, resumed.id)?.status === "succeeded");
    expect(executor.calls.map((call) => call.nodeId)).toEqual(["b"]);
    const a = nodeRunOf(harness.db, resumed.id, "a");
    expect(a.status).toBe("succeeded");
    expect(a.attempt).toBe(1);
    expect(a.sessionId).toBe("sess-a-1");
    const b = nodeRunOf(harness.db, resumed.id, "b");
    expect(b.status).toBe("succeeded");
    // Node b received the interrupted predecessor's output through the edge.
    expect(executor.calls[0]?.inputs).toEqual({ i: "v1" });
    harness.db.close();
  });

  it("keeps interrupted and pending nodes fresh but completed ancestors decided", async () => {
    const { harness, interruptedRunId } = await interruptedRunWithCarriedWork();
    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    const { run: resumed } = engine.resumeRun({ runId: interruptedRunId });
    await waitFor(() => getRun(harness.db, resumed.id)?.status === "succeeded");
    // Only one attempt exists per node in the resumed run.
    expect(listNodeRuns(harness.db, resumed.id)).toHaveLength(2);
    expect(nodeRunOf(harness.db, resumed.id, "b").attempt).toBe(1);
    harness.db.close();
  });

  it("is idempotent when the caller supplies an idempotencyKey", async () => {
    const { harness, interruptedRunId } = await interruptedRunWithCarriedWork();
    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    const key = randomUUID();
    const first = engine.resumeRun({ runId: interruptedRunId, idempotencyKey: key });
    const second = engine.resumeRun({ runId: interruptedRunId, idempotencyKey: key });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    await runToTerminal(harness.db, first.run.id);
    expect(listRuns(harness.db, { statuses: ["queued", "running"] })).toHaveLength(0);
    harness.db.close();
  });

  it("rejects runs that are not interrupted", async () => {
    const harness = setup();
    const workflow = makeWorkflowFixture([botNode("a", harness.botId)], []);
    insertWorkflow(harness.db, workflow);
    const engine = new WorkflowEngine({ db: harness.db, executor: new ScriptedExecutor() });
    const { run } = engine.startRun({
      workflowId: workflow.id,
      trigger: { kind: "manual", idempotencyKey: randomUUID() },
    });
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");
    expect(() => engine.resumeRun({ runId: run.id })).toThrow(/only interrupted/);
    expect(() => engine.resumeRun({ runId: randomUUID() })).toThrow(/not found/);
    harness.db.close();
  });

  it("refuses to resume when a snapshot bot was archived after the crash", async () => {
    const { harness, interruptedRunId } = await interruptedRunWithCarriedWork();
    harness.db.raw
      .prepare("UPDATE bots SET archived_at = ? WHERE id = ?;")
      .run(new Date().toISOString(), harness.botId);
    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    expect(() => engine.resumeRun({ runId: interruptedRunId })).toThrow(/archived bots/);
    harness.db.close();
  });

  it("keeps the original snapshots immutable after a resume", async () => {
    const { harness, interruptedRunId } = await interruptedRunWithCarriedWork();
    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    const { run: resumed } = engine.resumeRun({ runId: interruptedRunId });
    expect(resumed.botSnapshots).toEqual(
      getRun(harness.db, interruptedRunId)?.botSnapshots,
    );
    // The interrupted original is untouched by the resume.
    expect(getRun(harness.db, interruptedRunId)?.status).toBe("interrupted");
    await runToTerminal(harness.db, resumed.id);
    harness.db.close();
  });
});
// The hanging behavior above is expressed inline; see engine-recovery.test.ts
// for interrupt-during-cancel scenarios.
