/**
 * TaskDispatcher (v0.5 manager orchestration, TASK_MANAGER_ORCHESTRATION.md
 * §3.3; relay chains per §7/T7), relaxed to interop (TASK_BOT_INTEROP.md).
 * Sits next to the ChatManager: a dispatch becomes a durable task row, the
 * executor's session receives the marked user-side message, and the Host
 * runs ONE real chat turn for the executor through the D30 path. Every
 * terminal transition emits a `task.status` event and writes a delivery
 * notice into the root sender's session (FR-7).
 *
 * Invariants (§3.4, unchanged): the sender only ever "sends one instruction"
 * — it does not own the executor, whose own tool calls keep their own
 * policy/grant/approval path and audit identity. Dispatch identity rules
 * (trusted live bot, not self) are checked at the gateway tool AND
 * re-checked here authoritatively; interop removed the coordinator-role and
 * same-group gates, so any bot may dispatch, cross-group included. Relay
 * chains are pre-declared simple paths; hops carry no autonomous dispatch
 * right — the dispatcher, not the bot, moves the chain.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  TASK_CHAIN_MAX,
  type Task,
  type TaskStatus,
} from "@deepseek-bot/contracts";
import { EngineError, NodeExecutionError } from "@deepseek-bot/runtime";
import type { AuditRecord, AuditSink } from "@deepseek-bot/agent-tools";
import {
  appendChatMessage,
  appendTaskEvent,
  appendWorkerMessageId,
  countQueuedTasksForBot,
  finishTask,
  getBot,
  getPermissionApproval,
  getTask,
  getTaskByIdempotencyKey,
  insertTask,
  listPermissionGrants,
  listQueuedHopsOfRoot,
  listTasks,
  markTaskRunning,
  maxTaskEventSequence,
  nextQueuedTask,
  sweepInterruptedTasks,
  type ListTasksFilter,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { chatSessionIdFor, type ChatManager } from "./chat.js";

export interface TaskAuthorizationRef {
  readonly approvalId?: string;
  readonly grantIds?: readonly string[];
}

export interface DispatchInput {
  readonly fromBotId: string;
  readonly toBotId: string;
  readonly task: string;
  readonly context?: string;
  readonly chain?: ReadonlyArray<{ botId: string; instruction: string }>;
  /** Idempotency key (interop): a retry with the same key replays the task. */
  readonly idempotencyKey?: string;
  readonly authorization?: TaskAuthorizationRef;
}

export interface TaskDispatcherOptions {
  readonly db: OpenedDatabase;
  readonly chat: ChatManager;
  /** Chain hops bypass the gateway; each hop still leaves one audit record. */
  readonly audit: AuditSink;
  readonly now?: () => Date;
  /** T7/Q6: total hops per relay chain, 2–4. Default 3 (contract caps at 4). */
  readonly chainLimit?: number;
  /** Q3: queued tasks tolerated per executor bot before dispatch refuses. */
  readonly queuedCapPerBot?: number;
  /**
   * Live UI language for every user- and model-visible string (delivery
   * notices, handoff framing, rate-limit errors). The desktop pushes the
   * resolved preference via settings.update { ui.locale }; defaults to zh.
   */
  readonly locale?: () => DispatchLocale;
}

export type DispatchLocale = "zh" | "en";

const RESULT_SUMMARY_MAX = 2_000;
const REASON_MAX = 500;

/**
 * Dispatcher copy in both UI languages. The zh column is byte-identical to
 * the pre-locale strings: stored notices replay into model context and the
 * existing tests pin them, so only NEW rows follow a language switch.
 */
type DispatchStrings = {
  readonly statusLabels: Readonly<Record<TaskStatus, string>>;
  readonly queuedCapReached: (cap: number) => string;
  readonly cancelled: string;
  readonly cancelledCascaded: string;
  readonly interruptedByRestart: string;
  readonly chainAuthInvalid: string;
  readonly endpointUnavailableSummary: string;
  readonly endpointUnavailableChain: string;
  readonly endpointUnavailableNotice: string;
  readonly turnCancelled: string;
  readonly completed: string;
  readonly failed: string;
  readonly upstreamFailed: (reason: string) => string;
  readonly skippedHops: (count: number) => string;
  readonly chainInterruptedNotice: (
    hop: number,
    total: number,
    remaining: string,
    reason: string,
  ) => string;
  readonly handoffGoal: (instruction: string) => string;
  readonly handoffSummary: (summary: string) => string;
  readonly handoffNoSummary: string;
  readonly replyBriefly: string;
  readonly taskMarker: (instruction: string) => string;
  readonly unknownBot: string;
  readonly hopLabel: (hop: number, total: number) => string;
  readonly resultPreview: (summary: string) => string;
  readonly notice: (
    status: string,
    hopLabel: string,
    sender: string,
    executor: string,
    verdict: string,
  ) => string;
};

