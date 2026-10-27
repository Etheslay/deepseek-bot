import { cancelled, timedOut } from "./errors.js";

/**
 * Run `work` until the caller aborts or `timeoutMs` elapses.
 * The signal passed to `work` fires in both cases so the callee can stop a child process.
 */
export async function runWithDeadline<T>(options: {
  signal: AbortSignal;
  timeoutMs: number;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  if (options.signal.aborted) throw cancelled();
  const linked = new AbortController();
  let timedOutRun = false;
  const onParentAbort = (): void => linked.abort();
  options.signal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOutRun = true;
    linked.abort();
  }, options.timeoutMs);
  try {
    const result = await options.run(linked.signal);
    if (timedOutRun) throw timedOut("screen operation timed out");
    if (options.signal.aborted) throw cancelled();
    return result;
  } catch (error) {
    if (timedOutRun) throw timedOut("screen operation timed out");
    if (options.signal.aborted || linked.signal.aborted) throw cancelled();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onParentAbort);
  }
}
