/**
 * Engine-integrated tool permission tests (D08, QA-07/08).
 *
 * A scripted executor routes tool actions through the NodeExecutor port's
 * permission handle, exercising the full backend chain: policy check →
 * path constraints → exact-parameter events → one-time approval with
 * digest + boot generation binding → cancel/TTL paths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ToolPolicy, Workflow } from "@deepseek-bot/contracts";
import type { ToolActionRequest } from "./permissions/actions.js";
import {
  consumeApproval,
  createToolPolicy,
  getApproval,
  getApprovalGeneration,
  getRun,
  listApprovals,
  listEvents,
  listNodeRuns,
  StorageError,
} from "@deepseek-bot/storage";
import { EngineError } from "./errors.js";
import { WorkflowEngine, type WorkflowEngineOptions } from "./engine.js";
import type { Run } from "@deepseek-bot/contracts";
import {
  botNode,
  insertBot,
  insertWorkflow,
  makeBot,
  makeWorkflowFixture,
  makeTempRoot,
  openTestDatabase,
  ScriptedExecutor,
  seedProfileAndWorkspace,
  waitFor,
} from "./test-support.js";
import type { OpenedDatabase } from "@deepseek-bot/storage";

interface Harness {
  db: OpenedDatabase;
  bot: ReturnType<typeof makeBot>;
  workDir: string;
  policy: ToolPolicy;
}

async function setup(policyOverrides: Partial<ToolPolicy> = {}): Promise<Harness> {
  const db = openTestDatabase();
  const refs = seedProfileAndWorkspace(db);
  const workDir = fs.realpathSync(fs.mkdtempSync(path.join(makeTempRoot(), "perm-")));
  const workspaceId = randomUUID();
  const now = db.now().toISOString();
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
    )
    .run(
      workspaceId,
      workDir,
      JSON.stringify([{ scopePath: workDir, operations: ["read", "write"] }]),
      now,
      now,
    );
  const policy: ToolPolicy = {
    id: randomUUID(),
    revision: randomUUID(),
    name: "权限测试策略",
    filesystem: { enabled: true, operations: ["read", "write"] },
    shell: { mode: "disabled" },
    network: { mode: "disabled" },
    mcp: { enabled: false, requireApproval: false, servers: [] },
    ...policyOverrides,
  };
  createToolPolicy(db, policy);
  const bot = makeBot(refs, { workspaceId, toolPolicyId: policy.id });
  insertBot(db, bot);
  return { db, bot, workDir, policy };
}

/** Executor whose node attempt authorizes one tool action, then "acts". */
class AuthorizingExecutor extends ScriptedExecutor {
  readonly sideEffects: string[] = [];

  authorizeAndApply(action: ToolActionRequest): this {
    return this.enqueue(async (context) => {
      const authorized = await context.permissions.authorize(action);
      this.sideEffects.push(authorized.actionDigest);
      return { outputs: { digest: authorized.actionDigest } };
    });
  }
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

function singleNodeWorkflow(harness: Harness): Workflow {
  return makeWorkflowFixture([botNode("a", harness.bot.id)], []);
}

function pendingApproval(db: OpenedDatabase, runId: string) {
  const approval = listApprovals(db, { runId, status: "pending" })[0];
  if (approval === undefined) {
    throw new Error("no pending approval recorded");
  }
  return approval;
}

function nodeStatus(db: OpenedDatabase, runId: string, nodeId: string): string {
  const attempts = listNodeRuns(db, runId).filter((row) => row.nodeId === nodeId);
  return attempts.at(-1)?.status ?? "missing";
}

describe("pre-execution path constraints (QA-08)", () => {
  it("denies writes outside the workspace grants before any side effect", async () => {
    const harness = await setup();
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "file.write",
      callId: "call-1",
      toolName: "fs.write",
      path: path.join(os.tmpdir(), "dsb-perm-escape.txt"),
      arguments: { content: "hello" },
    });
    const { run } = startEngine(harness, singleNodeWorkflow(harness), executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);

    expect(nodeStatus(harness.db, run.id, "a")).toBe("failed");
    expect(executor.sideEffects).toHaveLength(0);
    expect(listApprovals(harness.db, { runId: run.id })).toHaveLength(0);
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload,
    ).toMatchObject({ errorCode: "UNAUTHORIZED_PATH" });
    // The exact attempted resource is visible in tool.requested (FR-06).
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "tool.requested")?.payload,
    ).toMatchObject({
      nodeRunId: expect.any(String),
      callId: "call-1",
      toolName: "fs.write",
      resource: expect.stringContaining("dsb-perm-escape.txt"),
    });
    harness.db.close();
  });

  it("resolves junction/dir-symlink escapes to the real target and denies them", async () => {
    const harness = await setup();
    const outside = fs.mkdtempSync(path.join(makeTempRoot(), "outside-"));
    fs.symlinkSync(outside, path.join(harness.workDir, "link"), "junction");
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "file.write",
      callId: "call-1",
      toolName: "fs.write",
      path: path.join(harness.workDir, "link", "secret.txt"),
    });
    const { run } = startEngine(harness, singleNodeWorkflow(harness), executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);

    expect(executor.sideEffects).toHaveLength(0);
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload,
    ).toMatchObject({ errorCode: "UNAUTHORIZED_PATH" });
    fs.rmSync(outside, { recursive: true, force: true });
    harness.db.close();
  });

  it("allows actions inside the granted workspace without any approval", async () => {
    const harness = await setup();
    const target = path.join(harness.workDir, "out.txt");
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "file.write",
      callId: "call-1",
      toolName: "fs.write",
      path: target,
      arguments: { content: "data" },
    });
    const { run } = startEngine(harness, singleNodeWorkflow(harness), executor);

    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded", 3_000);

    expect(executor.sideEffects).toHaveLength(1);
    expect(listApprovals(harness.db, { runId: run.id })).toHaveLength(0);
    harness.db.close();
  });
});

