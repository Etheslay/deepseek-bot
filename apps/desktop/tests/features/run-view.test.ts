import { describe, expect, it } from "vitest";
import {
  RUN_TRANSITIONS,
  NODE_RUN_TRANSITIONS,
  RUN_STATUSES,
  canTransitionRun,
  type Run,
  type EventEnvelope,
} from "@deepseek-bot/contracts";
import successRunFixture from "@deepseek-bot/contracts/fixtures/success-run.json";
import {
  approvalDecidable,
  buildRunView,
  canCancelRun,
  retryableNodeRuns,
  type RunSnapshotInput,
} from "../../src/renderer/src/features/run-monitor/events/run-view.js";

const successRun = successRunFixture.interactions[0]!.expectedResponse as unknown as Run;
const successEvents = successRunFixture.events as unknown as EventEnvelope[];

function snapshotBase(run: Run): RunSnapshotInput {
  return { run, nodeRuns: [], approvals: [], artifacts: [] };
}

describe("run view folding", () => {
  it("derives the full success path from the fixture event replay", () => {
    const view = buildRunView(snapshotBase(successRun), successEvents, "events");
    expect(view.status).toBe("succeeded");
    expect(view.illegalTransitions).toHaveLength(0);
    const node = view.nodes.find((entry) => entry.nodeId === "n1");
    expect(node?.runs).toHaveLength(1);
    expect(node?.runs[0]?.status).toBe("succeeded");
    expect(view.finishedAt).toBe("2026-10-24T10:00:10Z");
    expect(view.timeline[0]?.summary).toBe("运行创建");
  });

  it("rejects an illegal run transition instead of applying it", () => {
    const events: EventEnvelope[] = [
      ...successEvents,
      {
        eventId: "20000000-0000-4000-8000-0000000000ff",
        runId: successRun.id,
        sequence: 6,
        timestamp: "2026-10-24T10:01:00Z",
        type: "run.statusChanged",
        payload: { from: "succeeded", to: "running" },
      },
    ];
    const view = buildRunView(snapshotBase(successRun), events, "events");
    expect(view.status).toBe("succeeded");
    expect(view.illegalTransitions).toEqual([
      { entity: "run", from: "succeeded", to: "running", sequence: 6 },
    ]);
  });

  it("rejects an illegal node transition (pending → succeeded) and keeps the node pending", () => {
    const events: EventEnvelope[] = [
      {
        eventId: "20000000-0000-4000-8000-0000000000f1",
        runId: successRun.id,
        sequence: 0,
        timestamp: "2026-10-24T10:00:00Z",
        type: "run.created",
        payload: { workflowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", triggerKind: "manual" },
      },
      {
        eventId: "20000000-0000-4000-8000-0000000000f2",
        runId: successRun.id,
        sequence: 1,
        timestamp: "2026-10-24T10:00:01Z",
        type: "node.statusChanged",
        payload: {
          nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          nodeId: "n1",
          attempt: 1,
          from: "pending",
          to: "succeeded",
        },
      },
    ];
    const view = buildRunView(snapshotBase(successRun), events, "events");
    const node = view.nodes.find((entry) => entry.nodeId === "n1");
    expect(node?.runs[0]?.status).toBe("pending");
    expect(view.illegalTransitions).toHaveLength(1);
    expect(view.illegalTransitions[0]?.entity).toBe("nodeRun");
  });

  it("starts from the snapshot baseline in snapshot mode", () => {
    const view = buildRunView(
      {
        run: { ...successRun, status: "running" },
        nodeRuns: [
          {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            runId: successRun.id,
            nodeId: "n1",
            attempt: 1,
            status: "running",
            inputRefs: [],
            outputRefs: [],
            sessionId: "sess-1",
          },
        ],
        approvals: [],
        artifacts: [],
      },
      [],
      "snapshot",
    );
    expect(view.status).toBe("running");
    expect(view.nodes[0]?.runs[0]?.status).toBe("running");
    expect(view.nodes[0]?.runs[0]?.sessionId).toBe("sess-1");
  });

  it("folds approval.requested/resolved and marks one-shot decisions", () => {
    const approval = {
      id: "12341234-1234-4123-8123-123412341234",
      runId: successRun.id,
      nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      actionDigest: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      resource: "D:\\workspaces\\demo\\report.md",
      expiresAt: "2030-01-01T00:00:00Z",
      status: "pending" as const,
    };
    const events: EventEnvelope[] = [
      {
        eventId: "20000000-0000-4000-8000-0000000000e1",
        runId: successRun.id,
        sequence: 0,
        timestamp: "2026-10-24T10:00:00Z",
        type: "approval.requested",
        payload: { approval },
      },
      {
        eventId: "20000000-0000-4000-8000-0000000000e2",
        runId: successRun.id,
        sequence: 1,
        timestamp: "2026-10-24T10:01:00Z",
        type: "approval.resolved",
        payload: {
          approvalId: approval.id,
          decision: "approved",
          resolvedAt: "2026-10-24T10:01:00Z",
        },
      },
    ];
    const view = buildRunView(snapshotBase(successRun), events, "events");
    expect(view.approvals).toHaveLength(1);
    expect(view.approvals[0]?.resolved?.decision).toBe("approved");
    // Once resolved it is no longer decidable (one-shot).
    expect(approvalDecidable(view.approvals[0]!)).toBe(false);
  });

  it("cancel availability follows the contracts transition table", () => {
    for (const status of RUN_STATUSES) {
      const view = buildRunView(
        snapshotBase({ ...successRun, status }),
        [],
        "snapshot",
      );
      expect(canCancelRun(view)).toBe(canTransitionRun(status, "cancelling"));
    }
  });

  it("offers retry only on the latest failed attempt", () => {
    const view = buildRunView(
      {
        run: { ...successRun, status: "running" },
        nodeRuns: [
          {
            id: "nrun-1",
            runId: successRun.id,
            nodeId: "n1",
            attempt: 1,
            status: "failed",
            inputRefs: [],
            outputRefs: [],
            sessionId: null,
          },
          {
            id: "nrun-2",
            runId: successRun.id,
            nodeId: "n1",
            attempt: 2,
            status: "pending",
            inputRefs: [],
            outputRefs: [],
            sessionId: null,
          },
        ],
        approvals: [],
        artifacts: [],
      },
      [],
      "snapshot",
    );
    // Latest attempt of n1 is pending (attempt 2), so no retry entry.
    expect(retryableNodeRuns(view)).toHaveLength(0);
  });

  it("matches the full contracts state machine tables", () => {
    // D9-5: every status and transition comes from contracts/status.ts.
    expect(RUN_TRANSITIONS.succeeded).toEqual([]);
    expect(RUN_TRANSITIONS.cancelling).toEqual(["cancelled", "interrupted"]);
    expect(NODE_RUN_TRANSITIONS.pending).toEqual([
      "running",
      "skipped",
      "cancelled",
      "interrupted",
    ]);
    expect(NODE_RUN_TRANSITIONS.skipped).toEqual([]);
    expect(canTransitionRun("waiting_approval", "failed")).toBe(true);
    expect(canTransitionRun("failed", "running")).toBe(false);
  });
});
