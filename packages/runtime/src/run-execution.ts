/**
 * One run's execution (docs/CONTRACTS.md §5, ARCHITECTURE.md §3).
 *
 * Owns: dispatching ready nodes up to the snapshot's concurrency limit,
 * stop-descendants failure propagation (failed node's descendants are
 * skipped at quiescence while independent branches finish), bounded retries
 * with exponential backoff and Retry-After, whole-graph cancellation
 * (cancelling → cancelled only after in-flight work stops), approval-node
 * pauses with TTL, tool-permission gating with one-time approvals (D08),
 * and quiescence finalization with reasons.
 *
 * Does NOT own: the Harness process lifecycle (adapter via NodeExecutor) or
 * schedule-driven triggering (D10).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  isRunTerminal,
  type Bot,
  type NodeRun,
  type Run,
  type RunStatus,
  type ToolPolicy,
  type WorkflowNode,
  type Workspace,
} from "@deepseek-bot/contracts";
import {
  consumeApproval,
  createApproval,
  createNodeRun,
  decideApproval as decideApprovalInStorage,
  expireApprovalsForRun,
  getApproval,
  getApprovalGeneration,
  getNodeRun,
  getRun,
  listApprovals,
  markApprovalExpired,
  setNodeRunOutputs,
  setNodeRunSession,
  transitionNodeRun,
  transitionRun,
  StorageError,
  type ApprovalDecision,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { backoffDelayMs } from "./backoff.js";
import {
  NodeExecutionError,
  failureReason,
  nodeExecutionErrorFromUnknown,
  type BotNodeExecutionContext,
  type BotNodeExecutionResult,
  type NodeExecutor,
} from "./executor.js";
import { invalidInput } from "./errors.js";
import { buildSnapshotGraph, type SnapshotGraph } from "./graph.js";
import { NodeToolGate } from "./permissions/gate.js";
import { RunEventEmitter } from "./run-events.js";

export interface RunExecutionOptions {
  readonly db: OpenedDatabase;
  readonly executor: NodeExecutor;
  readonly run: Run;
  readonly now?: () => Date;
  readonly approvalTtlMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly cancelGraceMs?: number;
  /** Pinned per-bot permission inputs resolved at run start (D08). */
  readonly permissionPins?: ReadonlyMap<
    string,
    { policy: ToolPolicy; workspace: Workspace | undefined }
  >;
  /** Host boot generation stamped onto created approvals (D08). */
  readonly bootGeneration?: number;
  /** Canonical artifact directory granted to file tools (D08). */
  readonly artifactsRoot?: string;
  /**
   * Carried-over state of the interrupted run this run resumes (D10):
   * nodes that succeeded before the restart keep their session, outputs and
   * succeeded status without re-execution; nodes the old run skipped stay
   * decided only until their upstream re-runs, so they restart pending.
   */
  readonly resumeSeed?: ResumeSeed;
}

export interface ResumeSeedEntry {
  readonly nodeId: string;
  readonly sessionId: string | null;
  readonly outputs: Record<string, unknown>;
}

export interface ResumeSeed {
  readonly succeeded: ReadonlyArray<ResumeSeedEntry>;
  readonly skippedNodeIds: ReadonlyArray<string>;
}

const DEFAULT_APPROVAL_TTL_MS = 600_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_CANCEL_GRACE_MS = 5_000;
const REASON_LIMIT = 2_000;

interface InflightAttempt {
  readonly nodeRunId: string;
  readonly nodeId: string;
  readonly controller: AbortController;
  readonly timer: NodeJS.Timeout | undefined;
  settled: boolean;
}

type AttemptOutcome =
  | { kind: "success"; result: BotNodeExecutionResult }
  | { kind: "failure"; error: NodeExecutionError };

interface RecordedFailure {
  readonly reason: string;
  readonly errorCode: string;
}

export class RunExecution {
  readonly runId: string;

  private readonly db: OpenedDatabase;
  private readonly executor: NodeExecutor;
  private readonly now: () => Date;
  private readonly run: Run;
  private readonly graph: SnapshotGraph;
  private readonly bots: ReadonlyMap<string, Bot>;
  private readonly events: RunEventEmitter;
  private readonly approvalTtlMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly cancelGraceMs: number;
  private readonly permissionPins: ReadonlyMap<
    string,
    { policy: ToolPolicy; workspace: Workspace | undefined }
  >;
  private readonly bootGeneration: number;
  private readonly artifactsRoot: string | undefined;
  private readonly resumeSeed: ResumeSeed | undefined;

  /** Attempts per node id, ordered by attempt number; last entry is current. */
  private readonly nodeRuns = new Map<string, NodeRun[]>();
  private readonly outputs = new Map<string, Record<string, unknown>>();
  private readonly inflight = new Map<string, InflightAttempt>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private readonly approvalTimers = new Map<string, NodeJS.Timeout>();
  private readonly failures = new Map<string, RecordedFailure>();
  /** Live tool-permission gates per node run (D08). */
  private readonly toolGates = new Map<string, NodeToolGate>();
  /** Approval id → gate holding its waiter (tool approvals only). */
  private readonly toolApprovalWaiters = new Map<string, NodeToolGate>();
  /** Node runs paused inside the executor waiting for a tool approval. */
  private readonly toolApprovalWaitingNodeRuns = new Set<string>();
  private runStatus: RunStatus;
  private cancelRequested = false;
  private finished = false;
  private cancelDrain: (() => void) | null = null;

