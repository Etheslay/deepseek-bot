/**
 * Failure classification for the Harness adapter (CONTRACTS §6 stable codes).
 *
 * The upstream SDK protocol (0.2.1-rc.2) has no typed error surface — wire
 * errors arrive as JSON-RPC error responses with free-form messages, and
 * transport loss is a plain Error. Classification is therefore explicit and
 * deliberately narrow: recognized patterns map to their stable codes,
 * everything else fails as retryable RUNTIME_UNAVAILABLE so a transient
 * harness outage never permanently fails a node that a retry could complete.
 *
 * D01 §8.2/§8.4: upstream has no cancel method and no request-level timeout —
 * cancellation means stopping the runtime process, which surfaces here as a
 * transport-closed failure while `cancelRequested` is set.
 */
import { NodeExecutionError } from "@deepseek-bot/runtime";
import { JsonRpcResponseError } from "@deepseek-ai/dsh-sdk-protocol";

/** Context a failure needs to distinguish cancellation from crashes. */
export interface HarnessFailureContext {
  /** True when the abort signal fired (engine cancel/timeout) before the failure. */
  readonly cancelRequested: boolean;
  /** Child exit code at failure time, when the process already exited. */
  readonly exitCode: number | null | undefined;
  /** Last stderr lines from the child, for local diagnostics. */
  readonly stderrTail: readonly string[];
}

/** JSON-RPC request errors are classified by message pattern, narrowest first. */
function errorFromResponseError(error: JsonRpcResponseError): NodeExecutionError {
  const message = error.message.toLowerCase();
  if (/(^|\D)429(\D|$)|rate[- ]?limit/.test(message)) {
    const retryAfterMs =
      typeof (error.data as { retryAfterMs?: unknown } | undefined)?.retryAfterMs === "number"
        ? (error.data as { retryAfterMs: number }).retryAfterMs
        : undefined;
    return new NodeExecutionError({
      code: "RATE_LIMITED",
      message: `harness reported a rate limit: ${error.message}`,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (/auth|credential|api[- ]?key|unauthorized|forbidden|(^|\D)40[13](\D|$)/.test(message)) {
    return new NodeExecutionError({
      code: "AUTH_FAILED",
      message: `harness reported an authentication failure: ${error.message}`,
      retryable: false,
    });
  }
  if (/model|provider|route/.test(message)) {
    return new NodeExecutionError({
      code: "MODEL_UNAVAILABLE",
      message: `harness could not serve the model route: ${error.message}`,
      retryable: true,
    });
  }
  return new NodeExecutionError({
    code: "RUNTIME_UNAVAILABLE",
    message: `harness request failed: ${error.message}`,
    retryable: true,
  });
}

function describeExit(context: HarnessFailureContext): string {
  const exit =
    context.exitCode === undefined || context.exitCode === null
      ? "unknown exit code"
      : `exit code ${context.exitCode}`;
  const stderr = context.stderrTail.slice(-2).join(" | ").slice(0, 200);
  return stderr.length > 0 ? `${exit}; stderr: ${stderr}` : exit;
}

/**
 * Map any harness-side failure into a classified NodeExecutionError.
 * A cancellation observed before the failure always wins: the engine's
 * settled guard decides which terminal reason is recorded, and a stopped
 * runtime is the expected result of cooperative cancellation, not a crash.
 */
export function nodeExecutionErrorFromHarness(
  error: unknown,
  context: HarnessFailureContext,
): NodeExecutionError {
  if (error instanceof NodeExecutionError) {
    return error;
  }
  if (context.cancelRequested) {
    return new NodeExecutionError({
      code: "CANCELLED",
      message: "node cancelled; harness runtime stopped",
      retryable: false,
    });
  }
  if (error instanceof JsonRpcResponseError) {
    return errorFromResponseError(error);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/transport closed|input closed|runtime exited|failed to start/i.test(message)) {
    return new NodeExecutionError({
      code: "RUNTIME_UNAVAILABLE",
      message: `harness runtime stopped unexpectedly (${describeExit(context)}): ${message}`,
      retryable: true,
    });
  }
  return new NodeExecutionError({
    code: "RUNTIME_UNAVAILABLE",
    message: `node executor failed unexpectedly: ${message}`,
    retryable: true,
  });
}

/** Thrown internally when the runtime process dies or the attempt is closed. */
export class HarnessAttemptClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessAttemptClosedError";
  }
}
