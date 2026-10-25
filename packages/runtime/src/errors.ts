/**
 * Engine errors carrying stable contract error codes (docs/CONTRACTS.md §6).
 *
 * The engine throws these for caller-facing mistakes (invalid start input,
 * decisions on resolved approvals, retries against terminal runs). Node
 * attempt failures are not exceptions: they are recorded as NodeRun failure
 * reasons and drive the failure policy instead.
 */
import {
  NON_RETRYABLE_BY_DEFAULT,
  type ErrorCode,
  type WorkflowIssue,
} from "@deepseek-bot/contracts";

export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(options: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "EngineError";
    this.code = options.code;
    this.retryable =
      options.retryable ?? !NON_RETRYABLE_BY_DEFAULT.includes(options.code);
    this.details = options.details ?? {};
  }
}

export function invalidInput(
  message: string,
  details?: Record<string, unknown>,
): EngineError {
  return new EngineError({
    code: "INVALID_INPUT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

/**
 * Map deterministic graph validation issues onto the most specific stable
 * code so callers (workflow editor, run monitor) can branch on it.
 */
export function workflowIssueError(issues: readonly WorkflowIssue[]): EngineError {
  const code: ErrorCode = issues.some((issue) => issue.code === "WORKFLOW_CYCLE")
    ? "WORKFLOW_CYCLE"
    : issues.some((issue) => issue.code === "MISSING_BINDING")
      ? "MISSING_BINDING"
      : "INVALID_INPUT";
  return new EngineError({
    code,
    message: "workflow graph validation failed",
    details: {
      issues: issues.map((issue) => ({
        code: issue.code,
        nodeId: issue.nodeId ?? null,
        field: issue.field ?? null,
        message: issue.message,
      })),
    },
    retryable: false,
  });
}
