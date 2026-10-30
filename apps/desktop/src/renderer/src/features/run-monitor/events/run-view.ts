/**
 * Run view model (D09 brief §2.1): folds a run snapshot plus its accepted
 * event stream into what the monitor renders. Every status change is checked
 * against the contracts state machines (status.ts) — an illegal transition is
 * surfaced as a timeline warning and NOT applied; no component ever compares
 * status strings by hand.
 *
 * Two derivations (CONTRACTS §4/§5):
 * - `events` mode: the stream starts at sequence 0, so statuses are derived
 *   from the replay itself (a run is created `queued`, CONTRACTS §5);
 * - `snapshot` mode: the stream was rebuilt from a snapshot, so statuses
 *   start at the snapshot and only newer events fold in.
 */
import type {
  Approval,
  ApprovalStatus,
  Artifact,
  EventEnvelope,
  NodeRun,
  Run,
  RunStatus,
  NodeType,
  NodeRunStatus,
} from "@deepseek-bot/contracts";
import {
  APPROVAL_DEFAULT_TTL_MS,
  canTransitionNodeRun,
  canTransitionRun,
  isRunTerminal,
} from "@deepseek-bot/contracts";
import { t } from "../../../i18n.js";

/** Snapshot baseline the service composes for one run. */
export type RunSnapshotInput = {
  run: Run;
  nodeRuns: NodeRun[];
  approvals: ApprovalBaseline[];
  artifacts: Artifact[];
};

/**
 * Approval as the service sees it. `invalidReason` is a UI-level conclusion
 * (not a contracts field): a pending approval that can no longer be decided
 * in this host process — expired by clock, or bound to a previous host
 * generation ("启动代次绑定", CONTRACTS §2).
 */
export type ApprovalBaseline = {
  approval: Approval;
  resolved?: {
    decision: "approved" | "denied" | "expired";
    resolvedAt: string;
  };
  invalidReason?: "expired" | "generation";
  requestedAt: string;
};

export type IllegalTransition = {
  entity: "run" | "nodeRun";
  from: string;
  to: string;
  sequence: number;
};

export type NodeRunView = {
  nodeRunId: string;
  nodeId: string;
  attempt: number;
  status: NodeRunStatus;
  lastChangedAt: string;
  reason: string | null;
  sessionId: string | null;
};

export type NodeView = {
  nodeId: string;
  type: NodeType;
  runs: NodeRunView[];
};

export type StatusChangeView = {
  sequence: number;
  timestamp: string;
  from: RunStatus;
  to: RunStatus;
  reason: string | null;
};

export type TimelineEntry = {
  sequence: number;
  timestamp: string;
  type: EventEnvelope["type"];
  summary: string;
};

export type RunView = {
  runId: string;
  run: Run;
  status: RunStatus;
  statusHistory: StatusChangeView[];
  finishedAt: string | null;
  failure: { reason: string; errorCode: string } | null;
  interruptedReason: string | null;
  nodes: NodeView[];
  approvals: ApprovalBaseline[];
  artifacts: Artifact[];
  timeline: TimelineEntry[];
  illegalTransitions: IllegalTransition[];
};

type NodeStatusChangedPayload = {
  nodeRunId: string;
  nodeId: string;
  attempt: number;
  from: NodeRunStatus;
  to: NodeRunStatus;
  reason?: string;
};

type RunStatusChangedPayload = {
  from: RunStatus;
  to: RunStatus;
  reason?: string;
};

function nodeRunKey(nodeRun: NodeRunView): string {
  return `${nodeRun.nodeId}#${nodeRun.attempt}`;
}

function seedNodes(
  snapshot: RunSnapshotInput,
  mode: "events" | "snapshot",
): Map<string, NodeRunView> {
  const map = new Map<string, NodeRunView>();
  if (mode === "snapshot") {
    for (const nodeRun of snapshot.nodeRuns) {
      map.set(nodeRun.id, {
        nodeRunId: nodeRun.id,
        nodeId: nodeRun.nodeId,
        attempt: nodeRun.attempt,
        status: nodeRun.status,
        lastChangedAt: snapshot.run.finishedAt ?? snapshot.run.createdAt,
        reason: null,
        sessionId: nodeRun.sessionId,
      });
    }
  }
  return map;
}

