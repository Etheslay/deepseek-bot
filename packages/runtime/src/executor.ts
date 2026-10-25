/**
 * Node executor port (ARCHITECTURE.md §2: the Harness adapter plugs in here).
 *
 * The engine owns orchestration, persistence and the failure policy; the
 * executor owns talking to the fixed-version Harness. v0.1 upstream has no
 * SDK cancel method (D01 §8.2), so cooperative cancellation is signalled via
 * `signal` and the host maps it to process teardown + `session/resume`.
 */
import {
  NON_RETRYABLE_BY_DEFAULT,
  TEXT_LIMITS,
  type Bot,
  type ErrorCode,
  type NodeRun,
  type Run,
  type WorkflowNode,
} from "@deepseek-bot/contracts";
import type {
  AuthorizedAction,
  PermissionDecision,
  ToolActionRequest,
} from "./permissions/actions.js";

/**
 * Permission handle for one node attempt (D08). The executor MUST route
 * every side-effecting tool action through `authorize` — it resolves only
 * after a policy allow or a consumed one-time approval, and throws a
 * classified NodeExecutionError otherwise. `evaluate` is a non-blocking
 * preview for UI/display decisions and grants nothing.
 */
export interface NodePermissionHandle {
  evaluate(action: ToolActionRequest): Promise<PermissionDecision>;
  authorize(action: ToolActionRequest): Promise<AuthorizedAction>;
}

export interface BotNodeExecutionContext {
  readonly run: Run;
  readonly nodeRun: NodeRun;
  readonly node: WorkflowNode;
  readonly bot: Bot;
  /** Values resolved from predecessor outputs through edge mappings. */
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  /** Pre-execution tool permission gate for this attempt (D08). */
  readonly permissions: NodePermissionHandle;
}

export interface BotNodeExecutionResult {
  /** Values keyed by outputKey; consumed by successors through edges. */
  readonly outputs: Readonly<Record<string, unknown>>;
  /** Harness session this attempt is bound to (CONTRACTS §2 NodeRun). */
  readonly sessionId?: string | null;
}

export interface NodeExecutor {
  executeBotNode(context: BotNodeExecutionContext): Promise<BotNodeExecutionResult>;
}

/**
 * Classified executor failure. `retryable` follows the contract defaults;
 * `retryAfterMs` carries a server-provided Retry-After hint.
 */
export class NodeExecutionError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(options: {
    code: ErrorCode;
    message: string;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = "NodeExecutionError";
    this.code = options.code;
    this.retryable =
      options.retryable ?? !NON_RETRYABLE_BY_DEFAULT.includes(options.code);
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Untyped executor failures are treated as transient runtime failures. */
export function nodeExecutionErrorFromUnknown(error: unknown): NodeExecutionError {
  if (error instanceof NodeExecutionError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new NodeExecutionError({
    code: "RUNTIME_UNAVAILABLE",
    message: `node executor failed unexpectedly: ${message}`,
    retryable: true,
  });
}

/** Truncated, code-prefixed reason stored on NodeRun rows and events. */
export function failureReason(error: NodeExecutionError): string {
  const reason = `${error.code}: ${error.message}`;
  return reason.length > TEXT_LIMITS.reason
    ? reason.slice(0, TEXT_LIMITS.reason)
    : reason;
}
