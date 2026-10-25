/**
 * Workflow engine facade (D06, FR-05/07 backend).
 *
 * The Host owns exactly one engine per storage database. startRun validates
 * the workflow graph and bot availability BEFORE persisting anything
 * (ARCHITECTURE.md §3), snapshots the workflow and its bots into the
 * immutable Run record, and deduplicates submissions by idempotencyKey
 * (CONTRACTS §3). Runs found active in storage without a live execution are
 * interrupted by recoverInterruptedRuns at host startup; resuming them is a
 * new Run linked via resumedFromRunId (resumeRun, D10).
 */
import { randomUUID } from "node:crypto";
import {
  isRunTerminal,
  RunTriggerSchema,
  validateWorkflowDraft,
  type Bot,
  type NodeRun,
  type Run,
  type ToolPolicy,
  type Workspace,
} from "@deepseek-bot/contracts";
import {
  ACTIVE_RUN_STATUSES,
  createRun,
  expireApprovalsForRun,
  getApproval,
  getBot,
  getNodeRunOutputs,
  getRun,
  getToolPolicy,
  getWorkflow,
  getWorkspace,
  listApprovals,
  listNodeRuns,
  listRuns,
  transitionNodeRun,
  transitionRun,
  type ApprovalDecision,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import type { NodeExecutor } from "./executor.js";
import { invalidInput, workflowIssueError } from "./errors.js";
import { RunEventEmitter } from "./run-events.js";
import {
  RunExecution,
  type ResumeSeed,
  type ResumeSeedEntry,
  type RunExecutionOptions,
} from "./run-execution.js";

export interface WorkflowEngineOptions {
  readonly db: OpenedDatabase;
  readonly executor: NodeExecutor;
  readonly now?: () => Date;
  readonly approvalTtlMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly cancelGraceMs?: number;
  /**
   * Host boot generation (CONTRACTS §2: 启动代次绑定). The Host increments
   * the persisted generation once per process (storage
   * `incrementBootGeneration`) and passes the value here; approvals created
   * by this engine bind to it and decisions for foreign generations are
   * rejected (FR-06: 重启后旧审批不能直接重放). Defaults to 0.
   */
  readonly bootGeneration?: number;
  /** Canonical artifact directory granted to file tools (D08). */
  readonly artifactsRoot?: string;
}

export interface StartRunInput {
  readonly workflowId: string;
  readonly trigger: {
    readonly kind: "manual" | "schedule";
    readonly idempotencyKey: string;
    readonly scheduleId?: string;
    readonly occurrenceUtc?: string;
  };
}

export interface RecoveryResult {
  readonly runId: string;
  readonly interruptedNodeRuns: number;
  readonly expiredApprovals: number;
}

export interface RetryNodeResult {
  readonly nodeRunId: string;
  readonly attempt: number;
}

export class WorkflowEngine {
  private readonly executions = new Map<string, RunExecution>();

  constructor(private readonly options: WorkflowEngineOptions) {}

  /**
   * Validate, snapshot and start a run. A duplicate idempotencyKey returns
   * the existing run without executing anything (created: false).
   */
  startRun(input: StartRunInput): { run: Run; created: boolean } {
    const db = this.options.db;
    const workflow = getWorkflow(db, input.workflowId);
    if (workflow === undefined) {
      throw invalidInput("workflow not found", { workflowId: input.workflowId });
    }
    // Re-validate the graph at start (CONTRACTS §3 workflow.validate); the
    // snapshot re-validated inside the execution as well.
    const issues = validateWorkflowDraft(workflow);
    if (issues.length > 0) {
      throw workflowIssueError(issues);
    }

    const botIds = new Set<string>();
    for (const node of workflow.nodes) {
      if (node.type === "bot" && node.botId !== undefined) {
        botIds.add(node.botId);
      }
    }
    const bots: Bot[] = [];
    for (const botId of botIds) {
      const bot = getBot(db, botId);
      if (bot === undefined) {
        throw invalidInput("bot not found for workflow node", { botId });
      }
      if (bot.archivedAt !== null) {
        throw invalidInput("archived bots cannot start new executions", { botId });
      }
      bots.push(bot);
    }

    // Resolve and pin permission inputs for the whole run (ARCHITECTURE §6:
    // mid-run policy/workspace edits never affect a running run).
    const permissionPins = this.resolvePermissionPins(bots);

    const trigger = RunTriggerSchema.safeParse(input.trigger);
    if (!trigger.success) {
      throw invalidInput("invalid run trigger", {
        issues: trigger.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });
    }

    const now = this.options.now ?? (() => new Date());
    const { run, created } = createRun(db, {
      id: randomUUID(),
      workflowSnapshot: workflow,
      botSnapshots: bots,
      status: "queued",
      trigger: trigger.data,
      createdAt: now().toISOString(),
      finishedAt: null,
    });
    if (!created) {
      return { run, created: false };
    }

    const execution = new RunExecution(
      this.executionOptions(run, permissionPins),
    );
    this.executions.set(run.id, execution);
    execution.start();
    const started = getRun(db, run.id);
    return { run: started ?? run, created: true };
  }

  /**
   * Cancel a run. Repeated calls return the existing terminal state
   * (CONTRACTS §3 run.cancel); cancelling runs drain asynchronously.
   */
  async cancelRun(runId: string): Promise<Run> {
    const execution = this.activeExecution(runId);
    if (execution !== undefined) {
      return execution.cancel();
    }
    const run = getRun(this.options.db, runId);
    if (run === undefined) {
      throw invalidInput("run not found", { runId });
    }
    if (isRunTerminal(run.status)) {
      return run;
    }
    throw invalidInput("run is not active in this host", {
      runId,
      status: run.status,
    });
  }

  /**
   * Apply an approval decision for an active run (CONTRACTS §3). The caller
   * must echo the approval's actionDigest from the approval.requested event;
   * a mismatch or a foreign boot generation is rejected.
   */
  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    expectedActionDigest: string,
  ): void {
    const db = this.options.db;
    const approval = getApproval(db, approvalId);
    if (approval === undefined) {
      throw invalidInput("approval not found", { approvalId });
    }
    const execution = this.activeExecution(approval.runId);
    if (execution === undefined) {
      throw invalidInput("approval's run is not active in this host", {
        runId: approval.runId,
      });
    }
    execution.decideApproval(approvalId, decision, expectedActionDigest);
  }

  /**
   * Retry a failed node attempt while its run is still active. Terminal runs
   * recover through a new Run with resumedFromRunId (CONTRACTS §5) — the
   * explicit error points callers there.
   */
  retryNode(runId: string, nodeRunId: string): RetryNodeResult {
    const execution = this.activeExecution(runId);
    if (execution === undefined) {
      const run = getRun(this.options.db, runId);
      if (run !== undefined && isRunTerminal(run.status)) {
        throw invalidInput("terminal runs recover through a new run", {
          runId,
          status: run.status,
        });
      }
      throw invalidInput("run is not active in this host", { runId });
    }
    const retried = execution.retryNode(nodeRunId);
    return { nodeRunId: retried.id, attempt: retried.attempt };
  }

  /**
   * Host-startup recovery (QA-09): runs still active in storage belong to a
   * dead host process. Their unfinished node runs become interrupted,
   * pending approvals expire and run.interrupted is persisted; consumers
   * replay events by afterSequence and deduplicate by eventId.
   */
  recoverInterruptedRuns(): RecoveryResult[] {
    const db = this.options.db;
    const now = this.options.now ?? (() => new Date());
    const results: RecoveryResult[] = [];
    for (const run of listRuns(db, { statuses: [...ACTIVE_RUN_STATUSES] })) {
      if (this.executions.has(run.id)) {
        continue;
      }
      const events = new RunEventEmitter(db, run.id, now);
      const reason = "host restarted before the run finished";
      let interruptedNodeRuns = 0;

      for (const nodeRun of listNodeRuns(db, run.id)) {
        if (
          nodeRun.status === "pending" ||
          nodeRun.status === "running" ||
          nodeRun.status === "waiting_approval"
        ) {
          transitionNodeRun(db, { id: nodeRun.id, to: "interrupted" });
          events.emit("node.statusChanged", {
            nodeRunId: nodeRun.id,
            nodeId: nodeRun.nodeId,
            attempt: nodeRun.attempt,
            from: nodeRun.status,
            to: "interrupted",
            reason,
          });
          interruptedNodeRuns += 1;
        }
      }

      const pendingApprovals = listApprovals(db, { runId: run.id, status: "pending" });
      if (pendingApprovals.length > 0) {
        expireApprovalsForRun(db, run.id);
        const resolvedAt = now().toISOString();
        for (const approval of pendingApprovals) {
          events.emit("approval.resolved", {
            approvalId: approval.id,
            decision: "expired",
            resolvedAt,
          });
        }
      }

      const from = run.status;
      transitionRun(db, { id: run.id, to: "interrupted" });
      events.emit("run.statusChanged", { from, to: "interrupted", reason });
      events.emit("run.interrupted", { reason });
      results.push({
        runId: run.id,
        interruptedNodeRuns,
        expiredApprovals: pendingApprovals.length,
      });
    }
    return results;
  }

  /**
   * Resume a restart-interrupted run (D10, CONTRACTS §5): creates a NEW run
   * from the original's immutable snapshots, linked via resumedFromRunId,
   * with a manual trigger. Work that already succeeded before the restart is
   * carried over — status, Harness session and persisted outputs — and is
   * not re-executed (QA-09: 不重做未知副作用); interrupted, failed, pending
   * and previously-skipped nodes restart fresh. Permission inputs are
   * re-resolved from current storage like any other run start. An
   * idempotencyKey given by the caller makes repeated resume calls return
   * the same resumed run; without one each call creates a new run.
   */
  resumeRun(input: { runId: string; idempotencyKey?: string }): { run: Run; created: boolean } {
    const db = this.options.db;
    const original = getRun(db, input.runId);
    if (original === undefined) {
      throw invalidInput("run not found", { runId: input.runId });
    }
    if (original.status !== "interrupted") {
      throw invalidInput("only interrupted runs can be resumed", {
        runId: input.runId,
        status: original.status,
      });
    }
    for (const snapshot of original.botSnapshots) {
      const bot = getBot(db, snapshot.id);
      if (bot === undefined) {
        throw invalidInput("bot not found for workflow node", { botId: snapshot.id });
      }
      if (bot.archivedAt !== null) {
        throw invalidInput("archived bots cannot start new executions", { botId: snapshot.id });
      }
    }
    const permissionPins = this.resolvePermissionPins(original.botSnapshots);
    const now = this.options.now ?? (() => new Date());
    const { run, created } = createRun(db, {
      id: randomUUID(),
      workflowSnapshot: original.workflowSnapshot,
      botSnapshots: original.botSnapshots,
      status: "queued",
      trigger: RunTriggerSchema.parse({
        kind: "manual",
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      }),
      createdAt: now().toISOString(),
      finishedAt: null,
      resumedFromRunId: original.id,
    });
    if (!created) {
      return { run, created: false };
    }
    const execution = new RunExecution({
      ...this.executionOptions(run, permissionPins),
      ...(this.resumeSeedFor(original.id)),
    });
    this.executions.set(run.id, execution);
    execution.start();
    const started = getRun(db, run.id);
    return { run: started ?? run, created: true };
  }

  /**
   * Terminal state of the interrupted run, expressed as a seed for the new
   * execution: succeeded nodes with their sessions and outputs, skipped
   * nodes as pending-again markers.
   */
  private resumeSeedFor(originalRunId: string): { resumeSeed: ResumeSeed } | Record<string, never> {
    const db = this.options.db;
    const latestByNode = new Map<string, NodeRun>();
    for (const nodeRun of listNodeRuns(db, originalRunId)) {
      const current = latestByNode.get(nodeRun.nodeId);
      if (current === undefined || nodeRun.attempt > current.attempt) {
        latestByNode.set(nodeRun.nodeId, nodeRun);
      }
    }
    const succeeded: ResumeSeedEntry[] = [];
    const skippedNodeIds: string[] = [];
    for (const [nodeId, nodeRun] of latestByNode) {
      if (nodeRun.status === "succeeded") {
        succeeded.push({
          nodeId,
          sessionId: nodeRun.sessionId,
          outputs: getNodeRunOutputs(db, nodeRun.id),
        });
      } else if (nodeRun.status === "skipped") {
        skippedNodeIds.push(nodeId);
      }
    }
    if (succeeded.length === 0 && skippedNodeIds.length === 0) {
      return {};
    }
    return { resumeSeed: { succeeded, skippedNodeIds } };
  }

  private resolvePermissionPins(
    bots: ReadonlyArray<Bot>,
  ): Map<string, { policy: ToolPolicy; workspace: Workspace | undefined }> {
    const db = this.options.db;
    const pins = new Map<string, { policy: ToolPolicy; workspace: Workspace | undefined }>();
    for (const bot of bots) {
      const policy = getToolPolicy(db, bot.toolPolicyId);
      if (policy === undefined) {
        // Least privilege: no policy record, no execution.
        throw invalidInput("tool policy not found for bot", {
          botId: bot.id,
          toolPolicyId: bot.toolPolicyId,
        });
      }
      const workspace = getWorkspace(db, bot.workspaceId);
      if (workspace === undefined) {
        throw invalidInput("workspace not found for bot", {
          botId: bot.id,
          workspaceId: bot.workspaceId,
        });
      }
      pins.set(bot.id, { policy, workspace });
    }
    return pins;
  }

  private activeExecution(runId: string): RunExecution | undefined {
    const execution = this.executions.get(runId);
    if (execution !== undefined && execution.isFinished) {
      this.executions.delete(runId);
      return undefined;
    }
    return execution;
  }

  private executionOptions(
    run: Run,
    permissionPins: ReadonlyMap<string, { policy: ToolPolicy; workspace: Workspace | undefined }>,
  ): RunExecutionOptions {
    return {
      db: this.options.db,
      executor: this.options.executor,
      run,
      permissionPins,
      ...(this.options.now !== undefined ? { now: this.options.now } : {}),
      ...(this.options.approvalTtlMs !== undefined
        ? { approvalTtlMs: this.options.approvalTtlMs }
        : {}),
      ...(this.options.retryBaseDelayMs !== undefined
        ? { retryBaseDelayMs: this.options.retryBaseDelayMs }
        : {}),
      ...(this.options.retryMaxDelayMs !== undefined
        ? { retryMaxDelayMs: this.options.retryMaxDelayMs }
        : {}),
      ...(this.options.cancelGraceMs !== undefined
        ? { cancelGraceMs: this.options.cancelGraceMs }
        : {}),
      ...(this.options.bootGeneration !== undefined
        ? { bootGeneration: this.options.bootGeneration }
        : {}),
      ...(this.options.artifactsRoot !== undefined
        ? { artifactsRoot: this.options.artifactsRoot }
        : {}),
    };
  }
}