export function buildRunView(
  snapshot: RunSnapshotInput,
  events: readonly EventEnvelope[],
  mode: "events" | "snapshot",
): RunView {
  const nodeRuns = seedNodes(snapshot, mode);
  const illegal: IllegalTransition[] = [];
  const statusHistory: StatusChangeView[] = [];

  let status: RunStatus =
    mode === "snapshot" ? snapshot.run.status : "queued";
  let finishedAt = mode === "snapshot" ? snapshot.run.finishedAt : null;
  let failure: RunView["failure"] = null;
  let interruptedReason: string | null =
    mode === "snapshot" && snapshot.run.status === "interrupted"
      ? t("runs.snapshotRebuildInterrupted")
      : null;

  const approvals = new Map<string, ApprovalBaseline>();
  for (const baseline of snapshot.approvals) {
    approvals.set(baseline.approval.id, { ...baseline });
  }

  const artifacts: Artifact[] = [...snapshot.artifacts];
  const timeline: TimelineEntry[] = [];

  const upsertNodeRun = (view: NodeRunView): void => {
    const existing = [...nodeRuns.values()].find(
      (candidate) => candidate.nodeRunId === view.nodeRunId,
    );
    if (existing) {
      nodeRuns.set(nodeRunKey(existing), view);
    } else {
      nodeRuns.set(nodeRunKey(view), view);
    }
  };

  for (const event of events) {
    const timestamp = event.timestamp;
    switch (event.type) {
      case "run.created":
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineRunCreated"),
        });
        break;
      case "run.statusChanged": {
        const payload = event.payload as RunStatusChangedPayload;
        if (canTransitionRun(status, payload.to)) {
          statusHistory.push({
            sequence: event.sequence,
            timestamp,
            from: status,
            to: payload.to,
            reason: payload.reason ?? null,
          });
          status = payload.to;
          if (payload.to === "interrupted") {
            interruptedReason = payload.reason ?? t("runs.hostProcessExited");
          }
        } else {
          illegal.push({
            entity: "run",
            from: status,
            to: payload.to,
            sequence: event.sequence,
          });
        }
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineRunStatusChanged", [payload.from, payload.to]),
        });
        break;
      }
      case "node.statusChanged": {
        const payload = event.payload as NodeStatusChangedPayload;
        const existing = [...nodeRuns.values()].find(
          (candidate) => candidate.nodeRunId === payload.nodeRunId,
        );
        const currentStatus: NodeRunStatus = existing?.status ?? "pending";
        const next: NodeRunView = {
          nodeRunId: payload.nodeRunId,
          nodeId: payload.nodeId,
          attempt: payload.attempt,
          status: currentStatus,
          lastChangedAt: timestamp,
          reason: null,
          sessionId: existing?.sessionId ?? null,
        };
        if (canTransitionNodeRun(currentStatus, payload.to)) {
          next.status = payload.to;
          next.reason = payload.reason ?? null;
          upsertNodeRun(next);
        } else {
          // Rejected: register the attempt at its current status (the event
          // proves it exists) but never move it to the illegal target.
          upsertNodeRun(next);
          illegal.push({
            entity: "nodeRun",
            from: currentStatus,
            to: payload.to,
            sequence: event.sequence,
          });
        }
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineNodeStatus", [payload.nodeId, payload.attempt, payload.from, payload.to]),
        });
        break;
      }
      case "tool.requested": {
        const payload = event.payload as {
          toolName: string;
          resource?: string;
        };
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineTool", [payload.toolName, payload.resource ? ` → ${payload.resource}` : ""]),
        });
        break;
      }
      case "approval.requested": {
        const payload = event.payload as { approval: Approval };
        const existing = approvals.get(payload.approval.id);
        // The snapshot baseline may carry UI-level invalidation facts
        // (generation binding / expiry) the event payload cannot know; keep
        // them when the replay re-delivers the same approval.
        const baseline: ApprovalBaseline = {
          approval: payload.approval,
          requestedAt: timestamp,
          ...(existing?.invalidReason !== undefined
            ? { invalidReason: existing.invalidReason }
            : {}),
          ...(existing?.resolved !== undefined
            ? { resolved: existing.resolved }
            : {}),
        };
        approvals.set(payload.approval.id, baseline);
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineApprovalRequested", [payload.approval.resource]),
        });
        break;
      }
      case "approval.resolved": {
        const payload = event.payload as {
          approvalId: string;
          decision: "approved" | "denied" | "expired";
          resolvedAt: string;
        };
        const baseline = approvals.get(payload.approvalId);
        if (baseline) {
          approvals.set(payload.approvalId, {
            ...baseline,
            resolved: {
              decision: payload.decision,
              resolvedAt: payload.resolvedAt,
            },
            approval: {
              ...baseline.approval,
              status:
                payload.decision === "approved"
                  ? "consumed"
                  : payload.decision === "denied"
                    ? "denied"
                    : "expired",
            },
          });
        }
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineApprovalResolved", [approvalDecisionLabel(payload.decision)]),
        });
        break;
      }
      case "artifact.created": {
        const payload = event.payload as { artifact: Artifact };
        if (!artifacts.some((item) => item.id === payload.artifact.id)) {
          artifacts.push(payload.artifact);
        }
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineArtifact", [payload.artifact.relativePath]),
        });
        break;
      }
      case "run.completed": {
        const payload = event.payload as { finishedAt: string };
        finishedAt = payload.finishedAt;
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineRunCompleted"),
        });
        break;
      }
      case "run.failed": {
        const payload = event.payload as {
          reason: string;
          errorCode: string;
        };
        failure = { reason: payload.reason, errorCode: payload.errorCode };
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineRunFailed", [payload.errorCode]),
        });
        break;
      }
      case "run.interrupted": {
        const payload = event.payload as {
          reason: string;
          resumedFromRunId?: string;
        };
        interruptedReason = payload.reason;
        timeline.push({
          sequence: event.sequence,
          timestamp,
          type: event.type,
          summary: t("runs.timelineRunInterrupted", [payload.reason]),
        });
        break;
      }
    }
  }

  const nodes = new Map<string, NodeView>();
  for (const node of snapshot.run.workflowSnapshot.nodes) {
    nodes.set(node.id, { nodeId: node.id, type: node.type, runs: [] });
  }
  for (const view of nodeRuns.values()) {
    const node = nodes.get(view.nodeId);
    if (node) {
      node.runs.push(view);
    } else {
      nodes.set(view.nodeId, {
        nodeId: view.nodeId,
        type: "bot",
        runs: [view],
      });
    }
  }
  for (const node of nodes.values()) {
    node.runs.sort((a, b) => a.attempt - b.attempt);
  }

  return {
    runId: snapshot.run.id,
    run: snapshot.run,
    status,
    statusHistory,
    finishedAt,
    failure,
    interruptedReason,
    nodes: [...nodes.values()],
    approvals: [...approvals.values()],
    artifacts,
    timeline,
    illegalTransitions: illegal,
  };
}

