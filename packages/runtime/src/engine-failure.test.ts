import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import type { Run, Workflow } from "@deepseek-bot/contracts";
import { getRun, listEvents, listNodeRuns } from "@deepseek-bot/storage";
import { EngineError } from "./errors.js";
import { NodeExecutionError, type NodeExecutor } from "./executor.js";
import { WorkflowEngine, type WorkflowEngineOptions } from "./engine.js";
import {
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
  executor: NodeExecutor,
  engineOptions: Partial<WorkflowEngineOptions> = {},
): { engine: WorkflowEngine; run: Run } {
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

function attemptsFor(harness: Harness, runId: string, nodeId: string) {
  return listNodeRuns(harness.db, runId).filter((nodeRun) => nodeRun.nodeId === nodeId);
}

function latestAttempt(harness: Harness, runId: string, nodeId: string) {
  const latest = attemptsFor(harness, runId, nodeId).at(-1);
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

describe("failure policy", () => {
  it("stops descendants on failure while independent branches complete", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor()
      .reject(
        new NodeExecutionError({
          code: "AUTH_FAILED",
          message: "invalid api key",
          retryable: false,
        }),
      )
      .resolve();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id),
        botNode("c", harness.bot.id),
        botNode("d", harness.bot.id),
      ],
      [makeEdge("a", "o", "b", "i"), makeEdge("b", "o", "c", "i")],
    );
    insertWorkflow(harness.db, workflow);
    const { run } = startEngine(harness, workflow, executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed");

    expect(getRun(harness.db, run.id)?.finishedAt).not.toBeNull();
    expect(latestAttempt(harness, run.id, "a").status).toBe("failed");
    expect(latestAttempt(harness, run.id, "b").status).toBe("skipped");
    expect(latestAttempt(harness, run.id, "c").status).toBe("skipped");
    expect(latestAttempt(harness, run.id, "d").status).toBe("succeeded");
    // a and d each ran exactly once.
    expect(executor.calls.map((call) => call.nodeId)).toEqual(["a", "d"]);

    const events = listEvents(harness.db, run.id);
    expect(events.find((event) => event.type === "run.failed")?.payload).toMatchObject({
      reason: "AUTH_FAILED: invalid api key",
      errorCode: "AUTH_FAILED",
    });
    const skippedEvent = events.find(
      (event) =>
        event.type === "node.statusChanged" &&
        (event.payload as { nodeId?: string }).nodeId === "b",
    );
    expect(skippedEvent?.payload).toMatchObject({ from: "pending", to: "skipped" });
    harness.db.close();
  });

  it("retries retryable failures within the node's retry policy", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor()
      .reject(
        new NodeExecutionError({
          code: "RATE_LIMITED",
          message: "429 slow down",
          retryAfterMs: 5,
        }),
      )
      .reject(new NodeExecutionError({ code: "RATE_LIMITED", message: "429 slow down" }))
      .resolve({ o: "v" });
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id, { retryPolicy: { maxRetries: 2 } }),
        botNode("b", harness.bot.id, {
          inputBindings: [{ inputKey: "i", required: true }],
        }),
      ],
      [makeEdge("a", "o", "b", "i")],
    );
    insertWorkflow(harness.db, workflow);
    const { run } = startEngine(harness, workflow, executor, {
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
    });

    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");

    const attempts = attemptsFor(harness, run.id, "a");
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "failed",
      "succeeded",
    ]);
    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
    // a ran three times; b ran once after a finally succeeded.
    expect(executor.calls.filter((call) => call.nodeId === "a")).toHaveLength(3);
    expect(executor.calls.filter((call) => call.nodeId === "b")).toHaveLength(1);
    expect(latestAttempt(harness, run.id, "b").status).toBe("succeeded");
    harness.db.close();
  });

  it("does not retry non-retryable failures even with retries allowed", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().reject(
      new NodeExecutionError({
        code: "AUTH_FAILED",
        message: "invalid api key",
        retryable: false,
      }),
    );
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id, { retryPolicy: { maxRetries: 2 } })],
      [],
    );
    insertWorkflow(harness.db, workflow);
    const { run } = startEngine(harness, workflow, executor, { retryBaseDelayMs: 10 });

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed");

    expect(attemptsFor(harness, run.id, "a")).toHaveLength(1);
    expect(executor.calls).toHaveLength(1);
    harness.db.close();
  });

  it("fails the attempt with TOOL_TIMEOUT when the configured timeout elapses", async () => {
    const harness = setup();
    // HangingExecutor never settles, so only the engine timer can finish it.
    const executor = new HangingExecutorStub();
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id, { timeoutSeconds: 1 })],
      [],
    );
    insertWorkflow(harness.db, workflow);
    const { run } = startEngine(harness, workflow, executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);

    expect(latestAttempt(harness, run.id, "a").status).toBe("failed");
    const events = listEvents(harness.db, run.id);
    expect(events.find((event) => event.type === "run.failed")?.payload).toMatchObject({
      errorCode: "TOOL_TIMEOUT",
    });
    harness.db.close();
  }, 10_000);
});

