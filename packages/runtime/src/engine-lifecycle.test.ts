import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import {
  getRun,
  listEvents,
  listNodeRuns,
  saveWorkflow,
} from "@deepseek-bot/storage";
import { isSequenceMonotonic, type Run, type Workflow } from "@deepseek-bot/contracts";
import { EngineError } from "./errors.js";
import { WorkflowEngine, type WorkflowEngineOptions } from "./index.js";
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
  bot: ReturnType<typeof makeBot>;
}

function setup(): Harness {
  const db = openTestDatabase();
  const refs = seedProfileAndWorkspace(db);
  const bot = makeBot(refs);
  insertBot(db, bot);
  return { db, bot };
}

function startRun(
  harness: Harness,
  workflow: Workflow,
  executor: ScriptedExecutor,
  engineOptions: Partial<WorkflowEngineOptions> = {},
): { engine: WorkflowEngine; run: Run; created: boolean } {
  insertWorkflow(harness.db, workflow);
  const engine = new WorkflowEngine({
    db: harness.db,
    executor,
    ...engineOptions,
  });
  const started = engine.startRun({
    workflowId: workflow.id,
    trigger: { kind: "manual", idempotencyKey: randomUUID() },
  });
  return { engine, ...started };
}

function latestNodeRun(harness: Harness, runId: string, nodeId: string) {
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

function runCount(db: OpenedDatabase): number {
  return (db.raw.prepare("SELECT COUNT(*) AS count FROM runs;").get() as { count: number })
    .count;
}

function insertArchivedBot(harness: Harness): string {
  const id = randomUUID();
  const now = harness.db.now().toISOString();
  harness.db.raw
    .prepare(
      "INSERT INTO bots (id, revision, name, instructions, model_profile_id, workspace_id, " +
        "tool_policy_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    )
    .run(
      id,
      randomUUID(),
      "已归档机器人",
      "归档后不可执行。",
      harness.bot.modelProfileId,
      harness.bot.workspaceId,
      randomUUID(),
      "2026-10-24T00:00:00.000Z",
      now,
      now,
    );
  return id;
}

describe("workflow engine lifecycle", () => {
  it("starts a run, executes a sequential chain in order and propagates inputs", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve({ draft: "v1" }).resolve();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id, {
          inputBindings: [{ inputKey: "draft", required: true }],
        }),
        botNode("c", harness.bot.id),
      ],
      [makeEdge("a", "draft", "b", "draft"), makeEdge("b", "o", "c", "i")],
    );
    const { run } = startRun(harness, workflow, executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");

    expect(executor.calls.map((call) => call.nodeId)).toEqual(["a", "b", "c"]);
    // Input isolation: b only sees what its edge maps, c sees nothing.
    expect(executor.calls[1]?.inputs).toEqual({ draft: "v1" });
    expect(executor.calls[2]?.inputs).toEqual({});

    expect(listEvents(harness.db, run.id).map((event) => event.type)).toEqual([
      "run.created",
      "run.statusChanged",
      "node.statusChanged",
      "node.statusChanged",
      "node.statusChanged",
      "node.statusChanged",
      "node.statusChanged",
      "node.statusChanged",
      "run.statusChanged",
      "run.completed",
    ]);
    expect(isSequenceMonotonic(listEvents(harness.db, run.id))).toBe(true);
    harness.db.close();
  });

  it("respects the configured concurrency limit for independent branches", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id),
        botNode("c", harness.bot.id),
        botNode("d", harness.bot.id),
      ],
      [
        makeEdge("a", "out", "b", "in"),
        makeEdge("a", "out", "c", "in"),
        makeEdge("b", "out", "d", "in"),
        makeEdge("c", "out", "d", "in"),
      ],
      { maxConcurrentNodes: 1 },
    );
    const gate = new Promise<void>(() => {});
    // a resolves immediately, then b hangs until the test ends.
    executor.enqueue(async () => {
      await gate;
      return { outputs: {} };
    });
    const { run } = startRun(harness, workflow, executor);

    await waitFor(() => executor.calls.length === 2);
    // Limit 1: b runs alone while c and d wait.
    expect(executor.calls[1]?.nodeId).toBe("b");
    expect(latestNodeRun(harness, run.id, "b").status).toBe("running");
    expect(latestNodeRun(harness, run.id, "c").status).toBe("pending");
    expect(latestNodeRun(harness, run.id, "d").status).toBe("pending");
    harness.db.close();
  });

  it("runs independent branches in parallel up to the limit", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id),
        botNode("c", harness.bot.id),
        botNode("d", harness.bot.id),
      ],
      [
        makeEdge("a", "out", "b", "in"),
        makeEdge("a", "out", "c", "in"),
        makeEdge("b", "out", "d", "in"),
        makeEdge("c", "out", "d", "in"),
      ],
      { maxConcurrentNodes: 2 },
    );
    const gate = new Promise<void>(() => {});
    // b and c hang concurrently after a completes.
    executor.enqueue(async () => {
      await gate;
      return { outputs: {} };
    });
    executor.enqueue(async () => {
      await gate;
      return { outputs: {} };
    });
    const { run } = startRun(harness, workflow, executor);

    await waitFor(() => executor.calls.length === 3);
    expect(latestNodeRun(harness, run.id, "b").status).toBe("running");
    expect(latestNodeRun(harness, run.id, "c").status).toBe("running");
    expect(latestNodeRun(harness, run.id, "d").status).toBe("pending");
    harness.db.close();
  });

  it("deduplicates duplicate submissions by idempotencyKey", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve();
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    insertWorkflow(harness.db, workflow);
    const engine = new WorkflowEngine({ db: harness.db, executor });
    const trigger = { kind: "manual" as const, idempotencyKey: randomUUID() };

    const first = engine.startRun({ workflowId: workflow.id, trigger });
    const second = engine.startRun({ workflowId: workflow.id, trigger });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    // Only one execution: a single dispatch for the single node.
    expect(executor.calls).toHaveLength(1);
    await waitFor(() => getRun(harness.db, first.run.id)?.status === "succeeded");
    harness.db.close();
  });

  it("executes the immutable snapshot even if the workflow changes later", async () => {
    const harness = setup();
    const executor = new ScriptedExecutor().resolve();
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    const { run, created } = startRun(harness, workflow, executor);
    expect(created).toBe(true);

    // Mutate the stored workflow after the run started.
    saveWorkflow(
      harness.db,
      {
        ...workflow,
        nodes: [
          botNode("a", harness.bot.id, { instructionTemplate: "changed instruction" }),
        ],
      },
      { expectedRevision: workflow.revision },
    );

    expect(getRun(harness.db, run.id)?.workflowSnapshot.revision).toBe(workflow.revision);
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded");
    expect(executor.calls[0]?.instruction).toBe("node a instruction");
    harness.db.close();
  });
});

