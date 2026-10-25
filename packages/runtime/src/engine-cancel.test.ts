import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import type { Run, Workflow } from "@deepseek-bot/contracts";
import {
  getRun,
  listApprovals,
  listEvents,
  listNodeRuns,
} from "@deepseek-bot/storage";
import { NodeExecutionError } from "./executor.js";
import type {
  BotNodeExecutionContext,
  BotNodeExecutionResult,
  NodeExecutor,
} from "./executor.js";
import { WorkflowEngine, type WorkflowEngineOptions } from "./engine.js";
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

function startEngine(
  harness: Harness,
  workflow: Workflow,
  executor: NodeExecutor,
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

describe("cancellation", () => {
  it("aborts in-flight work, cancels the graph and is idempotent afterwards", async () => {
    const harness = setup();
    const executor = new AbortHangingExecutor();
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id), botNode("b", harness.bot.id)],
      [],
    );
    const { engine, run } = startEngine(harness, workflow, executor, { cancelGraceMs: 150 });

    await waitFor(() => latestAttempt(harness, run.id, "a").status === "running");
    const cancelledRun = await engine.cancelRun(run.id);
    await executor.abortSignal;

    expect(cancelledRun.status).toBe("cancelled");
    expect(cancelledRun.finishedAt).not.toBeNull();
    expect(latestAttempt(harness, run.id, "a").status).toBe("cancelled");
    expect(latestAttempt(harness, run.id, "b").status).toBe("cancelled");

    const events = listEvents(harness.db, run.id);
    expect(events.map((event) => event.type)).not.toContain("run.completed");
    expect(events.filter((event) => event.type === "run.statusChanged").at(-1)?.payload)
      .toMatchObject({ from: "cancelling", to: "cancelled", reason: "run cancelled" });

    // Repeated cancel returns the existing terminal state.
    const again = await engine.cancelRun(run.id);
    expect(again.status).toBe("cancelled");
    harness.db.close();
  });

  it("cancels pending nodes and expires pending approvals", async () => {
    const harness = setup();
    const executor = new AbortHangingExecutor();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id),
        approvalNode("gate"),
      ],
      [makeEdge("a", "o", "b", "i")],
    );
    const { engine, run } = startEngine(harness, workflow, executor, { cancelGraceMs: 150 });

    await waitFor(() => latestAttempt(harness, run.id, "gate").status === "waiting_approval");
    await engine.cancelRun(run.id);

    expect(latestAttempt(harness, run.id, "a").status).toBe("cancelled");
    expect(latestAttempt(harness, run.id, "b").status).toBe("cancelled");
    expect(latestAttempt(harness, run.id, "gate").status).toBe("cancelled");
    const approvals = listApprovals(harness.db, { runId: run.id });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.status).toBe("expired");
    expect(
      listEvents(harness.db, run.id).some(
        (event) =>
          event.type === "approval.resolved" &&
          (event.payload as { decision?: string }).decision === "expired",
      ),
    ).toBe(true);
    harness.db.close();
  });

  it("returns terminal state for later cancels and rejects unknown runs", async () => {
    const harness = setup();
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    const { engine, run } = startEngine(harness, workflow, new ScriptedExecutor().resolve());
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");

    const after = await engine.cancelRun(run.id);
    expect(after.status).toBe("succeeded");

    await expect(engine.cancelRun(randomUUID())).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    harness.db.close();
  });

  it("cancels during a retry backoff window without spawning the retry attempt", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().reject(
      new NodeExecutionError({
        code: "RATE_LIMITED",
        message: "429 slow down",
        retryAfterMs: 5,
      }),
    );
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id, { retryPolicy: { maxRetries: 1 } })],
      [],
    );
    const { engine, run } = startEngine(
      harness,
      workflow,
      executor,
      { retryBaseDelayMs: 60, cancelGraceMs: 150 },
    );

    await waitFor(() => latestAttempt(harness, run.id, "a").status === "failed");
    const cancelledRun = await engine.cancelRun(run.id);
    expect(cancelledRun.status).toBe("cancelled");

    // The pending retry timer must not spawn a new attempt afterwards.
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(listNodeRuns(harness.db, run.id)).toHaveLength(1);
    expect(latestAttempt(harness, run.id, "a").status).toBe("failed");
    harness.db.close();
  });

  it("force-cancels executors that ignore the abort signal and ignores late results", async () => {
    const harness = setup();
    class LateResolveExecutor implements NodeExecutor {
      executeBotNode(_context: BotNodeExecutionContext): Promise<BotNodeExecutionResult> {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ outputs: {} }), 80);
        });
      }
    }
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    const { engine, run } = startEngine(
      harness,
      workflow,
      new LateResolveExecutor(),
      { cancelGraceMs: 10 },
    );

    await waitFor(() => latestAttempt(harness, run.id, "a").status === "running");
    const cancelledRun = await engine.cancelRun(run.id);
    expect(cancelledRun.status).toBe("cancelled");

    // The executor resolves ~80ms later; the settled attempt must not flip.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(latestAttempt(harness, run.id, "a").status).toBe("cancelled");
    expect(getRun(harness.db, run.id)?.status).toBe("cancelled");
    harness.db.close();
  });
});