describe("explicit node retry (run.retryNode)", () => {
  it("retries a failed node while the run is still active", async () => {
    const harness = setup();
    // Dispatch order at start: a, then c. a fails; c hangs on a gate to keep
    // the run active (stop-descendants only skips at finalization).
    const cGate = new Deferred<{ outputs: Record<string, unknown> }>();
    const executor = new ScriptedExecutor().reject(
      new NodeExecutionError({
        code: "AUTH_FAILED",
        message: "invalid api key",
        retryable: false,
      }),
    );
    executor.enqueue(async () => cGate.promise); // c
    executor.resolve({ o: "v" }); // a attempt 2 — feeds b's required binding
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id, {
          inputBindings: [{ inputKey: "i", required: true }],
        }),
        botNode("c", harness.bot.id),
      ],
      [makeEdge("a", "o", "b", "i")],
    );
    insertWorkflow(harness.db, workflow);
    const { engine, run } = startEngine(harness, workflow, executor);

    await waitFor(() => latestAttempt(harness, run.id, "a").status === "failed");
    expect(getRun(harness.db, run.id)?.status).toBe("running");

    const failedAttempt = latestAttempt(harness, run.id, "a");
    const retried = engine.retryNode(run.id, failedAttempt.id);
    expect(retried.attempt).toBe(2);
    cGate.resolve({ outputs: {} });

    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");
    expect(attemptsFor(harness, run.id, "a").map((attempt) => attempt.status)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(latestAttempt(harness, run.id, "b").status).toBe("succeeded");
    expect(latestAttempt(harness, run.id, "c").status).toBe("succeeded");
    harness.db.close();
  });

});

