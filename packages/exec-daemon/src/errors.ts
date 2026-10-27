/** Stable failures for the screen backend. Codes match docs/CONTRACTS.md §6. */

export const SCREEN_BACKEND_CODES = [
  "INVALID_INPUT",
  "UNAUTHORIZED_PATH",
  "RUNTIME_UNAVAILABLE",
  "TOOL_TIMEOUT",
  "CANCELLED",
] as const;

export type ScreenBackendCode = (typeof SCREEN_BACKEND_CODES)[number];

export class ScreenBackendError extends Error {
  readonly code: ScreenBackendCode;
  readonly retryable: boolean;
  readonly reason: string | undefined;

  constructor(options: {
    code: ScreenBackendCode;
    message: string;
    reason?: string;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "ScreenBackendError";
    this.code = options.code;
    this.reason = options.reason;
    this.retryable = options.retryable ?? options.code === "TOOL_TIMEOUT";
  }
}

export function invalidInput(message: string, reason?: string): ScreenBackendError {
  return new ScreenBackendError({
    code: "INVALID_INPUT",
    message,
    retryable: false,
    ...(reason !== undefined ? { reason } : {}),
  });
}

export function unauthorizedPath(message: string): ScreenBackendError {
  return new ScreenBackendError({
    code: "UNAUTHORIZED_PATH",
    message,
    retryable: false,
    reason: "path",
  });
}

export function unavailable(message: string, reason?: string): ScreenBackendError {
  return new ScreenBackendError({
    code: "RUNTIME_UNAVAILABLE",
    message,
    retryable: false,
    ...(reason !== undefined ? { reason } : {}),
  });
}

export function timedOut(message: string): ScreenBackendError {
  return new ScreenBackendError({
    code: "TOOL_TIMEOUT",
    message,
    retryable: true,
    reason: "timeout",
  });
}

export function cancelled(message = "screen operation cancelled"): ScreenBackendError {
  return new ScreenBackendError({
    code: "CANCELLED",
    message,
    retryable: false,
    reason: "cancelled",
  });
}