  constructor(options: RunExecutionOptions) {
    this.db = options.db;
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
    this.run = options.run;
    this.runId = options.run.id;
    this.runStatus = options.run.status;
    this.graph = buildSnapshotGraph(options.run.workflowSnapshot);
    this.bots = new Map(options.run.botSnapshots.map((bot) => [bot.id, bot]));
    this.events = new RunEventEmitter(this.db, this.runId, this.now);
    this.approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
    this.permissionPins = options.permissionPins ?? new Map();
    this.bootGeneration = options.bootGeneration ?? 0;
    this.artifactsRoot = options.artifactsRoot;
    this.resumeSeed = options.resumeSeed;
  }

  get status(): RunStatus {
    return this.runStatus;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Persist attempt-1 node runs, emit run.created and start scheduling. */
  start(): void {
    for (const node of this.run.workflowSnapshot.nodes) {
      const nodeRun = createNodeRun(this.db, {
        id: randomUUID(),
        runId: this.runId,
        nodeId: node.id,
        attempt: 1,
        status: "pending",
        inputRefs: [],
        outputRefs: [],
        sessionId: null,
      });
      this.nodeRuns.set(node.id, [nodeRun]);
    }
    this.events.emit("run.created", {
      workflowId: this.run.workflowSnapshot.id,
      triggerKind: this.run.trigger.kind,
    });
    this.setRunStatus("running", "run started");
    if (this.resumeSeed !== undefined) {
      this.applyResumeSeed(this.resumeSeed);
    }
    this.pump();
  }

  /**
   * Carry the interrupted predecessor's terminal state into this run (D10):
   * succeeded nodes flip to succeeded with their persisted outputs and
   * Harness session rehydrated (no re-execution, no repeated side effects),
   * previously skipped nodes restart pending so an upstream retry can
   * dispatch them again.
   */
  private applyResumeSeed(seed: ResumeSeed): void {
    for (const entry of seed.succeeded) {
      const pending = this.nodeRuns.get(entry.nodeId)?.at(-1);
      if (pending === undefined || pending.status !== "pending") {
        continue;
      }
      const running = transitionNodeRun(this.db, { id: pending.id, to: "running" });
      this.replaceLatest(running);
      this.emitNodeStatus(running, "pending", "running", "resumed from previous run");
      if (entry.sessionId !== null) {
        setNodeRunSession(this.db, { id: pending.id, sessionId: entry.sessionId });
      }
      if (Object.keys(entry.outputs).length > 0) {
        setNodeRunOutputs(this.db, { id: pending.id, outputs: entry.outputs });
      }
      const succeeded = transitionNodeRun(this.db, { id: pending.id, to: "succeeded" });
      this.replaceLatest(succeeded);
      this.emitNodeStatus(succeeded, "running", "succeeded", "completed before the restart");
      this.outputs.set(entry.nodeId, { ...entry.outputs });
    }
    for (const nodeId of seed.skippedNodeIds) {
      const pending = this.nodeRuns.get(nodeId)?.at(-1);
      if (pending === undefined || pending.status !== "pending") {
        continue;
      }
      const skipped = transitionNodeRun(this.db, { id: pending.id, to: "skipped" });
      this.replaceLatest(skipped);
      this.emitNodeStatus(skipped, "pending", "skipped", "skipped before the restart");
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  private latestAttempt(nodeId: string): NodeRun | undefined {
    const attempts = this.nodeRuns.get(nodeId);
    return attempts?.[attempts.length - 1];
  }

  private replaceLatest(nodeRun: NodeRun): void {
    const attempts = this.nodeRuns.get(nodeRun.nodeId);
    if (attempts !== undefined && attempts.length > 0) {
      attempts[attempts.length - 1] = nodeRun;
    }
  }

  private findReadyNode(): WorkflowNode | undefined {
    for (const nodeId of this.graph.nodeOrder) {
      const latest = this.latestAttempt(nodeId);
      if (latest === undefined || latest.status !== "pending") {
        continue;
      }
      if (this.hasInflightForNode(nodeId)) {
        continue;
      }
      const dependencies = this.graph.dependencies.get(nodeId) ?? [];
      const satisfied = dependencies.every(
        (dependency) => this.latestAttempt(dependency)?.status === "succeeded",
      );
      if (satisfied) {
        return this.graph.nodes.get(nodeId);
      }
    }
    return undefined;
  }

  private hasInflightForNode(nodeId: string): boolean {
    for (const entry of this.inflight.values()) {
      if (entry.nodeId === nodeId) {
        return true;
      }
    }
    return false;
  }

  private pump(): void {
    if (this.finished || this.cancelRequested) {
      return;
    }
    const limit = this.run.workflowSnapshot.limits.maxConcurrentNodes;
    while (this.inflight.size < limit) {
      const node = this.findReadyNode();
      if (node === undefined) {
        break;
      }
      this.dispatch(node);
    }
    this.reconcile();
  }

  private dispatch(node: WorkflowNode): void {
    const current = this.latestAttempt(node.id);
    if (current === undefined || current.status !== "pending") {
      return;
    }
    const running = transitionNodeRun(this.db, { id: current.id, to: "running" });
    this.replaceLatest(running);
    this.emitNodeStatus(running, "pending", "running", "dispatched");

    if (node.type === "approval") {
      this.beginApprovalPause(node, running);
      return;
    }

    const bot = node.botId === undefined ? undefined : this.bots.get(node.botId);
    if (bot === undefined) {
      // Snapshot validation guarantees a bot snapshot exists; this guard
      // keeps a corrupted snapshot from throwing inside the scheduler.
      this.failBeforeExecution(running, node, new NodeExecutionError({
        code: "INVALID_INPUT",
        message: `bot snapshot missing for node '${node.id}'`,
        retryable: false,
      }));
      return;
    }

    const pin = this.permissionPins.get(bot.id);
    if (pin === undefined) {
      // Least privilege (SECURITY_DATA §3): a bot without a resolvable tool
      // policy executes no side-effecting work at all.
      this.failBeforeExecution(running, node, new NodeExecutionError({
        code: "INVALID_INPUT",
        message: `tool policy missing for bot '${bot.id}'`,
        retryable: false,
      }));
      return;
    }
    const gate = new NodeToolGate({
      db: this.db,
      events: this.events,
      runId: this.runId,
      nodeRunId: running.id,
      policy: pin.policy,
      workspace: pin.workspace,
      artifactsRoot: this.artifactsRoot,
      bootGeneration: this.bootGeneration,
      approvalTtlMs: this.approvalTtlMs,
      now: this.now,
      isRunActive: () => !this.cancelRequested && !this.finished && !isRunTerminal(this.runStatus),
      beginApprovalWait: (nodeRunId, reason) =>
        this.beginToolApprovalWait(nodeRunId, reason),
      endApprovalWait: (nodeRunId, reason) => this.endToolApprovalWait(nodeRunId, reason),
      registerWaiter: (approvalId, gateOwner) => {
        this.toolApprovalWaiters.set(approvalId, gateOwner);
      },
      unregisterWaiter: (approvalId) => {
        this.toolApprovalWaiters.delete(approvalId);
      },
    });
    this.toolGates.set(running.id, gate);

    const resolution = this.resolveInputs(node);
    const firstMissing = resolution.missing[0];
    if (firstMissing !== undefined) {
      this.failBeforeExecution(running, node, new NodeExecutionError({
        code: "MISSING_BINDING",
        message:
          `required input '${firstMissing.inputKey}' of node '${node.id}' has no value ` +
          `from '${firstMissing.fromNodeId}(${firstMissing.outputKey})'`,
        retryable: false,
      }));
      return;
    }

    const controller = new AbortController();
    const timeoutSeconds = node.timeoutSeconds;
    const entry: InflightAttempt = {
      nodeRunId: running.id,
      nodeId: node.id,
      controller,
      timer:
        timeoutSeconds === undefined
          ? undefined
          : setTimeout(() => {
              this.onAttemptTimeout(running.id, timeoutSeconds);
            }, timeoutSeconds * 1_000),
      settled: false,
    };
    this.inflight.set(running.id, entry);

    const context: BotNodeExecutionContext = {
      run: this.run,
      nodeRun: running,
      node,
      bot,
      inputs: resolution.inputs,
      signal: controller.signal,
      permissions: gate,
    };
    let promise: Promise<BotNodeExecutionResult>;
    try {
      promise = this.executor.executeBotNode(context);
    } catch (error) {
      this.settleAttempt(running.id, {
        kind: "failure",
        error: nodeExecutionErrorFromUnknown(error),
      });
      return;
    }
    promise.then(
      (result) => {
        this.settleAttempt(running.id, { kind: "success", result });
      },
      (error: unknown) => {
        this.settleAttempt(running.id, {
          kind: "failure",
          error: nodeExecutionErrorFromUnknown(error),
        });
      },
    );
  }

  /**
   * Fail an attempt that never reached the executor (missing bot snapshot,
   * unsatisfiable required binding). These are deterministic configuration
   * errors: recorded as failures without retry scheduling.
   */
  private failBeforeExecution(
    running: NodeRun,
    node: WorkflowNode,
    error: NodeExecutionError,
  ): void {
    const reason = failureReason(error);
    const failed = transitionNodeRun(this.db, { id: running.id, to: "failed" });
    this.replaceLatest(failed);
    this.emitNodeStatus(failed, "running", "failed", reason);
    this.failures.set(node.id, { reason, errorCode: error.code });
    this.pump();
  }

  private onAttemptTimeout(nodeRunId: string, timeoutSeconds: number): void {    const entry = this.inflight.get(nodeRunId);
    if (entry === undefined || entry.settled) {
      return;
    }
    // Signal cooperative cancellation first; a late executor result is
    // ignored through the settled guard (upstream has no request-level
    // timeout API, D01 §8.2).
    entry.controller.abort();
    this.settleAttempt(nodeRunId, {
      kind: "failure",
      error: new NodeExecutionError({
        code: "TOOL_TIMEOUT",
        message: `node attempt exceeded its ${timeoutSeconds}s timeout`,
        retryable: true,
      }),
    });
  }

  /**
   * Resolve inputs for a node from predecessor outputs via edge mappings.
   * Edges whose output value is absent only fail the node when they feed a
   * declared required input; other edges act as pure dependency gates.
   */
  private resolveInputs(node: WorkflowNode): {
    inputs: Record<string, unknown>;
    missing: { inputKey: string; fromNodeId: string; outputKey: string }[];
  } {
    const requiredInputs = new Set(
      node.inputBindings
        .filter((binding) => binding.required)
        .map((binding) => binding.inputKey),
    );
    const inputs: Record<string, unknown> = {};
    const missing: { inputKey: string; fromNodeId: string; outputKey: string }[] = [];
    for (const edge of this.graph.incomingEdges.get(node.id) ?? []) {
      const value = this.outputs.get(edge.fromNodeId)?.[edge.outputKey];
      if (value === undefined) {
        if (requiredInputs.has(edge.inputKey)) {
          missing.push({
            inputKey: edge.inputKey,
            fromNodeId: edge.fromNodeId,
            outputKey: edge.outputKey,
          });
        }
        continue;
      }
      inputs[edge.inputKey] = value;
    }
    return { inputs, missing };
  }

  // -------------------------------------------------------------------------
  // Attempt settlement, retries and failure propagation
  // -------------------------------------------------------------------------

  private settleAttempt(nodeRunId: string, outcome: AttemptOutcome): void {
    const entry = this.inflight.get(nodeRunId);
    if (entry === undefined || entry.settled) {
      return;
    }
    entry.settled = true;
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    this.inflight.delete(nodeRunId);
    this.disposeToolGate(nodeRunId);
    if (this.db.raw.isOpen === false) {
      // The host was torn down under this in-flight attempt (crash-simulation
      // tests, a killed host process whose event loop briefly outlives the
      // database): the settlement has nowhere to land, and throwing would
      // only surface as an unhandled rejection in a dying process. The
      // recovery path (recoverInterruptedRuns at next host start) owns the
      // recorded state from here.
      return;
    }
    if (this.cancelRequested) {
      // Late settlement during cancellation (e.g. a tool wait rejected with
      // CANCELLED after the node was already swept) must still release the
      // cancel drain once the last in-flight entry is gone.
      this.notifyCancelDrain();
    }

    const latest = this.latestAttempt(entry.nodeId);
    if (latest === undefined || latest.id !== nodeRunId) {
      return;
    }
    if (latest.status !== "running") {
      return;
    }
    if (this.cancelRequested) {
      this.finishAttemptAsCancelled(latest, "run cancelled");
      return;
    }

    if (outcome.kind === "success") {
      if (outcome.result.sessionId != null) {
        this.replaceLatest(
          setNodeRunSession(this.db, {
            id: nodeRunId,
            sessionId: outcome.result.sessionId,
          }),
        );
      }
      // Persist the inline outputs so a restart-interrupted successor run
      // can rehydrate data flow without re-running this node (D10).
      setNodeRunOutputs(this.db, { id: nodeRunId, outputs: { ...outcome.result.outputs } });
      const succeeded = transitionNodeRun(this.db, { id: nodeRunId, to: "succeeded" });
      this.replaceLatest(succeeded);
      this.emitNodeStatus(succeeded, "running", "succeeded", "node completed");
      this.outputs.set(entry.nodeId, { ...outcome.result.outputs });
      this.pump();
      return;
    }
    this.handleAttemptFailure(latest, entry.nodeId, outcome.error);
  }

  private handleAttemptFailure(
    failed: NodeRun,
    nodeId: string,
    error: NodeExecutionError,
  ): void {
    const reason = failureReason(error);
    const failedRun = transitionNodeRun(this.db, { id: failed.id, to: "failed" });
    this.replaceLatest(failedRun);
    this.emitNodeStatus(failedRun, "running", "failed", reason);
    this.failures.set(nodeId, { reason, errorCode: error.code });

    const attemptCount = this.nodeRuns.get(nodeId)?.length ?? 0;
    const node = this.graph.nodes.get(nodeId);
    const maxAttempts = 1 + (node?.retryPolicy.maxRetries ?? 0);
    if (error.retryable && attemptCount < maxAttempts && !this.cancelRequested) {
      const delay = backoffDelayMs({
        attempt: attemptCount,
        baseDelayMs: this.retryBaseDelayMs,
        maxDelayMs: this.retryMaxDelayMs,
        ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      });
      const timer = setTimeout(() => {
        this.retryTimers.delete(nodeId);
        this.spawnRetryAttempt(nodeId);
      }, delay);
      this.retryTimers.set(nodeId, timer);
    }
    this.pump();
  }

  private spawnRetryAttempt(nodeId: string): void {
    const node = this.graph.nodes.get(nodeId);
    if (node === undefined || this.finished || this.cancelRequested) {
      return;
    }
    const attempt = (this.nodeRuns.get(nodeId)?.length ?? 0) + 1;
    const nodeRun = createNodeRun(this.db, {
      id: randomUUID(),
      runId: this.runId,
      nodeId,
      attempt,
      status: "pending",
      inputRefs: [],
      outputRefs: [],
      sessionId: null,
    });
    this.nodeRuns.get(nodeId)?.push(nodeRun);
    this.pump();
  }

  private finishAttemptAsCancelled(running: NodeRun, reason: string): void {
    const cancelled = transitionNodeRun(this.db, { id: running.id, to: "cancelled" });
    this.replaceLatest(cancelled);
    this.emitNodeStatus(cancelled, "running", "cancelled", reason);
    this.notifyCancelDrain();
  }

  // -------------------------------------------------------------------------
  // Run status and finalization
  // -------------------------------------------------------------------------

  private setRunStatus(to: RunStatus, reason: string): Run {
    if (this.runStatus === to) {
      return this.currentRun();
    }
    const from = this.runStatus;
    const updated = transitionRun(this.db, { id: this.runId, to });
    this.runStatus = updated.status;
    this.events.emit("run.statusChanged", { from, to, reason });
    if (isRunTerminal(to)) {
      this.finished = true;
    }
    return updated;
  }

  /**
   * Reconcile the run status after any state change (CONTRACTS §5): running
   * while work is dispatchable, in flight or in backoff; waiting_approval
   * only when nothing can run and an approval is outstanding; otherwise
   * finalize — blocked pending nodes are skipped (stop-descendants) and any
   * failure fails the run.
   */
  private reconcile(): void {
    if (this.finished || this.cancelRequested) {
      return;
    }
    if (isRunTerminal(this.runStatus)) {
      this.finished = true;
      return;
    }

    // A running attempt without a registered in-flight entry means the
    // scheduler is still settling it — never finalize over such a node.
    const hasOrphanRunning = this.graph.nodeOrder.some((nodeId) => {
      const latest = this.latestAttempt(nodeId);
      return latest?.status === "running" && !this.inflight.has(latest.id);
    });
    // In-flight attempts paused inside the executor for a tool approval do
    // not keep the run "running": other independent nodes may finish, but
    // quiescence with only approval waits shows waiting_approval (§5).
    const busyInflight = [...this.inflight.values()].some(
      (entry) => !this.toolApprovalWaitingNodeRuns.has(entry.nodeRunId),
    );
    const busy =
      busyInflight ||
      this.retryTimers.size > 0 ||
      hasOrphanRunning ||
      this.findReadyNode() !== undefined;
    if (busy) {
      this.setRunStatus("running", "nodes executing");
      return;
    }

    let hasWaiting = false;
    let hasBlockedPending = false;
    let firstFailure: RecordedFailure | undefined;
    let hasCancelled = false;
    for (const nodeId of this.graph.nodeOrder) {
      const latest = this.latestAttempt(nodeId);
      if (latest === undefined) {
        continue;
      }
      if (latest.status === "waiting_approval") {
        hasWaiting = true;
      } else if (latest.status === "pending") {
        hasBlockedPending = true;
      } else if (latest.status === "failed") {
        firstFailure ??= this.failures.get(nodeId);
      } else if (latest.status === "cancelled") {
        hasCancelled = true;
      }
    }

    if (hasWaiting) {
      this.setRunStatus("waiting_approval", "waiting for approval decision");
      return;
    }

    if (hasBlockedPending) {
      // Quiescent with blocked nodes: their dependency chain contains a
      // failure, so stop-descendants marks them skipped before finalizing.
      for (const nodeId of this.graph.nodeOrder) {
        const latest = this.latestAttempt(nodeId);
        if (latest !== undefined && latest.status === "pending") {
          const skipped = transitionNodeRun(this.db, { id: latest.id, to: "skipped" });
          this.replaceLatest(skipped);
          this.emitNodeStatus(skipped, "pending", "skipped", "upstream node failed");
        }
      }
    }

    if (firstFailure !== undefined) {
      this.setRunStatus("failed", firstFailure.reason);
      this.events.emit("run.failed", {
        reason: firstFailure.reason,
        errorCode: firstFailure.errorCode,
      });
      return;
    }
    if (hasCancelled) {
      this.finalizeThroughWaiting("cancelled", "run cancelled");
      return;
    }
    const allSucceeded = this.graph.nodeOrder.every((nodeId) => {
      const latest = this.latestAttempt(nodeId);
      return latest !== undefined && latest.status === "succeeded";
    });
    if (allSucceeded) {
      const finishedRun = this.finalizeThroughWaiting("succeeded", "all nodes completed");
      this.events.emit("run.completed", {
        finishedAt: finishedRun.finishedAt ?? this.now().toISOString(),
      });
      return;
    }
    // Defensive: mixed terminal states without a recorded failure cannot be
    // produced by the scheduler in a valid DAG.
    this.setRunStatus("failed", "run stopped in an inconsistent node state");
    this.events.emit("run.failed", {
      reason: "run stopped in an inconsistent node state",
      errorCode: "RUNTIME_UNAVAILABLE",
    });
  }

  private emitNodeStatus(
    nodeRun: NodeRun,
    from: NodeRun["status"],
    to: NodeRun["status"],
    reason: string,
  ): void {
    this.events.emit("node.statusChanged", {
      nodeRunId: nodeRun.id,
      nodeId: nodeRun.nodeId,
      attempt: nodeRun.attempt,
      from,
      to,
      reason,
    });
  }

  /**
   * Finalize from `waiting_approval`: the contract state machine only allows
   * waiting → running/cancelling/failed, so reaching succeeded or cancelled
   * requires the corresponding intermediate hop (CONTRACTS §5).
   */
  private finalizeThroughWaiting(to: "succeeded" | "cancelled", reason: string): Run {
    if (this.runStatus === "waiting_approval") {
      this.setRunStatus(
        to === "succeeded" ? "running" : "cancelling",
        "approval resolved",
      );
    }
    return this.setRunStatus(to, reason);
  }

  // -------------------------------------------------------------------------
  // Approval nodes
  // -------------------------------------------------------------------------

  private beginApprovalPause(node: WorkflowNode, nodeRun: NodeRun): void {
    const expiresAt = new Date(
      this.now().getTime() + this.approvalTtlMs,
    ).toISOString();
    const actionDigest = createHash("sha256")
      .update(
        JSON.stringify({
          runId: this.runId,
          nodeId: node.id,
          nodeRunId: nodeRun.id,
          instructionTemplate: node.instructionTemplate,
        }),
      )
      .digest("hex");
    const approval = createApproval(
      this.db,
      {
        id: randomUUID(),
        runId: this.runId,
        nodeRunId: nodeRun.id,
        actionDigest,
        resource: `workflow-run/${this.runId}/node/${node.id}`,
        expiresAt,
        status: "pending",
      },
      { generation: this.bootGeneration },
    );
    this.events.emit("approval.requested", { approval });

    const waiting = transitionNodeRun(this.db, { id: nodeRun.id, to: "waiting_approval" });
    this.replaceLatest(waiting);
    this.emitNodeStatus(waiting, "running", "waiting_approval", "awaiting approval");

    this.approvalTimers.set(
      nodeRun.id,
      setTimeout(() => {
        this.onApprovalTtl(nodeRun.id, approval.id);
      }, this.approvalTtlMs),
    );
  }

  private onApprovalTtl(nodeRunId: string, approvalId: string): void {
    this.approvalTimers.delete(nodeRunId);
    const approval = getApproval(this.db, approvalId);
    const latest = this.latestAttemptByNodeRunId(nodeRunId);
    if (
      approval === undefined ||
      approval.status !== "pending" ||
      latest === undefined ||
      latest.status !== "waiting_approval"
    ) {
      return;
    }
    markApprovalExpired(this.db, { id: approvalId });
    this.events.emit("approval.resolved", {
      approvalId,
      decision: "expired",
      resolvedAt: this.now().toISOString(),
    });
    this.failWaitingNode(
      latest,
      "APPROVAL_EXPIRED",
      "APPROVAL_EXPIRED: approval validity window passed",
    );
  }

  private latestAttemptByNodeRunId(nodeRunId: string): NodeRun | undefined {
    for (const nodeId of this.graph.nodeOrder) {
      const latest = this.latestAttempt(nodeId);
      if (latest?.id === nodeRunId) {
        return latest;
      }
    }
    return undefined;
  }

  private failWaitingNode(failed: NodeRun, errorCode: string, reason: string): void {
    const failedRun = transitionNodeRun(this.db, { id: failed.id, to: "failed" });
    this.replaceLatest(failedRun);
    this.emitNodeStatus(failedRun, "waiting_approval", "failed", reason);
    this.failures.set(failedRun.nodeId, { reason, errorCode });
    this.pump();
  }

  /**
   * Apply an approval decision (CONTRACTS §3 approval.decide): the caller's
   * expected digest and the host boot generation are validated first, then
   * the decision routes to a tool-action waiter (D08) or the approval-node
   * pause. Approve consumes the approval once; deny fails the node
   * (stop-descendants applies); expired-but-pending fails with
   * APPROVAL_EXPIRED. A retry creates a fresh approval; old ones are never
   * silently restored.
   */
  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    expectedActionDigest: string,
  ): void {
    if (this.finished || isRunTerminal(this.runStatus)) {
      throw invalidInput("run is already finished", { runId: this.runId });
    }
    const approval = getApproval(this.db, approvalId);
    if (approval === undefined || approval.runId !== this.runId) {
      throw invalidInput("approval not found in this run", { approvalId });
    }
    if (approval.actionDigest !== expectedActionDigest) {
      throw invalidInput("action digest mismatch", { approvalId });
    }
    const generation = getApprovalGeneration(this.db, approvalId);
    if (generation !== undefined && generation !== this.bootGeneration) {
      // Stale process: the decision must not be applied (FR-06: 重启后旧审批
      // 不能直接重放). Recovery expires these approvals at host startup.
      throw new StorageError({
        code: "APPROVAL_EXPIRED",
        message: "approval belongs to a previous host session",
        details: {
          approvalId,
          approvalGeneration: generation,
          hostGeneration: this.bootGeneration,
        },
        retryable: false,
      });
    }

    const gate = this.toolApprovalWaiters.get(approvalId);
    if (gate !== undefined) {
      // Tool action approval: the gate re-validates, consumes and flips the
      // node status; the executor owns the outcome.
      try {
        decideApprovalInStorage(this.db, { id: approvalId, decision });
      } catch (error) {
        if (error instanceof StorageError && error.code === "APPROVAL_EXPIRED") {
          this.events.emit("approval.resolved", {
            approvalId,
            decision: "expired",
            resolvedAt: this.now().toISOString(),
          });
          gate.settleWait(approvalId, { kind: "expired" });
          return;
        }
        throw error;
      }
      this.events.emit("approval.resolved", {
        approvalId,
        decision,
        resolvedAt: this.now().toISOString(),
      });
      gate.settleWait(approvalId, {
        kind: decision === "approved" ? "approved" : "denied",
      });
      return;
    }

    const nodeRun = getNodeRun(this.db, approval.nodeRunId);
    if (nodeRun === undefined || nodeRun.runId !== this.runId) {
      throw invalidInput("approval does not reference this run", { approvalId });
    }
    const latest = this.latestAttempt(nodeRun.nodeId);
    if (latest === undefined || latest.id !== nodeRun.id) {
      throw invalidInput("approval references a superseded node attempt", { approvalId });
    }
    if (latest.status !== "waiting_approval") {
      throw invalidInput("approval node is not waiting for a decision", {
        approvalId,
        nodeRunStatus: latest.status,
      });
    }

    try {
      decideApprovalInStorage(this.db, { id: approvalId, decision });
    } catch (error) {
      if (error instanceof StorageError && error.code === "APPROVAL_EXPIRED") {
        this.clearApprovalTimer(nodeRun.id);
        this.events.emit("approval.resolved", {
          approvalId,
          decision: "expired",
          resolvedAt: this.now().toISOString(),
        });
        this.failWaitingNode(
          latest,
          "APPROVAL_EXPIRED",
          truncateReason(`${error.code}: ${error.message}`),
        );
        return;
      }
      throw error;
    }
    this.clearApprovalTimer(nodeRun.id);
    this.events.emit("approval.resolved", {
      approvalId,
      decision,
      resolvedAt: this.now().toISOString(),
    });

    if (decision === "approved") {
      consumeApproval(this.db, { id: approvalId });
      const running = transitionNodeRun(this.db, { id: latest.id, to: "running" });
      this.replaceLatest(running);
      this.emitNodeStatus(running, "waiting_approval", "running", "approval granted");
      const succeeded = transitionNodeRun(this.db, { id: latest.id, to: "succeeded" });
      this.replaceLatest(succeeded);
      this.emitNodeStatus(succeeded, "running", "succeeded", "approval granted");
      this.outputs.set(nodeRun.nodeId, {});
      this.pump();
      return;
    }

    this.failWaitingNode(
      latest,
      "APPROVAL_REQUIRED",
      "APPROVAL_REQUIRED: approval denied by user",
    );
  }

  private clearApprovalTimer(nodeRunId: string): void {
    const timer = this.approvalTimers.get(nodeRunId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.approvalTimers.delete(nodeRunId);
    }
  }

  // -------------------------------------------------------------------------
  // Tool permission waits (D08)
  // -------------------------------------------------------------------------

  /**
   * Flip a running node to waiting_approval while its executor awaits a tool
   * approval inside `authorize`. Returns false when the node is no longer
   * running (cancelled meanwhile) — the gate then refuses the action.
   */
  private beginToolApprovalWait(nodeRunId: string, reason: string): boolean {
    const latest = this.latestAttemptByNodeRunId(nodeRunId);
    if (latest === undefined || latest.status !== "running") {
      return false;
    }
    try {
      const waiting = transitionNodeRun(this.db, { id: nodeRunId, to: "waiting_approval" });
      this.replaceLatest(waiting);
      this.toolApprovalWaitingNodeRuns.add(nodeRunId);
      this.emitNodeStatus(waiting, "running", "waiting_approval", reason);
      this.pump();
      return true;
    } catch {
      return false;
    }
  }

  /** Flip a tool-waiting node back to running once its wait is over. */
  private endToolApprovalWait(nodeRunId: string, reason: string): void {
    this.toolApprovalWaitingNodeRuns.delete(nodeRunId);
    const latest = this.latestAttemptByNodeRunId(nodeRunId);
    if (latest === undefined || latest.status !== "waiting_approval") {
      return;
    }
    try {
      const running = transitionNodeRun(this.db, { id: nodeRunId, to: "running" });
      this.replaceLatest(running);
      this.emitNodeStatus(running, "waiting_approval", "running", reason);
      this.pump();
    } catch {
      // Terminal meanwhile (cancellation won the race); nothing to flip.
    }
  }

  /** Drop a settled node run's gate; stragglers cannot execute afterwards. */
  private disposeToolGate(nodeRunId: string): void {
    const gate = this.toolGates.get(nodeRunId);
    if (gate === undefined) {
      return;
    }
    this.toolGates.delete(nodeRunId);
    for (const approvalId of gate.pendingApprovalIds()) {
      gate.settleWait(approvalId, { kind: "cancelled" });
    }
  }

  // -------------------------------------------------------------------------
  // Cancellation and explicit node retry
  // -------------------------------------------------------------------------

  /**
   * Cancel the whole graph (CONTRACTS §5): stop new dispatch, abort
   * in-flight attempts, cancel pending/waiting nodes, then enter cancelled
   * only after in-flight work has stopped (bounded by the grace window for
   * executors that ignore the abort signal). Repeated cancels return the
   * existing state; terminal runs cannot be cancelled again.
   */
  async cancel(): Promise<Run> {
    if (this.finished && isRunTerminal(this.runStatus)) {
      return this.currentRun();
    }
    if (this.cancelRequested) {
      if (!this.finished) {
        await new Promise<void>((resolve) => {
          this.cancelDrain = resolve;
        });
      }
      return this.currentRun();
    }
    this.cancelRequested = true;
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    for (const timer of this.approvalTimers.values()) {
      clearTimeout(timer);
    }
    this.approvalTimers.clear();

    this.setRunStatus("cancelling", "cancel requested");

    const pendingApprovals = listApprovals(this.db, { runId: this.runId, status: "pending" });
    if (pendingApprovals.length > 0) {
      expireApprovalsForRun(this.db, this.runId);
      const resolvedAt = this.now().toISOString();
      for (const approval of pendingApprovals) {
        this.events.emit("approval.resolved", {
          approvalId: approval.id,
          decision: "expired",
          resolvedAt,
        });
      }
    }

    // Executors waiting inside authorize() must fail fast with CANCELLED;
    // their waiting nodes reach cancelled through the status sweep below.
    for (const [approvalId, gate] of [...this.toolApprovalWaiters]) {
      gate.settleWait(approvalId, { kind: "cancelled" });
    }
    this.toolApprovalWaitingNodeRuns.clear();

    for (const nodeId of this.graph.nodeOrder) {
      const latest = this.latestAttempt(nodeId);
      if (latest === undefined) {
        continue;
      }
      if (latest.status === "pending") {
        const cancelled = transitionNodeRun(this.db, { id: latest.id, to: "cancelled" });
        this.replaceLatest(cancelled);
        this.emitNodeStatus(cancelled, "pending", "cancelled", "run cancelled");
      } else if (latest.status === "waiting_approval") {
        const cancelled = transitionNodeRun(this.db, { id: latest.id, to: "cancelled" });
        this.replaceLatest(cancelled);
        this.emitNodeStatus(cancelled, "waiting_approval", "cancelled", "run cancelled");
      } else if (latest.status === "running") {
        this.inflight.get(latest.id)?.controller.abort();
      }
    }

    if (this.inflight.size > 0) {
      let graceTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        new Promise<void>((resolve) => {
          this.cancelDrain = resolve;
        }),
        new Promise<void>((resolve) => {
          graceTimer = setTimeout(resolve, this.cancelGraceMs);
        }),
      ]);
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer);
      }
    }
    for (const entry of [...this.inflight.values()]) {
      entry.settled = true;
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
      }
      this.inflight.delete(entry.nodeRunId);
      this.disposeToolGate(entry.nodeRunId);
      const latest = this.latestAttempt(entry.nodeId);
      if (latest !== undefined && latest.status === "running") {
        this.finishAttemptAsCancelled(latest, "run cancelled");
      }
    }

    this.setRunStatus("cancelled", "run cancelled");
    this.cancelDrain = null;
    return this.currentRun();
  }

  private notifyCancelDrain(): void {
    if (this.inflight.size === 0 && this.cancelDrain !== null) {
      const drain = this.cancelDrain;
      this.cancelDrain = null;
      drain();
    }
  }

  /**
   * Explicit retry of a failed node attempt (CONTRACTS §3 run.retryNode):
   * only while the run is still active, only for the node's latest failed
   * attempt, and only while no strict descendant has progressed. Blocked
   * descendants stay pending — skip only happens at finalization, and a
   * finalized run is terminal, so there is nothing to revive here. A retried
   * approval node creates a fresh approval; old ones are never restored.
   */
  retryNode(nodeRunId: string): NodeRun {
    if (this.finished || isRunTerminal(this.runStatus)) {
      throw invalidInput("terminal runs recover through a new run", { runId: this.runId });
    }
    if (this.cancelRequested) {
      throw invalidInput("run is cancelling", { runId: this.runId });
    }
    const nodeRun = getNodeRun(this.db, nodeRunId);
    if (nodeRun === undefined || nodeRun.runId !== this.runId) {
      throw invalidInput("node run not found in this run", { nodeRunId });
    }
    if (nodeRun.status !== "failed") {
      throw invalidInput("only failed node runs can be retried", {
        nodeRunId,
        status: nodeRun.status,
      });
    }
    const node = this.graph.nodes.get(nodeRun.nodeId);
    const latest = this.latestAttempt(nodeRun.nodeId);
    if (node === undefined || latest === undefined || latest.id !== nodeRunId) {
      throw invalidInput("a newer attempt already exists for this node", { nodeRunId });
    }
    for (const descendantId of this.graph.descendants.get(node.id) ?? []) {
      const descendant = this.latestAttempt(descendantId);
      if (
        descendant !== undefined &&
        (descendant.status === "succeeded" ||
          descendant.status === "running" ||
          descendant.status === "waiting_approval")
      ) {
        throw invalidInput("downstream nodes already progressed", {
          nodeId: descendantId,
          status: descendant.status,
        });
      }
    }

    const attempt = (this.nodeRuns.get(node.id)?.length ?? 0) + 1;
    const spawned = createNodeRun(this.db, {
      id: randomUUID(),
      runId: this.runId,
      nodeId: node.id,
      attempt,
      status: "pending",
      inputRefs: [],
      outputRefs: [],
      sessionId: null,
    });
    this.nodeRuns.get(node.id)?.push(spawned);
    this.pump();
    return this.latestAttempt(node.id) ?? spawned;
  }

  private currentRun(): Run {
    const run = getRun(this.db, this.runId);
    if (run === undefined) {
      throw invalidInput("run disappeared from storage", { runId: this.runId });
    }
    return run;
  }
}

function truncateReason(reason: string): string {
  return reason.length > REASON_LIMIT ? reason.slice(0, REASON_LIMIT) : reason;
}
