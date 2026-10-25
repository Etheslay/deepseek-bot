import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import type { Run, Workflow } from "@deepseek-bot/contracts";
import {
  getApproval,
  getRun,
  listApprovals,
  listEvents,
  listNodeRuns,
} from "@deepseek-bot/storage";
import { EngineError } from "./errors.js";
import { WorkflowEngine, type WorkflowEngineOptions } from "./engine.js";
import {
  approvalNode,
  botNode,
  Deferred,
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

function startEngine(
  harness: Harness,
  workflow: Workflow,
  executor: ScriptedExecutor,
  engineOptions: Partial<WorkflowEngineOptions> = {},
): { engine: WorkflowEngine; run: Run } {
  insertWorkflow(harness.db, workflow);
  const engine = new WorkflowEngine({
    db: harness.db,
    executor,
    ...engineOptions,
  });
  const { run } = engine.startRun({
    workflowId: workflow.id,
    trigger: { kind: "manual", idempotencyKey: randomUUID() },
  });
  return { engine, run };
}

function gateWorkflow(harness: Harness): Workflow {
  return makeWorkflowFixture(
    [
      approvalNode("gate"),
      botNode("b", harness.bot.id),
    ],
    [makeEdge("gate", "o", "b", "i")],
  );
}

function pendingApproval(harness: Harness, runId: string) {
  const approvals = listApprovals(harness.db, { runId, status: "pending" });
  const approval = approvals[0];
  if (approval === undefined) {
    throw new Error("no pending approval recorded");
  }
  return approval;
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

function expectEngineError(fn: () => unknown, code: string, messagePattern?: RegExp): void {
  try {
    fn();
    expect.fail(`expected rejection with code ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("expected rejection")) {
      throw error;
    }
    expect((error as EngineError).code).toBe(code);
    if (messagePattern !== undefined) {
      expect((error as EngineError).message).toMatch(messagePattern);
    }
  }
}

describe("approval nodes", () => {
  it("pauses the run, resumes after approval and consumes the approval once", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve();
    const { engine, run } = startEngine(harness, gateWorkflow(harness), executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval");
    expect(latestAttempt(harness, run.id, "gate").status).toBe("waiting_approval");
    expect(latestAttempt(harness, run.id, "b").status).toBe("pending");

    const approval = pendingApproval(harness, run.id);
    expect(approval.actionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(approval.resource).toContain("gate");
    expect(
      listEvents(harness.db, run.id).some((event) => event.type === "approval.requested"),
    ).toBe(true);

    engine.decideApproval(approval.id, "approved");
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");

    expect(getApproval(harness.db, approval.id)?.status).toBe("consumed");
    expect(latestAttempt(harness, run.id, "gate").status).toBe("succeeded");
    expect(latestAttempt(harness, run.id, "b").status).toBe("succeeded");
    expect(
      listEvents(harness.db, run.id).some(
        (event) =>
          event.type === "approval.resolved" &&
          (event.payload as { decision?: string }).decision === "approved",
      ),
    ).toBe(true);
    harness.db.close();
  });

  it("fails the node and stops descendants when the approval is denied", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    const { engine, run } = startEngine(harness, gateWorkflow(harness), executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval");
    const approval = pendingApproval(harness, run.id);
    engine.decideApproval(approval.id, "denied");

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed");

    expect(getApproval(harness.db, approval.id)?.status).toBe("denied");
    expect(latestAttempt(harness, run.id, "gate").status).toBe("failed");
    expect(latestAttempt(harness, run.id, "b").status).toBe("skipped");
    expect(executor.calls).toHaveLength(0);
    expect(listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload)
      .toMatchObject({ errorCode: "APPROVAL_REQUIRED" });
    harness.db.close();
  });

  it("expires approvals past their TTL and fails the node", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    const { run } = startEngine(harness, gateWorkflow(harness), executor, {
      approvalTtlMs: 30,
    });

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);

    const approvals = listApprovals(harness.db, { runId: run.id });
    expect(approvals[0]?.status).toBe("expired");
    expect(latestAttempt(harness, run.id, "gate").status).toBe("failed");
    expect(latestAttempt(harness, run.id, "b").status).toBe("skipped");
    expect(
      listEvents(harness.db, run.id).some(
        (event) =>
          event.type === "approval.resolved" &&
          (event.payload as { decision?: string }).decision === "expired",
      ),
    ).toBe(true);
    harness.db.close();
  });

  it("keeps the run running while independent work is in flight, then waits", async () => {
    const harness = setup();
    // Node a hangs; the approval gate is independent of a.
    const aGate = new Deferred<{ outputs: Record<string, unknown> }>();
    const executor = new ScriptedExecutor();
    executor.enqueue(async () => aGate.promise); // a hangs
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id), approvalNode("gate")],
      [],
    );
    const { engine, run } = startEngine(harness, workflow, executor);

    await waitFor(() => latestAttempt(harness, run.id, "gate").status === "waiting_approval");
    // a is still executing: the run must NOT show waiting_approval yet.
    expect(getRun(harness.db, run.id)?.status).toBe("running");

    aGate.resolve({ outputs: {} });
    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval");

    const approval = pendingApproval(harness, run.id);
    engine.decideApproval(approval.id, "approved");
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");
    harness.db.close();
  });

  it("rejects deciding a stale approval after the node was retried", async () => {
    const harness = setup();
    // c hangs so the run stays active after the gate is denied.
    const cGate = new Deferred<{ outputs: Record<string, unknown> }>();
    const executor = new ScriptedExecutor();
    executor.enqueue(async () => cGate.promise); // c
    const workflow = makeWorkflowFixture(
      [approvalNode("gate"), botNode("b", harness.bot.id), botNode("c", harness.bot.id)],
      [makeEdge("gate", "o", "b", "i")],
    );
    const { engine, run } = startEngine(harness, workflow, executor);

    // c keeps executing, so the run itself stays running while the gate waits.
    await waitFor(() => latestAttempt(harness, run.id, "gate").status === "waiting_approval");
    const firstApproval = pendingApproval(harness, run.id);
    engine.decideApproval(firstApproval.id, "denied");
    await waitFor(() => latestAttempt(harness, run.id, "gate").status === "failed");
    expect(getRun(harness.db, run.id)?.status).toBe("running");

    const gateAttempt1 = latestAttempt(harness, run.id, "gate");
    engine.retryNode(run.id, gateAttempt1.id);
    await waitFor(() => latestAttempt(harness, run.id, "gate").status === "waiting_approval");

    // The denied approval from attempt 1 must not decide attempt 2.
    expectEngineError(
      () => engine.decideApproval(firstApproval.id, "approved"),
      "INVALID_INPUT",
      /superseded/,
    );

    const secondApproval = pendingApproval(harness, run.id);
    expect(secondApproval.id).not.toBe(firstApproval.id);
    engine.decideApproval(secondApproval.id, "approved");
    cGate.resolve({ outputs: {} });
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");
    harness.db.close();
  });

  it("rejects deciding an approval whose node already left the waiting state", async () => {
    const harness = setup();
    const cGate = new Deferred<{ outputs: Record<string, unknown> }>();
    const executor = new ScriptedExecutor();
    executor.enqueue(async () => cGate.promise); // c keeps the run active
    const workflow = makeWorkflowFixture(
      [approvalNode("gate"), botNode("c", harness.bot.id)],
      [],
    );
    const { engine, run } = startEngine(harness, workflow, executor, {
      approvalTtlMs: 30,
    });

    await waitFor(() => latestAttempt(harness, run.id, "gate").status === "failed");
    expect(getRun(harness.db, run.id)?.status).toBe("running");

    const approval = listApprovals(harness.db, { runId: run.id })[0];
    if (approval === undefined) {
      throw new Error("expected a recorded approval");
    }
    expectEngineError(
      () => engine.decideApproval(approval.id, "approved"),
      "INVALID_INPUT",
      /not waiting for a decision/,
    );
    cGate.resolve({ outputs: {} });
    await waitFor(() => getRun(harness.db, run.id)?.status === "failed");
    harness.db.close();
  });

  it("rejects decisions for unknown approvals and finished runs", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve();
    const { engine, run } = startEngine(harness, gateWorkflow(harness), executor);
    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval");

    expectEngineError(() => engine.decideApproval(randomUUID(), "approved"), "INVALID_INPUT");

    const approval = pendingApproval(harness, run.id);
    engine.decideApproval(approval.id, "approved");
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");

    expectEngineError(
      () => engine.decideApproval(approval.id, "denied"),
      "INVALID_INPUT",
    );
    harness.db.close();
  });
});