/** Cancel entry exists exactly when the contracts table allows cancelling. */
export function canCancelRun(view: RunView): boolean {
  return canTransitionRun(view.status, "cancelling");
}

/** Retry entry exists on the latest failed attempt of each node. */
export function retryableNodeRuns(view: RunView): NodeRunView[] {
  const latest = new Map<string, NodeRunView>();
  for (const node of view.nodes) {
    const last = node.runs[node.runs.length - 1];
    if (last) {
      latest.set(node.nodeId, last);
    }
  }
  return [...latest.values()].filter((run) => run.status === "failed");
}

/** Whether an approval can still be decided right now (UI conclusion). */
export function approvalDecidable(baseline: ApprovalBaseline): boolean {
  if (baseline.approval.status !== "pending") {
    return false;
  }
  if (baseline.invalidReason !== undefined) {
    return false;
  }
  return Date.parse(baseline.approval.expiresAt) > Date.now();
}

/** Display label for the remaining validity window, per the 10-minute TTL. */
export function approvalTtlLabel(
  baseline: ApprovalBaseline,
  now = Date.now(),
): string {
  const remaining = Date.parse(baseline.approval.expiresAt) - now;
  if (baseline.invalidReason === "generation") {
    return t("runs.invalidatedByGeneration");
  }
  if (remaining <= 0) {
    return t("runs.expired");
  }
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return t("runs.approvalTimeLeft", [minutes, String(seconds).padStart(2, "0")]);
}

/** Default validity window from the contracts constant, for the UI copy. */
export function approvalTtlCopy(): string {
  return t("runs.approvalTtlMinutes", [APPROVAL_DEFAULT_TTL_MS / 60_000]);
}

/** Approval decisions are contract data; only the label is localized (D22). */
export function approvalDecisionLabel(decision: string): string {
  switch (decision) {
    case "approved":
      return t("runs.approved");
    case "denied":
      return t("permissions.denied");
    case "expired":
      return t("runs.expired");
    default:
      return decision;
  }
}

/**
 * Terminal approval status → decision label. The real Host only exposes the
 * status, not a resolved record, so the UI derives the same "已决定" copy from
 * the status instead of pretending a resolution timestamp exists.
 */
export function approvalDecisionFromStatus(
  status: ApprovalStatus,
): "approved" | "denied" | "expired" | undefined {
  switch (status) {
    case "approved":
    case "consumed":
      return "approved";
    case "denied":
      return "denied";
    case "expired":
      return "expired";
    default:
      return undefined;
  }
}

export function isTerminalView(view: RunView): boolean {
  return isRunTerminal(view.status);
}
