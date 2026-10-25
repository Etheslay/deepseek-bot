/**
 * One Harness runtime subprocess bound to one bot node attempt (D12).
 *
 * ARCHITECTURE §5 and D01 §8.2/§8.4 shape this class: upstream 0.2.1-rc.2
 * speaks newline-delimited JSON-RPC over stdio and has no cancel method —
 * abandoning a turn means stopping the process and repairing the persisted
 * session through `session/resume` later. Each attempt therefore owns its
 * whole subprocess (provider/model routes are process-wide, upstream
 * `InitializeParams`), so cancelling one node never disturbs a concurrently
 * running node and cleanup is `kill()`.
 *
 * The wire transport is the upstream `JsonRpcLineTransport`; this module adds
 * only process ownership and the turn-settlement loop (prompt enqueue receipt
 * → session events → `session.status: idle`), mirroring the upstream client's
 * own `HarnessSession.run` semantics without its subscription abstraction.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  JsonRpcLineTransport,
  type InitializeResult,
} from "@deepseek-ai/dsh-sdk-protocol";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import {
  HarnessAttemptClosedError,
  nodeExecutionErrorFromHarness,
  type HarnessFailureContext,
} from "./errors.js";

/** How a finished turn ended, derived from the last `turn/end` event. */
export type TurnEndKind = string | undefined;

/** Minimal structural view of a session-log event envelope (fixtures/d01). */
export interface SessionEventEnvelope {
  readonly type: string;
  readonly seq?: number;
  readonly time?: number;
  readonly data?: unknown;
}

export interface HarnessAttemptOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Bound on the `initialize` handshake; upstream cold starts measured 4-5s (D01 §8.5). */
  readonly initializeTimeoutMs?: number;
  /** Bound on the graceful `shutdown` exchange. */
  readonly shutdownTimeoutMs?: number;
}

export interface HarnessInitializeParams {
  readonly cwd: string;
  readonly provider: string;
  readonly model: string;
  readonly maxTokens?: number;
}

export interface TurnOutcome {
  /** Concatenated text of the last assistant message ("" when none). */
  readonly finalResponse: string;
  /** Session events from the enqueue receipt onwards, in wire order. */
  readonly events: SessionEventEnvelope[];
  /** `kind` of the last `turn/end` event (`completed` / `interrupted` / `aborted`…). */
  readonly turnEndKind: TurnEndKind;
}

interface Notification {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

const DEFAULT_INITIALIZE_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const EXIT_GRACE_MS = 3_000;
const STDERR_TAIL_LINES = 8;

export class HarnessAttempt {
  private child: ChildProcess | undefined;
  private transport: JsonRpcLineTransport | undefined;
  private closed = false;
  private cancelRequested = false;
  private exitCode: number | null | undefined;
  private readonly stderrLines: string[] = [];
  private readonly queue: Notification[] = [];
  private waiters: Array<{
    resolve: (notification: Notification) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(private readonly options: HarnessAttemptOptions) {}

  /** Whether the runtime process has exited. */
  get exited(): boolean {
    return this.exitCode !== undefined;
  }

  get cancelled(): boolean {
    return this.cancelRequested;
  }

  /** stderr tail for diagnostics (bounded, never sent to the model or UI raw). */
  get stderrTail(): readonly string[] {
    return this.stderrLines;
  }

  /**
   * Spawn the runtime and perform the process-wide `initialize` handshake.
   * Rejects with a classified NodeExecutionError on spawn failure, handshake
   * timeout or a wire error response.
   */
  async start(params: HarnessInitializeParams): Promise<InitializeResult["serverInfo"]> {
    if (this.closed) {
      throw new HarnessAttemptClosedError("attempt is closed");
    }
    if (this.child !== undefined) {
      throw new Error("harness attempt already started");
    }
    const child = spawn(this.options.command, [...this.options.args], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdin.on("error", () => {
      // Writes racing process death EPIPE; the exit edge fails pending work.
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.length === 0) continue;
        this.stderrLines.push(line);
        if (this.stderrLines.length > STDERR_TAIL_LINES) {
          this.stderrLines.shift();
        }
      }
    });
    child.once("error", (error) => {
      this.transport?.close();
      this.failWaiters(new HarnessAttemptClosedError(`failed to start: ${error.message}`));
    });
    child.once("close", (code) => {
      this.exitCode = code ?? null;
      this.transport?.close();
      this.failWaiters(
        new HarnessAttemptClosedError(`harness runtime exited (process exit code ${code ?? "unknown"})`),
      );
    });

    const transport = new JsonRpcLineTransport(child.stdout, child.stdin);
    transport.onNotification((method, params) => this.enqueueNotification({ method, params }));
    transport.start();
    this.transport = transport;

    const timeoutMs = this.options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
    try {
      const result = (await this.request("initialize", { ...params }, timeoutMs)) as
        | InitializeResult
        | undefined;
      if (
        result === undefined ||
        typeof result.serverInfo?.name !== "string" ||
        typeof result.serverInfo?.version !== "string"
      ) {
        throw new NodeExecutionError({
          code: "RUNTIME_UNAVAILABLE",
          message: "initialize returned no server identity",
          retryable: true,
        });
      }
      return result.serverInfo;
    } catch (error) {
      throw nodeExecutionErrorFromHarness(error, this.failureContext());
    }
  }