const DISPATCH_STRINGS: Readonly<Record<DispatchLocale, DispatchStrings>> = {
  zh: {
    statusLabels: {
      queued: "排队中",
      running: "执行中",
      done: "已完成",
      failed: "已失败",
      cancelled: "已取消",
      skipped: "已跳过",
      interrupted: "已中断",
    },
    queuedCapReached: (cap) => `该 bot 已有 ${cap} 个排队任务，请稍后再派发`,
    cancelled: "已被取消",
    cancelledCascaded: "已被取消（随根任务级联）",
    interruptedByRestart: "因 Host 重启而中断，可重新派发",
    chainAuthInvalid: "接力链授权已失效或策略改为拒绝",
    endpointUnavailableSummary: "执行者或发起者 bot 不存在或已归档",
    endpointUnavailableChain: "执行者不可用，接力链停止",
    endpointUnavailableNotice: "已失败（执行者不可用）",
    turnCancelled: "回合被取消",
    completed: "已完成",
    failed: "已失败",
    upstreamFailed: (reason) => `上游任务失败：${reason}`,
    skippedHops: (count) => `剩余 ${count} 跳已跳过。`,
    chainInterruptedNotice: (hop, total, remaining, reason) =>
      `任务通知（接力链中断）：第 ${hop}/${total} 跳未完成，${remaining}原因：${reason}`,
    handoffGoal: (instruction) => `【上游交接 · 目标】${instruction}`,
    handoffSummary: (summary) => `【上游交接 · 完成摘要】${summary}`,
    handoffNoSummary: "（上游未产出摘要）",
    replyBriefly:
      "这是你和另一个 bot 的私下交接。整条回复只能是要交出去的那一句，像当面把那句话递过去。不要复述任务，不要加解释、寒暄、状态或追问。别人让你说「你好」，你就只回：你好。",
    taskMarker: (instruction) => `【任务】${instruction}`,
    unknownBot: "未知 bot",
    hopLabel: (hop, total) => `（第 ${hop}/${total} 跳）`,
    resultPreview: (summary) => `\n结果预览：${summary}`,
    notice: (status, hopLabel, sender, executor, verdict) =>
      `任务通知（${status}）${hopLabel}：「${sender}」派发给「${executor}」的任务${verdict}。`,
  },
  en: {
    statusLabels: {
      queued: "Queued",
      running: "Running",
      done: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      skipped: "Skipped",
      interrupted: "Interrupted",
    },
    queuedCapReached: (cap) => `this bot already has ${cap} queued tasks; try again later`,
    cancelled: "cancelled",
    cancelledCascaded: "cancelled (cascaded with the root task)",
    interruptedByRestart: "interrupted by a Host restart; dispatch again to rerun",
    chainAuthInvalid: "relay chain authorization is no longer valid or the policy became deny",
    endpointUnavailableSummary: "executor or sender bot does not exist or is archived",
    endpointUnavailableChain: "executor unavailable; relay chain stops",
    endpointUnavailableNotice: "failed (executor unavailable)",
    turnCancelled: "turn cancelled",
    completed: "completed",
    failed: "failed",
    upstreamFailed: (reason) => `upstream task failed: ${reason}`,
    skippedHops: (count) => `${count} remaining hop(s) skipped.`,
    chainInterruptedNotice: (hop, total, remaining, reason) =>
      `Task notice (relay chain interrupted): hop ${hop}/${total} did not finish. ` +
      `${remaining}Reason: ${reason}`,
    handoffGoal: (instruction) => `[Upstream handoff · Goal] ${instruction}`,
    handoffSummary: (summary) => `[Upstream handoff · Completion summary] ${summary}`,
    handoffNoSummary: "(no summary produced upstream)",
    replyBriefly:
      "This is a private handoff with another bot. Your whole reply is the one line being handed over, as if you said it to their face. Do not restate the task, add an explanation, a greeting, a status, or a follow-up. If asked to say hello, reply only: hello.",
    taskMarker: (instruction) => `[Task] ${instruction}`,
    unknownBot: "unknown bot",
    hopLabel: (hop, total) => ` (hop ${hop}/${total})`,
    resultPreview: (summary) => `\nResult preview: ${summary}`,
    notice: (status, hopLabel, sender, executor, verdict) =>
      `Task notice (${status})${hopLabel}: task dispatched from "${sender}" to "${executor}" ` +
      `${verdict}.`,
  },
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function invalid(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "INVALID_INPUT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

function unauthorized(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "UNAUTHORIZED_PATH",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

export class TaskDispatcher {
  private readonly draining = new Set<string>();
  private readonly db: OpenedDatabase;
  private readonly chat: ChatManager;
  private readonly audit: AuditSink;
  private readonly now: () => Date;
  private readonly chainLimit: number;
  private readonly queuedCapPerBot: number;
  private readonly locale: () => DispatchLocale;

  constructor(options: TaskDispatcherOptions) {
    this.db = options.db;
    this.chat = options.chat;
    this.audit = options.audit;
    this.now = options.now ?? (() => new Date());
    const chainLimit = options.chainLimit ?? 3;
    if (chainLimit < 2 || chainLimit > TASK_CHAIN_MAX) {
      throw invalid("relay chain limit must be between 2 and 4", { chainLimit });
    }
    this.chainLimit = chainLimit;
    this.queuedCapPerBot = options.queuedCapPerBot ?? 10;
    this.locale = options.locale ?? (() => "zh");
  }

  private strings(): DispatchStrings {
    return DISPATCH_STRINGS[this.locale()];
  }

  /**
   * Persist a dispatch (with its whole pre-declared relay chain) as queued
   * tasks and kick the executor queues. Hops beyond the first start running
   * only when the previous hop settles as `done` (T7 R-13.2); every hop
   * marked with meta kind "dispatch" appears in the executor's session when
   * its turn starts.
   */
  async dispatch(input: DispatchInput): Promise<Task> {
    // Idempotency (interop): a retried submission with the same key replays
    // the first task this sender created — no new rows, no queueing, no
    // second dispatch marker.
    if (input.idempotencyKey !== undefined) {
      const existing = getTaskByIdempotencyKey(this.db, input.fromBotId, input.idempotencyKey);
      if (existing !== undefined) {
        this.auditDispatch(existing, "ok", "idempotent replay: this idempotencyKey already created the task");
        return existing;
      }
    }
    const me = this.requireLiveSender(input.fromBotId);
    const target = this.requireLiveBot(input.toBotId);
    if (input.toBotId === me.id) {
      throw invalid("a bot cannot dispatch a task to itself");
    }
    // Interop: cross-group dispatch is allowed. Only identity, a simple
    // chain path, the chain cap and the per-bot queue cap remain.
    for (const hop of input.chain ?? []) {
      this.requireLiveBot(hop.botId);
      if (hop.botId === me.id || hop.botId === input.toBotId) {
        throw invalid("relay chain botIds must form a simple path (no repeats)", {
          botId: hop.botId,
        });
      }
    }
    const chainTotal = 1 + (input.chain?.length ?? 0);
    if (chainTotal > this.chainLimit) {
      throw invalid(
        `relay chain exceeds this host's limit of ${this.chainLimit} hops (contract hard cap ${TASK_CHAIN_MAX})`,
        { chainTotal, chainLimit: this.chainLimit },
      );
    }
    if (countQueuedTasksForBot(this.db, target.id) >= this.queuedCapPerBot) {
      throw new EngineError({
        code: "RATE_LIMITED",
        message: this.strings().queuedCapReached(this.queuedCapPerBot),
        retryable: true,
      });
    }

    const at = this.now().toISOString();
    const rootId = randomUUID();
    const root = insertTask(this.db, {
      id: rootId,
      fromBotId: me.id,
      toBotId: target.id,
      instruction: input.task,
      rootTaskId: rootId,
      chainIndex: 0,
      chainTotal,
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
      ...(input.authorization !== undefined
        ? {
            authorization: {
              ...(input.authorization.approvalId !== undefined
                ? { approvalId: input.authorization.approvalId }
                : {}),
              ...(input.authorization.grantIds !== undefined
                ? { grantIds: input.authorization.grantIds }
                : {}),
            },
          }
        : {}),
      createdAt: at,
    });
    let upstreamBotId = target.id;
    for (const [index, hop] of (input.chain ?? []).entries()) {
      const hopTask = insertTask(this.db, {
        id: randomUUID(),
        fromBotId: upstreamBotId,
        toBotId: hop.botId,
        instruction: hop.instruction,
        rootTaskId: rootId,
        chainIndex: index + 1,
        chainTotal,
        createdAt: at,
      });
      upstreamBotId = hopTask.toBotId;
    }
    this.auditDispatch(root, "ok", undefined);
    void this.drain(target.id);
    return root;
  }

  /**
   * Human cancel (FR-6, Q2: v1 never model-initiated). Queued tasks cancel
   * directly, running tasks ride the chat cancel path, and queued relay
   * hops of the same root cancel with the root either way (R-13.5).
   */
  cancel(taskId: string): Task {
    const task = getTask(this.db, taskId);
    if (task === undefined) {
      throw invalid("task not found", { taskId });
    }
    if (task.status === "queued") {
      const cancelled = finishTask(this.db, taskId, { status: "cancelled" });
      this.emitStatus(cancelled, "queued", "cancelled", "cancelled by human");
      this.writeNotice(cancelled, this.strings().cancelled);
    } else if (task.status === "running") {
      // The turn settles asynchronously: chat.cancel aborts the attempt and
      // the pump marks the row cancelled (or failed) when it observes it.
      this.chat.cancel(chatSessionIdFor(task.toBotId));
    } else {
      throw invalid(`task is already ${task.status}`, { taskId, status: task.status });
    }
    for (const hop of listQueuedHopsOfRoot(this.db, task.rootTaskId)) {
      if (hop.id === taskId) continue;
      const cascaded = finishTask(this.db, hop.id, { status: "cancelled" });
      this.emitStatus(cascaded, "queued", "cancelled", "relay chain cancelled");
      this.writeNotice(cascaded, this.strings().cancelledCascaded);
    }
    return getTask(this.db, taskId) ?? task;
  }

  list(filter: ListTasksFilter = {}): Task[] {
    return listTasks(this.db, filter);
  }

  /** FR-10: host restart marks queued/running work interrupted, queryable. */
  sweepInterrupted(): Task[] {
    const swept = sweepInterruptedTasks(this.db);
    for (const task of swept) {
      this.emitStatus(
        task,
        task.status === "running" ? "running" : "queued",
        "interrupted",
        "host restarted before the turn finished",
      );
      this.writeNotice(task, this.strings().interruptedByRestart);
    }
    return swept;
  }

  // -------------------------------------------------------------------------
  // Per-bot serial queue
  // -------------------------------------------------------------------------

  private async drain(botId: string): Promise<void> {
    if (this.draining.has(botId)) return;
    this.draining.add(botId);
    try {
      for (;;) {
        const task = nextQueuedTask(this.db, botId);
        if (task === undefined) break;
        await this.runTask(task);
        // Safety: runTask must move the row out of `queued`. A bug that
        // leaves it queued would otherwise spin this loop forever.
        const after = getTask(this.db, task.id);
        if (after !== undefined && after.status === "queued") {
          throw new Error("task pump did not advance a queued row");
        }
      }
    } catch {
      // The pump is fire-and-forget and never rejects: a dead database
      // (host shutdown) or a broken turn leaves the row in its last
      // persisted, queryable state instead of crashing the host.
    } finally {
      this.draining.delete(botId);
    }
  }

  private async runTask(task: Task): Promise<void> {
    const root = getTask(this.db, task.rootTaskId);
    if (root === undefined) {
      finishTask(this.db, task.id, { status: "failed", resultSummary: "root task record disappeared" });
      return;
    }
    // R-13.6: relay hops revalidate the first hop's authorization right
    // before their turn starts — revocation or a deny policy stops the chain.
    if (task.chainIndex > 0 && !this.revalidateChainAuthorization(root)) {
      const skipped = finishTask(this.db, task.id, { status: "skipped" });
      this.emitStatus(skipped, "queued", "skipped", "relay authorization is no longer valid");
      this.skipRemainingHops(skipped, this.strings().chainAuthInvalid);
      return;
    }
    const executor = getBot(this.db, task.toBotId);
    const sender = getBot(this.db, task.fromBotId);
    if (executor === undefined || executor.archivedAt !== null || sender === undefined) {
      const failed = finishTask(this.db, task.id, {
        status: "failed",
        resultSummary: this.strings().endpointUnavailableSummary,
      });
      this.emitStatus(failed, "queued", "failed", "executor or sender unavailable");
      this.skipRemainingHops(failed, this.strings().endpointUnavailableChain);
      this.writeNotice(failed, this.strings().endpointUnavailableNotice);
      return;
    }

    const running = markTaskRunning(this.db, task.id);
    this.emitStatus(running, "queued", "running");
    const sessionId = chatSessionIdFor(executor.id);
    // The handoff is a private exchange. The human thread stays out of the
    // worker's prompt so a task cannot continue that conversation or dump it
    // back as the reply.
    const upstream = this.upstreamResultOf(task);
    const marker = this.composePrompt(task, upstream);
    const markerRow = appendChatMessage(this.db, {
      botId: executor.id,
      sessionId,
      role: "user",
      text: marker,
      meta: { kind: "dispatch", taskId: task.id, fromBotId: task.fromBotId },
    });
    appendWorkerMessageId(this.db, task.id, markerRow.id);

    try {
      const outcome = await this.chat.send(executor, marker, []);
      const assistant = appendChatMessage(this.db, {
        botId: executor.id,
        sessionId,
        role: "assistant",
        text: outcome.finalResponse,
        meta: { kind: "dispatch_reply", taskId: task.id, fromBotId: task.fromBotId },
      });
      appendWorkerMessageId(this.db, task.id, assistant.id);
      const done = finishTask(this.db, task.id, {
        status: "done",
        resultSummary: truncate(outcome.finalResponse.trim(), RESULT_SUMMARY_MAX),
      });
      this.emitStatus(done, "running", "done", "executor turn completed");
      this.writeNotice(done, this.strings().completed);
      this.auditRelayHop(done, "ok", undefined);
      // T7: the next relay hop usually targets a DIFFERENT bot — kick its
      // queue so the chain keeps moving (its start revalidates R-13.6).
      const hops = listTasks(this.db, { rootTaskId: task.rootTaskId, limit: 100 });
      const next = hops.find((hop) => hop.chainIndex === task.chainIndex + 1);
      if (next !== undefined && next.status === "queued") {
        void this.drain(next.toBotId);
      }
    } catch (error) {
      // The row may already be terminal when post-completion bookkeeping
      // itself failed above; never fight the state machine — only a row
      // still in `running` settles through this catch.
      const current = getTask(this.db, task.id);
      if (current === undefined || current.status !== "running") {
        throw error;
      }
      const cancelled =
        (error instanceof EngineError || error instanceof NodeExecutionError) &&
        error.code === "CANCELLED";
      const reason = truncate(
        error instanceof Error ? error.message : String(error),
        REASON_MAX,
      );
      const finished = finishTask(this.db, task.id, {
        status: cancelled ? "cancelled" : "failed",
        resultSummary: cancelled ? this.strings().turnCancelled : truncate(reason, RESULT_SUMMARY_MAX),
      });
      this.emitStatus(
        finished,
        "running",
        finished.status,
        cancelled ? "cancelled via chat.cancel" : reason,
      );
      this.writeNotice(finished, cancelled ? this.strings().cancelled : this.strings().failed);
      this.auditRelayHop(finished, "rejected", reason);
      if (!cancelled) {
        this.skipRemainingHops(finished, this.strings().upstreamFailed(reason));
      }
    }
  }

  /** R-13.4: a failed hop stops the chain; remaining queued hops skip. */
  private skipRemainingHops(failedHop: Task, reason: string): void {
    const queued = listQueuedHopsOfRoot(this.db, failedHop.rootTaskId).filter(
      (hop) => hop.chainIndex > failedHop.chainIndex,
    );
    for (const hop of queued) {
      const skipped = finishTask(this.db, hop.id, { status: "skipped" });
      this.emitStatus(skipped, "queued", "skipped", reason);
    }
    // One interruption notice per chain stop, even when nothing remained
    // queued — the coordinator must always learn the chain ended early.
    const root = getTask(this.db, failedHop.rootTaskId);
    if (root === undefined) return;
    const s = this.strings();
    const remaining = queued.length > 0 ? s.skippedHops(queued.length) : "";
    appendChatMessage(this.db, {
      botId: root.fromBotId,
      sessionId: chatSessionIdFor(root.fromBotId),
      role: "user",
      text: s.chainInterruptedNotice(
        failedHop.chainIndex + 1,
        failedHop.chainTotal,
        remaining,
        truncate(reason, REASON_MAX),
      ),
      meta: {
        kind: "task_notice",
        taskId: failedHop.id,
        status: "skipped",
        resultSummary: truncate(reason, RESULT_SUMMARY_MAX),
      },
    });
    this.auditRelayHop(failedHop, "rejected", `chain interrupted: ${reason}`);
  }
  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private upstreamResultOf(task: Task): { instruction: string; resultSummary: string | null } | undefined {
    if (task.chainIndex === 0) return undefined;
    const hops = listTasks(this.db, { rootTaskId: task.rootTaskId, limit: 100 });
    const previous = hops.find((hop) => hop.chainIndex === task.chainIndex - 1);
    if (previous === undefined) return undefined;
    return { instruction: previous.instruction, resultSummary: previous.resultSummary };
  }

  private composePrompt(task: Task, upstream: { instruction: string; resultSummary: string | null } | undefined): string {
    const s = this.strings();
    const parts: string[] = [s.replyBriefly];
    if (upstream !== undefined) {
      // T7 R-13.7: fixed structured handoff header for relay hops.
      parts.push(
        s.handoffGoal(truncate(upstream.instruction, 800)),
        s.handoffSummary(upstream.resultSummary ?? s.handoffNoSummary),
      );
    }
    parts.push(s.taskMarker(task.instruction));
    return parts.join("\n\n");
  }
  private requireLiveSender(botId: string) {
    const bot = getBot(this.db, botId);
    if (bot === undefined || bot.archivedAt !== null) {
      throw unauthorized("dispatch sender bot does not exist or is archived", { botId });
    }
    // Interop: no role gate — any live bot may dispatch. Bot-to-bot messaging
    // is not a human permission; the executor's own policy governs its turn.
    return bot;
  }

  private requireLiveBot(botId: string) {
    const bot = getBot(this.db, botId);
    if (bot === undefined || bot.archivedAt !== null) {
      throw invalid("task endpoint bot does not exist or is archived", { botId });
    }
    return bot;
  }

  private emitStatus(
    task: Task,
    from: TaskStatus,
    to: TaskStatus,
    reason?: string,
  ): void {
    void appendTaskEvent(this.db, {
      eventId: randomUUID(),
      taskId: task.id,
      sequence: maxTaskEventSequence(this.db, task.id) + 1,
      timestamp: this.now().toISOString(),
      type: "task.status",
      payload: {
        taskId: task.id,
        from,
        to,
        ...(reason !== undefined ? { reason } : {}),
      },
    });
  }

  /** FR-7: delivery notice into the root coordinator's session. */
  private writeNotice(task: Task, verdict: string): void {
    const root = getTask(this.db, task.rootTaskId);
    if (root === undefined) return;
    const s = this.strings();
    const sender = getBot(this.db, task.fromBotId);
    const executor = getBot(this.db, task.toBotId);
    const senderName = sender?.name ?? s.unknownBot;
    const executorName = executor?.name ?? s.unknownBot;
    const hopLabel = root.chainTotal > 1 ? s.hopLabel(task.chainIndex + 1, root.chainTotal) : "";
    const preview =
      task.resultSummary === null || task.resultSummary === ""
        ? ""
        : s.resultPreview(truncate(task.resultSummary, 400));
    appendChatMessage(this.db, {
      botId: root.fromBotId,
      sessionId: chatSessionIdFor(root.fromBotId),
      role: "user",
      text: `${s.notice(s.statusLabels[task.status], hopLabel, senderName, executorName, verdict)}${preview}`,
      meta: {
        kind: "task_notice",
        taskId: task.id,
        status: task.status,
        ...(task.resultSummary !== null && task.resultSummary !== ""
          ? { resultSummary: truncate(task.resultSummary, RESULT_SUMMARY_MAX) }
          : {}),
      },
    });
  }

  private auditDispatch(task: Task, outcome: AuditRecord["outcome"], reason?: string): void {
    void this.audit.append({
      timestamp: this.now().toISOString(),
      caller: chatSessionIdFor(task.fromBotId),
      tool: "dispatch_task",
      paramsDigest: createHash("sha256")
        .update(JSON.stringify({ taskId: task.id, toBotId: task.toBotId, chainTotal: task.chainTotal }))
        .digest("hex"),
      resultDigest: "-",
      outcome,
      ...(reason !== undefined ? { reason } : {}),
      botId: task.fromBotId,
      sessionId: chatSessionIdFor(task.fromBotId),
      decision: "chain",
    });
  }

  /** T7 audit: one record per hop with the upstream bot as the actor. */
  private auditRelayHop(task: Task, outcome: AuditRecord["outcome"], reason?: string): void {
    void this.audit.append({
      timestamp: this.now().toISOString(),
      caller: chatSessionIdFor(task.fromBotId),
      tool: "dispatch_task",
      paramsDigest: createHash("sha256")
        .update(JSON.stringify({ taskId: task.id, rootTaskId: task.rootTaskId, chainIndex: task.chainIndex }))
        .digest("hex"),
      resultDigest: "-",
      outcome,
      ...(reason !== undefined ? { reason } : {}),
      botId: task.fromBotId,
      sessionId: chatSessionIdFor(task.fromBotId),
      decision: "chain",
    });
  }

  /**
   * R-13.6 revalidation for relay hops: bot-to-bot messaging is not a human
   * permission, so a stored ask or deny on app.dispatch_task does not stop
   * the chain. When the first hop recorded authorization refs, every grant
   * must still be unrevoked and unexpired
   * and the approval must not have been denied/cancelled/expired. Grant use
   * counts are NOT charged again — the single chain approval covers all
   * pre-declared hops (R-13.1/R-13.2). A chain dispatched without recorded
   * authorization (direct human method call) has nothing to revalidate
   * beyond the policy — the human can always cancel.
   */
  private revalidateChainAuthorization(root: Task): boolean {
    const authorization = this.readAuthorization(root);
    if (authorization === undefined) return true;
    if (authorization.approvalId !== undefined) {
      const approval = getPermissionApproval(this.db, authorization.approvalId);
      if (approval !== undefined && ["denied", "cancelled", "expired"].includes(approval.status)) {
        return false;
      }
    }
    if (authorization.grantIds !== undefined && authorization.grantIds.length > 0) {
      const known = new Map(
        listPermissionGrants(this.db, { includeInactive: true, limit: 100, generation: 0 }).map(
          (grant) => [grant.id, grant],
        ),
      );
      for (const grantId of authorization.grantIds) {
        const grant = known.get(grantId);
        if (grant === undefined) return false;
        if (grant.revokedAt !== null) return false;
        if (grant.expiresAt !== null && grant.expiresAt <= this.now().toISOString()) {
          return false;
        }
      }
    }
    return true;
  }

  private readAuthorization(root: Task): TaskAuthorizationRef | undefined {
    const row = this.db.raw
      .prepare("SELECT authorization_json FROM tasks WHERE id = ?;")
      .get(root.id) as { authorization_json: string | null } | undefined;
    if (row === undefined || row.authorization_json === null) return undefined;
    try {
      const parsed = JSON.parse(row.authorization_json) as {
        approvalId?: string;
        grantIds?: string[];
      };
      if (parsed.approvalId === undefined && parsed.grantIds === undefined) return undefined;
      return {
        ...(parsed.approvalId !== undefined ? { approvalId: parsed.approvalId } : {}),
        ...(parsed.grantIds !== undefined ? { grantIds: parsed.grantIds } : {}),
      };
    } catch {
      return undefined;
    }
  }
}