describe("workflow engine start validation", () => {
  it("rejects unknown workflows", () => {
    const harness = setup();
    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    expectEngineError(
      () =>
        engine.startRun({
          workflowId: randomUUID(),
          trigger: { kind: "manual", idempotencyKey: randomUUID() },
        }),
      "INVALID_INPUT",
      /not found/,
    );
    harness.db.close();
  });

  it("rejects cyclic graphs with WORKFLOW_CYCLE before creating a run", () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    const workflow = makeWorkflowFixture(
      [botNode("a", harness.bot.id), botNode("b", harness.bot.id)],
      [makeEdge("a", "o", "b", "i"), makeEdge("b", "o", "a", "i")],
    );
    insertWorkflow(harness.db, workflow);
    const engine = new WorkflowEngine({ db: harness.db, executor });
    expectEngineError(
      () =>
        engine.startRun({
          workflowId: workflow.id,
          trigger: { kind: "manual", idempotencyKey: randomUUID() },
        }),
      "WORKFLOW_CYCLE",
    );
    expect(runCount(harness.db)).toBe(0);
    harness.db.close();
  });

  it("rejects required bindings without an incoming edge with MISSING_BINDING", () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    const workflow = makeWorkflowFixture(
      [
        botNode("a", harness.bot.id),
        botNode("b", harness.bot.id, {
          inputBindings: [{ inputKey: "missing", required: true }],
        }),
      ],
      [],
    );
    insertWorkflow(harness.db, workflow);
    const engine = new WorkflowEngine({ db: harness.db, executor });
    expectEngineError(
      () =>
        engine.startRun({
          workflowId: workflow.id,
          trigger: { kind: "manual", idempotencyKey: randomUUID() },
        }),
      "MISSING_BINDING",
    );
    harness.db.close();
  });

  it("rejects missing and archived bots", () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    const missing = makeWorkflowFixture([botNode("a", randomUUID())], []);
    insertWorkflow(harness.db, missing);
    const archivedBotId = insertArchivedBot(harness);
    const archived = makeWorkflowFixture([botNode("a", archivedBotId)], []);
    insertWorkflow(harness.db, archived);
    const engine = new WorkflowEngine({ db: harness.db, executor });

    expectEngineError(
      () =>
        engine.startRun({
          workflowId: missing.id,
          trigger: { kind: "manual", idempotencyKey: randomUUID() },
        }),
      "INVALID_INPUT",
      /bot not found/,
    );
    expectEngineError(
      () =>
        engine.startRun({
          workflowId: archived.id,
          trigger: { kind: "manual", idempotencyKey: randomUUID() },
        }),
      "INVALID_INPUT",
      /archived/,
    );
    harness.db.close();
  });

  it("rejects duplicate node ids with the generic INVALID_INPUT fallback", () => {
    const harness = setup();
    const executor = new ScriptedExecutor();
    const node = botNode("a", harness.bot.id);
    const workflow = makeWorkflowFixture([node, node], []);
    insertWorkflow(harness.db, workflow);
    const engine = new WorkflowEngine({ db: harness.db, executor });
    expectEngineError(
      () =>
        engine.startRun({
          workflowId: workflow.id,
          trigger: { kind: "manual", idempotencyKey: randomUUID() },
        }),
      "INVALID_INPUT",
      /validation failed/,
    );
    harness.db.close();
  });

  it("rejects schedule triggers without schedule identity", () => {
    const harness = setup();
    const workflow = makeWorkflowFixture([botNode("a", harness.bot.id)], []);
    insertWorkflow(harness.db, workflow);
    const engine = new WorkflowEngine({
      db: harness.db,
      executor: new ScriptedExecutor(),
    });
    expectEngineError(
      () =>
        engine.startRun({
          workflowId: workflow.id,
          trigger: { kind: "schedule", idempotencyKey: randomUUID() },
        }),
      "INVALID_INPUT",
    );
    harness.db.close();
  });
});