describe("executor failure handling", () => {
  it("treats a synchronously throwing executor as a retryable runtime failure", async () => {
    const harness = setup();
    class ThrowingExecutor {
      calls = 0;
      executeBotNode(): Promise<{ outputs: Record<string, unknown> }> {
        this.calls += 1;
        if (this.calls === 1) {
          throw new Error("executor exploded synchronously");
        }
        return Promise.resolve({ outputs: {} });
      }
    }
    const executor = new ThrowingExecutor();
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id, { retryPolicy: { maxRetries: 1 } })],
      [],
    );
    insertWorkflow(harness.db, workflow);
    const { run } = startEngine(harness, workflow, executor as never, {
      retryBaseDelayMs: 5,
    });

    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");
    expect(executor.calls).toBe(2);
    harness.db.close();
  });

  it("stringifies non-Error executor rejections into the failure reason", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    executor.enqueue(async () => {
      throw "total meltdown"; // non-Error rejection from a badly behaved executor
    });
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    insertWorkflow(harness.db, workflow);
    const { run } = startEngine(harness, workflow, executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed");
    expect(latestAttempt(harness, run.id, "a").status).toBe("failed");
    expect(listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload)
      .toMatchObject({ errorCode: "RUNTIME_UNAVAILABLE" });
    harness.db.close();
  });

  it("rejects node runs that belong to a different run", async () => {
    const harness = setup();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id, {
          inputBindings: [{ inputKey: "i", required: true }],
        }),
      ],
      [makeEdge("a", "o", "b", "i")],
    );
    insertWorkflow(harness.db, workflow);

    // Run A stays active: a succeeds, b hangs on a gate.
    const gate = new Deferred<{ outputs: Record<string, unknown> }>();
    const scriptedA = new ScriptedExecutor().resolve({ o: "v" });
    scriptedA.enqueue(async () => gate.promise);
    const engineA = new WorkflowEngine({ db: harness.db, executor: scriptedA });
    const runA = engineA
      .startRun({
        workflowId: workflow.id,
        trigger: { kind: "manual", idempotencyKey: randomUUID() },
      })
      .run;
    await waitFor(() => latestAttempt(harness, runA.id, "b").status === "running");

    const engineB = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor().resolve({ o: "v" }),
    });
    const runB = engineB
      .startRun({
        workflowId: workflow.id,
        trigger: { kind: "manual", idempotencyKey: randomUUID() },
      })
      .run;
    await waitFor(() => getRun(harness.db, runB.id)?.status === "succeeded");

    const foreignAttempt = latestAttempt(harness, runB.id, "a");
    expectEngineError(
      () => engineA.retryNode(runA.id, foreignAttempt.id),
      "INVALID_INPUT",
      /not found in this run/,
    );
    harness.db.close();
  });
  it("rejects retrying terminal runs and non-failed attempts", async () => {
    const harness = setup();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id, {
          inputBindings: [{ inputKey: "i", required: true }],
        }),
      ],
      [makeEdge("a", "o", "b", "i")],
    );
    insertWorkflow(harness.db, workflow);

    const failing = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor().reject(
        new NodeExecutionError({
          code: "AUTH_FAILED",
          message: "invalid api key",
          retryable: false,
        }),
      ),
    });
    const failedRun = failing
      .startRun({
        workflowId: workflow.id,
        trigger: { kind: "manual", idempotencyKey: randomUUID() },
      })
      .run;
    await waitFor(() => getRun(harness.db, failedRun.id)?.status === "failed");

    const failedAttempt = latestAttempt(harness, failedRun.id, "a");
    expectEngineError(
      () => failing.retryNode(failedRun.id, failedAttempt.id),
      "INVALID_INPUT",
      /terminal runs/,
    );

    // An active run with a succeeded node: retrying the succeeded attempt
    // is rejected while the run is still executing downstream.
    const gate = new Deferred<{ outputs: Record<string, unknown> }>();
    const scriptedForActive = new ScriptedExecutor().resolve({ o: "v" });
    scriptedForActive.enqueue(async () => gate.promise); // b hangs
    const activeEngine = new WorkflowEngine({ db: harness.db, executor: scriptedForActive });
    const activeRun = activeEngine
      .startRun({
        workflowId: workflow.id,
        trigger: { kind: "manual", idempotencyKey: randomUUID() },
      })
      .run;
    await waitFor(() => latestAttempt(harness, activeRun.id, "b").status === "running");

    const succeededAttempt = latestAttempt(harness, activeRun.id, "a");
    expectEngineError(
      () => activeEngine.retryNode(activeRun.id, succeededAttempt.id),
      "INVALID_INPUT",
      /only failed/,
    );
    harness.db.close();
  });
});

/** Executor whose promises never settle (timeout / grace paths). */
class HangingExecutorStub implements NodeExecutor {
  executeBotNode(): Promise<{ outputs: Record<string, unknown> }> {
    return new Promise(() => {});
  }
}