describe("one-time tool approvals (QA-07)", () => {
  const shellPolicy = { shell: { mode: "approval-required" } } as const;

  async function approvalHarness() {
    const harness = await setup(shellPolicy);
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "shell.exec",
      callId: "call-9",
      toolName: "shell",
      command: "del C:\\important.txt",
      arguments: { command: "del C:\\important.txt", cwd: harness.workDir },
    });
    const { engine, run } = startEngine(harness, singleNodeWorkflow(harness), executor);
    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval", 3_000);
    const approval = pendingApproval(harness.db, run.id);
    return { harness, executor, engine, run, approval };
  }

  it("pauses with exact parameters, resumes once on approval and consumes it", async () => {
    const { harness, executor, engine, run, approval } = await approvalHarness();

    expect(nodeStatus(harness.db, run.id, "a")).toBe("waiting_approval");
    expect(approval.resource).toBe("del C:\\important.txt");
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "tool.requested")?.payload,
    ).toMatchObject({
      toolName: "shell",
      resource: "del C:\\important.txt",
      arguments: { command: "del C:\\important.txt" },
    });

    engine.decideApproval(approval.id, "approved", approval.actionDigest);
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded", 3_000);

    // Exactly one side effect, one consumption, no leftover pending rows.
    expect(executor.sideEffects).toEqual([approval.actionDigest]);
    expect(getApproval(harness.db, approval.id)?.status).toBe("consumed");
    expect(listApprovals(harness.db, { runId: run.id, status: "pending" })).toHaveLength(0);
    expect(
      listEvents(harness.db, run.id).filter((event) => event.type === "approval.resolved"),
    ).toHaveLength(1);
    harness.db.close();
  });

  it("never executes when the user denies", async () => {
    const { harness, executor, engine, run, approval } = await approvalHarness();

    engine.decideApproval(approval.id, "denied", approval.actionDigest);
    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);

    expect(executor.sideEffects).toHaveLength(0);
    expect(getApproval(harness.db, approval.id)?.status).toBe("denied");
    expect(nodeStatus(harness.db, run.id, "a")).toBe("failed");
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload,
    ).toMatchObject({ errorCode: "APPROVAL_REQUIRED" });
    harness.db.close();
  });

  it("rejects decisions whose digest does not match the approved action", async () => {
    const { harness, engine, run, approval } = await approvalHarness();

    const wrongDigest = "f".repeat(64);
    try {
      engine.decideApproval(approval.id, "approved", wrongDigest);
      expect.fail("expected digest mismatch rejection");
    } catch (error) {
      expect((error as EngineError).code).toBe("INVALID_INPUT");
    }
    expect(getApproval(harness.db, approval.id)?.status).toBe("pending");
    expect(nodeStatus(harness.db, run.id, "a")).toBe("waiting_approval");

    // The correct digest still decides.
    engine.decideApproval(approval.id, "approved", approval.actionDigest);
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded", 3_000);
    harness.db.close();
  });

  it("expires tool approvals past their TTL without executing", async () => {
    const harness = await setup(shellPolicy);
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "shell.exec",
      callId: "c",
      toolName: "shell",
      command: "echo hi",
    });
    const { run } = startEngine(harness, singleNodeWorkflow(harness), executor, {
      approvalTtlMs: 30,
    });
    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);

    expect(executor.sideEffects).toHaveLength(0);
    expect(listApprovals(harness.db, { runId: run.id })[0]?.status).toBe("expired");
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload,
    ).toMatchObject({ errorCode: "APPROVAL_EXPIRED" });
    harness.db.close();
  });

  it("cancels a run while a tool approval is pending", async () => {
    const { harness, executor, engine, run } = await approvalHarness();

    await engine.cancelRun(run.id);
    await waitFor(() => getRun(harness.db, run.id)?.status === "cancelled", 3_000);

    expect(executor.sideEffects).toHaveLength(0);
    // No pending approval survives the run (expired by cancel).
    expect(listApprovals(harness.db, { runId: run.id, status: "pending" })).toHaveLength(0);
    expect(nodeStatus(harness.db, run.id, "a")).toBe("cancelled");
    harness.db.close();
  });
});

