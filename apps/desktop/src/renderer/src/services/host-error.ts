/**
 * Host failures cross the Electron contextBridge as Error name + message.
 * A custom `.code` is kept when the bridge leaves it in place, and `name`
 * carries the same stable code when the clone drops everything else.
 * Missing both used to be reported as INVALID_INPUT, including
 * "host process has exited".
 */
export function hostErrorCode(error: unknown): string {
  const shaped = error as { code?: unknown } | null;
  if (typeof shaped?.code === "string" && shaped.code.length > 0) return shaped.code;
  if (error instanceof Error && error.name !== "Error" && error.name !== "ServiceError") {
    return error.name;
  }
  return "INVALID_INPUT";
}

export function hostErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The desktop child is gone or was never started. Not a form-validation failure. */
export function isHostDownError(error: unknown): boolean {
  if (hostErrorCode(error) === "RUNTIME_UNAVAILABLE") return true;
  return /host process (has exited|is not running|exited\b)/.test(hostErrorMessage(error));
}
