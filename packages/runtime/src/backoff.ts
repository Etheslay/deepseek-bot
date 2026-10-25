/**
 * Bounded exponential backoff with Retry-After support (CONTRACTS.md §5):
 * automatic retries wait `base * 2^(attempt-1)` capped at `max`, never less
 * than a server-provided Retry-After hint.
 */
export interface BackoffInput {
  /** 1-based number of the attempt that just failed. */
  readonly attempt: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryAfterMs?: number;
}

export function backoffDelayMs(input: BackoffInput): number {
  const exponential = input.baseDelayMs * 2 ** (Math.max(1, input.attempt) - 1);
  const capped = Math.min(exponential, input.maxDelayMs);
  const floor = input.retryAfterMs ?? 0;
  return Math.max(capped, floor);
}