describe("boot generation and MCP authorization", () => {
  it("stamps approvals with the host boot generation", async () => {
    const harness = await setup({ shell: { mode: "approval-required" } });
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "shell.exec",
      callId: "c",
      toolName: "shell",
      command: "echo hi",
    });
    const { engine, run } = startEngine(harness, singleNodeWorkflow(harness), executor, {
      bootGeneration: 5,
    });
    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval", 3_000);
    const approval = pendingApproval(harness.db, run.id);
    expect(getApprovalGeneration(harness.db, approval.id)).toBe(5);

    // A consume attempt bound to a foreign generation is rejected.
    engine.decideApproval(approval.id, "approved", approval.actionDigest);
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded", 3_000);
    try {
      consumeApproval(harness.db, { id: approval.id, generation: 0 });
      expect.fail("expected foreign-generation rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
    }
    harness.db.close();
  });

  it("allows allowlisted MCP calls and denies unlisted tools", async () => {
    const harness = await setup({
      mcp: {
        enabled: true,
        requireApproval: false,
        servers: [{ serverId: "fs-mcp", allowedTools: ["list_files"] }],
      },
    });
    const allowed = new AuthorizingExecutor().authorizeAndApply({
      kind: "mcp.call",
      callId: "c1",
      toolName: "mcp",
      mcpServerId: "fs-mcp",
      mcpToolName: "list_files",
    });
    const { run } = startEngine(harness, singleNodeWorkflow(harness), allowed);
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded", 3_000);
    expect(allowed.sideEffects).toHaveLength(1);
    harness.db.close();
  });

  it("fails nodes calling MCP tools that are not allowlisted", async () => {
    const harness = await setup({
      mcp: {
        enabled: true,
        requireApproval: false,
        servers: [{ serverId: "fs-mcp", allowedTools: ["list_files"] }],
      },
    });
    const executor = new AuthorizingExecutor().authorizeAndApply({
      kind: "mcp.call",
      callId: "c2",
      toolName: "mcp",
      mcpServerId: "fs-mcp",
      mcpToolName: "wipe_disk",
    });
    const { run } = startEngine(harness, singleNodeWorkflow(harness), executor);
    await waitFor(() => getRun(harness.db, run.id)?.status === "failed", 3_000);
    expect(executor.sideEffects).toHaveLength(0);
    expect(
      listEvents(harness.db, run.id).find((event) => event.type === "run.failed")?.payload,
    ).toMatchObject({ errorCode: "UNAUTHORIZED_PATH" });
    harness.db.close();
  });
});

describe("tool approval run-status reconciliation", () => {
  it("shows waiting_approval only when independent work is done, then finishes after the decision", async () => {
    const harness = await setup({ shell: { mode: "approval-required" } });
    const executor = new ScriptedExecutor();
    executor.enqueue(async () => {
      // Node b: finishes immediately.
      return { outputs: {} };
    });
    executor.enqueue(async (context) => {
      await context.permissions.authorize({
        kind: "shell.exec",
        callId: "c",
        toolName: "shell",
        command: "echo gated",
      });
      return { outputs: {} };
    });
    const workflow = makeWorkflowFixture(
      [botNode("b", harness.bot.id), botNode("a", harness.bot.id)],
      [],
    );
    const { engine, run } = startEngine(harness, workflow, executor);

    // b succeeds while a waits: run shows waiting_approval (nothing runnable).
    await waitFor(() => getRun(harness.db, run.id)?.status === "waiting_approval", 3_000);
    expect(nodeStatus(harness.db, run.id, "b")).toBe("succeeded");
    expect(nodeStatus(harness.db, run.id, "a")).toBe("waiting_approval");

    const approval = pendingApproval(harness.db, run.id);
    engine.decideApproval(approval.id, "approved", approval.actionDigest);
    await waitFor(() => getRun(harness.db, run.id)?.status === "succeeded", 3_000);
    harness.db.close();
  });
});
