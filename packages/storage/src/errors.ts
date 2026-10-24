/**
 * Storage-layer errors carrying stable contract error codes
 * (docs/CONTRACTS.md §6). `details` must stay desensitized: no secrets,
 * no raw environment dumps.
 */
import { NON_RETRYABLE_BY_DEFAULT, type ErrorCode } from "@deepseek-bot/contracts";

export class StorageError extends Error {
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
    this.name = "StorageError";
    this.code = options.code;
    this.retryable =
      options.retryable ?? !NON_RETRYABLE_BY_DEFAULT.includes(options.code);
    this.details = options.details ?? {};
  }
}

export function invalidInput(
  message: string,
  details?: Record<string, unknown>,
): StorageError {
  return new StorageError({
    code: "INVALID_INPUT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

export function dataVersionUnsupported(
  message: string,
  details?: Record<string, unknown>,
): StorageError {
  return new StorageError({
    code: "DATA_VERSION_UNSUPPORTED",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

export function diskFull(message: string, details?: Record<string, unknown>): StorageError {
  return new StorageError({
    code: "DISK_FULL",
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

export function runtimeUnavailable(
  message: string,
  details?: Record<string, unknown>,
): StorageError {
  return new StorageError({
    code: "RUNTIME_UNAVAILABLE",
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Map Node filesystem errors onto stable codes where identifiable. */
export function storageErrorFromFsError(error: unknown, action: string): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOSPC") {
    return diskFull(`no space left while ${action}`);
  }
  return new StorageError({
    code: "RUNTIME_UNAVAILABLE",
    message: `filesystem operation failed while ${action}`,
    details: { errnoCode: code ?? "UNKNOWN" },
  });
}