  /**
   * Restore a persisted session from the harness home without prompting
   * (D01 §8.2: the repair path after a killed turn). Unknown or already
   * owned sessions are wire errors and reject.
   */
  async resume(sessionId: string): Promise<void> {
    try {
      await this.request("session/resume", { sessionId });
    } catch (error) {
      throw nodeExecutionErrorFromHarness(error, this.failureContext());
    }
  }

  /**
   * Send one prompt and settle the turn: skip notifications until the
   * durable enqueue receipt for our message, collect session events, return
   * when the agent reports idle. Abort kills the subprocess immediately;
   * the rejection is classified with `CANCELLED`.
   */
  async runTurn(sessionId: string, prompt: string, signal?: AbortSignal): Promise<TurnOutcome> {
    if (signal?.aborted) {
      this.cancelRequested = true;
      throw nodeExecutionErrorFromHarness(new HarnessAttemptClosedError("cancelled"), this.failureContext());
    }
    const abort = (): void => {
      this.cancelRequested = true;
      void this.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const messageId = (await this.request("session/prompt", {
        sessionId,
        contentBlocks: [{ type: "text", text: prompt }],
      })) as { messageId?: unknown } | undefined;
      if (typeof messageId?.messageId !== "string") {
        throw new NodeExecutionError({
          code: "RUNTIME_UNAVAILABLE",
          message: "session/prompt returned no message id",
          retryable: true,
        });
      }
      return await this.awaitTurnSettle(sessionId, messageId.messageId);
    } catch (error) {
      throw nodeExecutionErrorFromHarness(error, this.failureContext());
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  /**
   * Graceful teardown: `shutdown` request, bounded exit wait, SIGKILL
   * fallback. Idempotent; safe after a crash.
   */
  async shutdown(): Promise<void> {
    if (this.closed || this.child === undefined) {
      this.closed = true;
      return;
    }
    this.closed = true;
    const child = this.child;
    const timeoutMs = this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    try {
      await this.request("shutdown", {}, timeoutMs);
    } catch {
      // A failed shutdown exchange still ends with process termination below.
    }
    await this.waitForExit(child, EXIT_GRACE_MS);
    if (!child.killed && this.exitCode === undefined) {
      child.kill("SIGKILL");
      await this.waitForExit(child, EXIT_GRACE_MS);
    }
  }

  /** Immediate teardown for cancellation/timeout (D01 §8.2: kill = abandon). */
  async kill(): Promise<void> {
    this.cancelRequested = true;
    const child = this.child;
    if (child === undefined || child.killed) {
      return;
    }
    child.kill("SIGKILL");
    await this.waitForExit(child, EXIT_GRACE_MS);
  }

  /** Fail anything still pending and mark the attempt unusable. */
  async dispose(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child !== undefined && !child.killed && this.exitCode === undefined) {
      child.kill("SIGKILL");
    }
    this.transport?.close();
    this.failWaiters(new HarnessAttemptClosedError("attempt disposed"));
    if (child !== undefined && this.exitCode === undefined) {
      await this.waitForExit(child, EXIT_GRACE_MS);
    }
  }

  failureContext(): HarnessFailureContext {
    return {
      cancelRequested: this.cancelRequested,
      exitCode: this.exitCode,
      stderrTail: this.stderrTail,
    };
  }

  private request(method: string, params: object, timeoutMs?: number): Promise<unknown> {
    const transport = this.transport;
    if (transport === undefined || this.closed) {
      return Promise.reject(new HarnessAttemptClosedError("harness runtime is closed"));
    }
    const controller = new AbortController();
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      // Abandoning the pending entry only stops the wait; the runtime keeps
      // running until kill/shutdown (upstream has no request-level cancel).
      controller.abort(new Error(`harness request '${method}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer !== undefined) {
      timer.unref?.();
    }
    return transport.request(method, params, controller.signal).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  private enqueueNotification(notification: Notification): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(notification);
      return;
    }
    this.queue.push(notification);
  }

  private nextNotification(): Promise<Notification> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.closed || this.exited) {
      return Promise.reject(
        new HarnessAttemptClosedError("harness runtime exited before the turn settled"),
      );
    }
    return new Promise<Notification>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private failWaiters(error: Error): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  private waitForExit(child: ChildProcess, graceMs: number): Promise<void> {
    if (this.exitCode !== undefined) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      timer.unref?.();
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async awaitTurnSettle(sessionId: string, messageId: string): Promise<TurnOutcome> {
    const events: SessionEventEnvelope[] = [];
    let finalResponse = "";
    let turnEndKind: TurnEndKind = undefined;
    let sawReceipt = false;
    let requestError: unknown;
    for (;;) {
      const notification = await this.nextNotification();
      if (notification.method === "session.event" && notification.params["sessionId"] === sessionId) {
        const event = notification.params["event"] as SessionEventEnvelope | undefined;
        if (event === undefined || typeof event.type !== "string") {
          continue;
        }
        if (!sawReceipt) {
          if (!isInboxReceipt(event, messageId)) {
            continue;
          }
          sawReceipt = true;
        }
        events.push(event);
        if (event.type === "assistant/message") {
          finalResponse = assistantText(event) ?? finalResponse;
        } else if (event.type === "turn/end") {
          turnEndKind = turnEndReasonKind(event);
        } else if (event.type === "agent/request-error") {
          // Model dispatch failures (auth, rate limit, unavailable routes)
          // surface here — the agent still settles to idle afterwards, so an
          // unclassified turn would report success with an empty response.
          requestError = event.data;
        }
      } else if (
        notification.method === "session.status" &&
        notification.params["sessionId"] === sessionId &&
        sawReceipt &&
        notification.params["status"] === "idle"
      ) {
        if (requestError !== undefined) {
          throw nodeExecutionErrorFromHarness(
            new Error(
              `harness reported a request error: ${JSON.stringify(requestError).slice(0, 300)}`,
            ),
            this.failureContext(),
          );
        }
        return { finalResponse, events, turnEndKind };
      }
    }
  }
}

/** Whether the event is the durable enqueue receipt for `messageId` (upstream api.ts). */
function isInboxReceipt(event: SessionEventEnvelope, messageId: string): boolean {
  if (event.type !== "agent/inbox/spliced") {
    return false;
  }
  const inserted = (event.data as { inserted?: unknown } | undefined)?.inserted;
  return (
    Array.isArray(inserted) &&
    inserted.some(
      (message) =>
        typeof message === "object" && message !== null && (message as { id?: unknown }).id === messageId,
    )
  );
}

/** Concatenated text blocks of one assistant message. */
function assistantText(event: SessionEventEnvelope): string | undefined {
  const content = (
    (event.data as { message?: { content?: unknown } } | undefined)?.message?.content
  );
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/** `reason.kind` of a turn/end event (completed / interrupted / aborted…). */
function turnEndReasonKind(event: SessionEventEnvelope): TurnEndKind {
  const reason = (event.data as { reason?: { kind?: unknown } } | undefined)?.reason;
  return typeof reason?.kind === "string" ? reason.kind : undefined;
}
