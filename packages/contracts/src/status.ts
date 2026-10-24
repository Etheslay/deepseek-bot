/**
 * Run and NodeRun state machines (docs/CONTRACTS.md §5).
 *
 * Terminal states cannot transition back to `running`; recovery from an
 * interrupted run creates a new Run linked via `resumedFromRunId`. During
 * cancellation the run enters `cancelling` and only reaches `cancelled`
 * once all child work has stopped.
 */
export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const NODE_RUN_STATUSES = [
  "pending",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "interrupted",
] as const;

export type NodeRunStatus = (typeof NODE_RUN_STATUSES)[number];

/**
 * `queued` may be cancelled before it starts. `cancelling` only ends in
 * `cancelled` (or `interrupted` if the host dies first). A run waiting for
 * approval can still fail (denied or expired approval with nothing left to
 * run) but never succeeds directly.
 */
export const RUN_TRANSITIONS: Readonly<
  Record<RunStatus, readonly RunStatus[]>
> = {
  queued: ["running", "cancelling", "interrupted"],
  running: ["waiting_approval", "cancelling", "succeeded", "failed", "interrupted"],
  waiting_approval: ["running", "cancelling", "failed", "interrupted"],
  cancelling: ["cancelled", "interrupted"],
  succeeded: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

/**
 * `skipped` is only reachable for nodes that never started because a
 * dependency failed; a whole-graph cancel moves unfinished nodes to
 * `cancelled`.
 */
export const NODE_RUN_TRANSITIONS: Readonly<
  Record<NodeRunStatus, readonly NodeRunStatus[]>
> = {
  pending: ["running", "skipped", "cancelled", "interrupted"],
  running: ["waiting_approval", "succeeded", "failed", "cancelled", "interrupted"],
  waiting_approval: ["running", "failed", "cancelled", "interrupted"],
  succeeded: [],
  failed: [],
  cancelled: [],
  skipped: [],
  interrupted: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionNodeRun(
  from: NodeRunStatus,
  to: NodeRunStatus,
): boolean {
  return NODE_RUN_TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {
  readonly entity: "run" | "nodeRun";
  readonly from: string;
  readonly to: string;

  constructor(
    entity: "run" | "nodeRun",
    from: string,
    to: string,
  ) {
    super(`illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "TransitionError";
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new TransitionError("run", from, to);
  }
}

export function assertNodeRunTransition(
  from: NodeRunStatus,
  to: NodeRunStatus,
): void {
  if (!canTransitionNodeRun(from, to)) {
    throw new TransitionError("nodeRun", from, to);
  }
}

export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = (
  Object.keys(RUN_TRANSITIONS) as RunStatus[]
).filter((status) => RUN_TRANSITIONS[status].length === 0);

export const NODE_RUN_TERMINAL_STATUSES: readonly NodeRunStatus[] = (
  Object.keys(NODE_RUN_TRANSITIONS) as NodeRunStatus[]
).filter((status) => NODE_RUN_TRANSITIONS[status].length === 0);

export function isRunTerminal(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.includes(status);
}

export function isNodeRunTerminal(status: NodeRunStatus): boolean {
  return NODE_RUN_TERMINAL_STATUSES.includes(status);
}
