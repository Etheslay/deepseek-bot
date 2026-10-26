/**
 * NodeToolGate unit tests (D08): branches the engine-level suites cannot
 * reach — oversized arguments, inactive run, refused wait flip, evaluate
 * error mapping and waiter bookkeeping.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ToolPolicy } from "@deepseek-bot/contracts";
import {
  createNodeRun,
  createRun,
  decideApproval,
  getApproval,
  transitionNodeRun,
} from "@deepseek-bot/storage";
import { NodeExecutionError } from "./executor.js";
import { NodeToolGate, type NodeToolGateOptions } from "./permissions/gate.js";
import { RunEventEmitter } from "./run-events.js";
import {
  botNode,
  makeBot,
  makeWorkflowFixture,
  openTestDatabase,
  seedProfileAndWorkspace,
  waitFor,
} from "./test-support.js";

function makePolicy(): ToolPolicy {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    revision: "67676767-6767-4676-8767-676767676767",
    name: "gate 单测策略",
    filesystem: { enabled: true, operations: ["read", "write"] },
    shell: { mode: "approval-required" },
    network: { mode: "disabled" },
    mcp: { enabled: false, requireApproval: false, servers: [] },
  };
}

interface SeededRun {
  runId: string;
  nodeRunId: string;
}

function seedRunAndNodeRun(db: ReturnType<typeof openTestDatabase>): SeededRun {
  const refs = seedProfileAndWorkspace(db);
  const bot = makeBot(refs);
  const workflow = makeWorkflowFixture([botNode("a", bot.id)], []);
  const { run } = createRun(db, {
    id: randomUUID(),
    workflowSnapshot: workflow,
    botSnapshots: [bot],
    status: "queued",
    trigger: { kind: "manual", idempotencyKey: randomUUID() },
    createdAt: new Date().toISOString(),
    finishedAt: null,
  });
  const nodeRunId = randomUUID();
  createNodeRun(db, {
    id: nodeRunId,
    runId: run.id,
    nodeId: "a",
    attempt: 1,
    status: "pending",
    inputRefs: [],
    outputRefs: [],
    sessionId: null,
  });
  transitionNodeRun(db, { id: nodeRunId, to: "running" });
  return { runId: run.id, nodeRunId };
}

function makeGate(
  overrides: Partial<NodeToolGateOptions> = {},
): {
  gate: NodeToolGate;
  db: ReturnType<typeof openTestDatabase>;
  seeded: SeededRun;
  beginCalls: string[];
  endCalls: string[];
} {
  const beginCalls: string[] = [];
  const endCalls: string[] = [];
  const db = overrides.db ?? openTestDatabase();
  const seeded = seedRunAndNodeRun(db);
  const gate = new NodeToolGate({
    db,
    events: new RunEventEmitter(db, seeded.runId, () => new Date()),
    runId: seeded.runId,
    nodeRunId: seeded.nodeRunId,
    policy: makePolicy(),
    workspace: undefined,
    artifactsRoot: undefined,
    bootGeneration: 0,
    approvalTtlMs: 600_000,
    now: () => new Date(),
    isRunActive: () => true,
    beginApprovalWait: (nodeRunId, reason) => {
      beginCalls.push(`${nodeRunId}:${reason}`);
      return true;
    },
    endApprovalWait: (nodeRunId, reason) => {
      endCalls.push(`${nodeRunId}:${reason}`);
    },
    registerWaiter: () => undefined,
    unregisterWaiter: () => undefined,
    ...overrides,
  });
  return { gate, db, seeded, beginCalls, endCalls };
}

const shellAction = {
  kind: "shell.exec" as const,
  callId: "c1",
  toolName: "shell",
  command: "echo hi",
};

async function expectNodeError(promise: Promise<unknown>, code: string): Promise<NodeExecutionError> {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("expected ")) {
      throw error;
    }
    expect((error as NodeExecutionError).code).toBe(code);
    return error as NodeExecutionError;
  }
}

describe("NodeToolGate guards", () => {
  it("rejects oversized arguments before any policy work", async () => {
    const { gate } = makeGate();
    await expectNodeError(
      gate.authorize({
        ...shellAction,
        arguments: { blob: "x".repeat(1_100_000) },
      }),
      "INVALID_INPUT",
    );
  });

  it("refuses actions once the run is no longer active", async () => {
    const { gate, beginCalls } = makeGate({ isRunActive: () => false });
    await expectNodeError(gate.authorize(shellAction), "CANCELLED");
    expect(beginCalls).toHaveLength(0);
  });

  it("refuses actions when the node can no longer enter a wait", async () => {
    const { gate, beginCalls } = makeGate({
      beginApprovalWait: (nodeRunId, reason) => {
        beginCalls.push(`${nodeRunId}:${reason}`);
        return false;
      },
    });
    await expectNodeError(gate.authorize(shellAction), "CANCELLED");
    expect(beginCalls).toHaveLength(1);
  });

  it("maps invalid paths to INVALID_INPUT decisions in evaluate", async () => {
    const { gate } = makeGate();
    expect(
      await gate.evaluate({ kind: "file.read", callId: "c", toolName: "fs", path: "relative.txt" }),
    ).toMatchObject({ effect: "deny", code: "INVALID_INPUT" });
    // Shell evaluation needs no canonicalization.
    expect(await gate.evaluate(shellAction)).toMatchObject({ effect: "approval-required" });
  });

  it("reports unknown waiters and cleans up on settle", () => {
    const { gate } = makeGate();
    expect(gate.settleWait("unknown-id", { kind: "cancelled" })).toBe(false);
    expect(gate.pendingApprovalIds()).toHaveLength(0);
  });

  it("refuses an approved action when the run went inactive before consumption", async () => {
    let active = true;
    const { gate, db, seeded, endCalls } = makeGate({
      isRunActive: () => active,
    });
    const pending = gate.authorize(shellAction);
    await waitFor(() => gate.pendingApprovalIds().length > 0);
    const approvalId = gate.pendingApprovalIds()[0];
    if (approvalId === undefined) {
      throw new Error("expected a registered waiter");
    }
    decideApproval(db, { id: approvalId, decision: "approved" });
    // The run starts cancelling before the gate consumes the approval.
    active = false;
    gate.settleWait(approvalId, { kind: "approved" });
    await expectNodeError(pending, "CANCELLED");
    expect(endCalls).toHaveLength(0);
    // The approval stays approved-but-unconsumed; the run sweep handles it.
    expect(getApproval(db, approvalId)?.status).toBe("approved");
    void seeded;
  });

  it("treats a cancelled wait as a cancelled action", async () => {
    const { gate, db } = makeGate();
    const pending = gate.authorize(shellAction);
    await waitFor(() => gate.pendingApprovalIds().length > 0);
    const approvalId = gate.pendingApprovalIds()[0];
    if (approvalId === undefined) {
      throw new Error("expected a registered waiter");
    }
    gate.settleWait(approvalId, { kind: "cancelled" });
    await expectNodeError(pending, "CANCELLED");
    // The storage row stays pending until cancel expiry sweeps it.
    expect(getApproval(db, approvalId)?.status).toBe("pending");
  });

  it("leaves already-decided approvals alone when the TTL timer fires", async () => {
    // The TTL has to survive the gap between `authorize` and the direct
    // `decideApproval` below, which is wall-clock time on a loaded CI runner.
    // A 20 ms window loses that race (the approval expires first and
    // `decideApproval` throws APPROVAL_EXPIRED), so the margin is 500 ms and
    // the wait below stays past it to still fire the TTL timer. Do not shrink
    // these two numbers together — the gap is what makes the case stable.
    const ttlMs = 500;
    const { gate, db, seeded } = makeGate({ approvalTtlMs: ttlMs });
    const pending = gate.authorize(shellAction);
    await waitFor(() => gate.pendingApprovalIds().length > 0);
    const approvalId = gate.pendingApprovalIds()[0];
    if (approvalId === undefined) {
      throw new Error("expected a registered waiter");
    }
    // Decide directly in storage (as a concurrent decide would), then let
    // the TTL timer fire on a non-pending approval: no settle, no expiry.
    decideApproval(db, { id: approvalId, decision: "approved" });
    await waitFor(() => gate.pendingApprovalIds().length >= 0, 100);
    await new Promise((resolve) => setTimeout(resolve, ttlMs + 100));
    expect(getApproval(db, approvalId)?.status).toBe("approved");
    expect(gate.pendingApprovalIds()).toContain(approvalId);
    void pending;
    void seeded;
  });
});
