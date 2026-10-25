/**
 * Workflow engine facade (D06, FR-05/07 backend).
 *
 * The Host owns exactly one engine per storage database. startRun validates
 * the workflow graph and bot availability BEFORE persisting anything
 * (ARCHITECTURE.md §3), snapshots the workflow and its bots into the
 * immutable Run record, and deduplicates submissions by idempotencyKey
 * (CONTRACTS §3). Runs found active in storage without a live execution are
 * interrupted by recoverInterruptedRuns at host startup; resuming them is a
 * new Run linked via resumedFromRunId (D10).
 */
import { randomUUID } from "node:crypto";
import {
  isRunTerminal,
  RunTriggerSchema,
  validateWorkflowDraft,
  type Bot,
  type Run,
} from "@deepseek-bot/contracts";
import {
  ACTIVE_RUN_STATUSES,
  createRun,
  expireApprovalsForRun,
  getApproval,
  getBot,
  getRun,
  getWorkflow,
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
import { RunExecution, type RunExecutionOptions } from "./run-execution.js";

export interface WorkflowEngineOptions {
  readonly db: OpenedDatabase;
  readonly executor: NodeExecutor;
  readonly now?: () => Date;
  readonly approvalTtlMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly cancelGraceMs?: number;
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

    const execution = new RunExecution(this.executionOptions(run));
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

  /** Apply an approval decision for an active run (CONTRACTS §3). */
  decideApproval(approvalId: string, decision: ApprovalDecision): void {
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
    execution.decideApproval(approvalId, decision);
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

  private activeExecution(runId: string): RunExecution | undefined {
    const execution = this.executions.get(runId);
    if (execution !== undefined && execution.isFinished) {
      this.executions.delete(runId);
      return undefined;
    }
    return execution;
  }

  private executionOptions(run: Run): RunExecutionOptions {
    return {
      db: this.options.db,
      executor: this.options.executor,
      run,
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
    };
  }
}
