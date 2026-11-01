/**
 * One shared "the host child is down" flag for 设置 → 通用.
 * Each card used to paint its own red read-failure when the child had
 * already exited. The page now shows a single reason instead.
 */
import { useEffect, useState } from "react";
import { isHostDownError } from "../../services/host-error.js";

let down = false;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Returns true when this failure is the dead-host case and was recorded. */
export function noteHostFailure(error: unknown): boolean {
  if (!isHostDownError(error)) return false;
  if (!down) {
    down = true;
    publish();
  }
  return true;
}

export function clearHostDown(): void {
  if (!down) return;
  down = false;
  publish();
}

export function useHostDown(): boolean {
  const [value, setValue] = useState(down);
  useEffect(() => {
    const listener = (): void => setValue(down);
    listeners.add(listener);
    setValue(down);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
