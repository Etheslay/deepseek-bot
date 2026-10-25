import { describe, expect, it } from "vitest";
import {
  isRunTerminal,
  isSequenceMonotonic,
  RunSchema,
  type Run,
} from "@deepseek-bot/contracts";
import { ServiceError } from "../../src/renderer/src/services/desktop-service.js";
import {
  createFixtureRunService,
  FIXTURE_APPROVALS,
  FIXTURE_NODE_RUNS,
  FIXTURE_RUNS,
} from "../../src/renderer/src/features/run-monitor/run-service.js";
import { applySubscribeResult, initEventStream } from "../../src/renderer/src/features/run-monitor/events/event-stream.js";
import { buildRunView } from "../../src/renderer/src/features/run-monitor/events/run-view.js";

const ACTION_DIGEST =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

async function rejectCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected a ServiceError");
}

describe("run.list / history views", () => {
  it("seeds all scenario runs, newest first, schema-valid", async () => {
    const service = createFixtureRunService();
    const { runs } = await service.list();
    expect(runs.length).toBeGreaterThanOrEqual(8);
    for (const run of runs) {
      expect(RunSchema.safeParse(run).success).toBe(true);
    }
    for (let i = 1; i < runs.length; i += 1) {
      expect(Date.parse(runs[i]!.createdAt)).toBeLessThanOrEqual(
        Date.parse(runs[i - 1]!.createdAt),
      );
    }
    const failed = await service.list({ status: "failed" });
    expect(failed.runs.every((run) => run.status === "failed")).toBe(true);
  });

  it("exposes snapshot, artifacts and sessionId for the history view", async () => {
    const service = createFixtureRunService();
    const snap = await service.snapshot(FIXTURE_RUNS.success);
    expect(snap.run.workflowSnapshot.name).toBe("daily-note");
    expect(snap.nodeRuns[0]?.sessionId).toBe("sess-success-run");
    expect(snap.artifacts[0]?.relativePath).toBe("summaries/note-summary.md");
    const view = buildRunView(snap, [], "snapshot");
    expect(view.artifacts).toHaveLength(1);
  });

  it("links the recovery run via resumedFromRunId (crash-reconnect)", async () => {
    const service = createFixtureRunService();
    const resumed = await service.get(FIXTURE_RUNS.resumed);
    expect(resumed.resumedFromRunId).toBe(FIXTURE_RUNS.interrupted);
    expect(resumed.status).toBe("running");
    const interrupted = await service.get(FIXTURE_RUNS.interrupted);
    expect(interrupted.status).toBe("interrupted");
    expect(isRunTerminal(interrupted.status)).toBe(true);
  });
});

describe("events.subscribe", () => {
  it("replays the crash-reconnect tail afterSequence=3 (fixture interaction 1)", async () => {
    const service = createFixtureRunService();
    const result = await service.subscribe(FIXTURE_RUNS.interrupted, 3);
    expect(result.snapshotRequired).toBe(false);
    expect(result.events.map((event) => event.sequence)).toEqual([4, 5, 6]);
    expect(result.events.map((event) => event.eventId)).toEqual([
      "20000000-0000-4000-8000-000000000012",
      "20000000-0000-4000-8000-000000000013",
      "20000000-0000-4000-8000-000000000014",
    ]);
  });

  it("returns snapshotRequired for a range older than retention (fixture interaction 2)", async () => {
    const service = createFixtureRunService();
    const result = await service.subscribe(FIXTURE_RUNS.interrupted, 0);
    expect(result.events).toEqual([]);
    expect(result.snapshotRequired).toBe(true);
  });

  it("injects a duplicate delivery on the success run and the consumer dedupes", async () => {
    const service = createFixtureRunService();
    const response = await service.subscribe(FIXTURE_RUNS.success, 0);
    // At-least-once: one envelope redelivered in the same response.
    const ids = response.events.map((event) => event.eventId);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size + 1);
    const consumed = applySubscribeResult(initEventStream(FIXTURE_RUNS.success), response);
    expect(consumed.state.events).toHaveLength(unique.size);
    expect(consumed.state.duplicatesDropped).toBe(1);
    expect(isSequenceMonotonic(consumed.state.events)).toBe(true);
  });

  it("rejects a negative afterSequence", async () => {
    const service = createFixtureRunService();
    expect(
      await rejectCode(service.subscribe(FIXTURE_RUNS.success, -1)),
    ).toBe("INVALID_INPUT");
  });
});

describe("run.cancel (D9-6)", () => {
  it("walks cancelling → cancelled and then stops appending events", async () => {
    const service = createFixtureRunService();
    const cancelling = await service.cancel(FIXTURE_RUNS.active);
    expect(cancelling.status).toBe("cancelling");

    // Duplicate cancel before drain: still cancelling, no extra events.
    const again = await service.cancel(FIXTURE_RUNS.active);
    expect(again.status).toBe("cancelling");
    const before = (await service.subscribe(FIXTURE_RUNS.active, 0)).events.length;

    await service.advanceScenario(FIXTURE_RUNS.active);
    const cancelled = await service.get(FIXTURE_RUNS.active);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.finishedAt).not.toBeNull();

    // Idempotent repeat on the terminal run: same state, zero new events.
    const terminal = await service.cancel(FIXTURE_RUNS.active);
    expect(terminal.status).toBe("cancelled");
    const after = (await service.subscribe(FIXTURE_RUNS.active, 0)).events.length;
    expect(after).toBe(before + 2); // node cancelled + run cancelled only
    await expect(service.advanceScenario(FIXTURE_RUNS.active)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("streams a tool call and transient deltas during playback", async () => {
    const service = createFixtureRunService();
    await service.advanceScenario(FIXTURE_RUNS.active);
    const events = (await service.subscribe(FIXTURE_RUNS.active, 0)).events;
    expect(events.some((event) => event.type === "tool.requested")).toBe(true);
    const transient = await service.pullTransient(FIXTURE_RUNS.active);
    expect(transient.length).toBeGreaterThan(0);
    expect(transient[0]).toMatchObject({ streamId: "stream-active", chunkIndex: 0 });
    // Drained: a second pull returns nothing new.
    expect(await service.pullTransient(FIXTURE_RUNS.active)).toHaveLength(0);
  });
});

describe("approval.decide (D9-7/8/9)", () => {
  it("denies: node fails, run fails with APPROVAL_REQUIRED, descendants stop", async () => {
    const service = createFixtureRunService();
    const approval = await service.decideApproval({
      approvalId: FIXTURE_APPROVALS.live,
      decision: "denied",
      expectedActionDigest: ACTION_DIGEST,
    });
    expect(approval.status).toBe("denied");
    const run = await service.get(FIXTURE_RUNS.approval);
    expect(run.status).toBe("failed");
    const events = (await service.subscribe(FIXTURE_RUNS.approval, 0)).events;
    const failed = events.find((event) => event.type === "run.failed");
    expect(failed).toBeDefined();
    expect((failed!.payload as { errorCode: string }).errorCode).toBe("APPROVAL_REQUIRED");
    const view = buildRunView(await service.snapshot(FIXTURE_RUNS.approval), events, "events");
    const gate = view.nodes.find((node) => node.nodeId === "human-approve");
    expect(gate?.runs[0]?.status).toBe("failed");
    const draft = view.nodes.find((node) => node.nodeId === "draft-bot");
    expect(draft?.runs[0]?.status).toBe("succeeded");
  });

  it("cannot decide the same approval twice (one-shot consumption)", async () => {
    const service = createFixtureRunService();
    await service.decideApproval({
      approvalId: FIXTURE_APPROVALS.live,
      decision: "denied",
      expectedActionDigest: ACTION_DIGEST,
    });
    const before = (await service.subscribe(FIXTURE_RUNS.approval, 0)).events.length;
    expect(
      await rejectCode(
        service.decideApproval({
          approvalId: FIXTURE_APPROVALS.live,
          decision: "approved",
          expectedActionDigest: ACTION_DIGEST,
        }),
      ),
    ).toBe("INVALID_INPUT");
    const after = (await service.subscribe(FIXTURE_RUNS.approval, 0)).events.length;
    expect(after).toBe(before);
  });

  it("refuses an expired approval with APPROVAL_EXPIRED (no events)", async () => {
    const service = createFixtureRunService();
    const before = (await service.subscribe(FIXTURE_RUNS.expired, 0)).events.length;
    expect(
      await rejectCode(
        service.decideApproval({
          approvalId: FIXTURE_APPROVALS.expired,
          decision: "approved",
          expectedActionDigest: ACTION_DIGEST,
        }),
      ),
    ).toBe("APPROVAL_EXPIRED");
    const after = (await service.subscribe(FIXTURE_RUNS.expired, 0)).events.length;
    expect(after).toBe(before);
    // The UI snapshot marks it expired for display.
    const snap = await service.snapshot(FIXTURE_RUNS.expired);
    expect(snap.approvals[0]?.invalidReason).toBe("expired");
  });

  it("refuses an approval bound to a previous host generation", async () => {
    const service = createFixtureRunService();
    const error = service.decideApproval({
      approvalId: FIXTURE_APPROVALS.stale,
      decision: "approved",
      expectedActionDigest: ACTION_DIGEST,
    });
    await expect(error).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    await expect(error).rejects.toMatchObject({
      message: expect.stringContaining("启动代次"),
    });
    const snap = await service.snapshot(FIXTURE_RUNS.stale);
    expect(snap.approvals[0]?.invalidReason).toBe("generation");
  });

  it("refuses a digest mismatch before any state change", async () => {
    const service = createFixtureRunService();
    expect(
      await rejectCode(
        service.decideApproval({
          approvalId: FIXTURE_APPROVALS.live,
          decision: "approved",
          expectedActionDigest: "0".repeat(64),
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect((await service.get(FIXTURE_RUNS.approval)).status).toBe("waiting_approval");
  });

  it("approves: run resumes, executes, consumes the approval and produces an artifact", async () => {
    const service = createFixtureRunService();
    const approval = await service.decideApproval({
      approvalId: FIXTURE_APPROVALS.live,
      decision: "approved",
      expectedActionDigest: ACTION_DIGEST,
    });
    expect(approval.status).toBe("approved");
    expect((await service.get(FIXTURE_RUNS.approval)).status).toBe("running");

    await service.advanceScenario(FIXTURE_RUNS.approval);
    const run = await service.get(FIXTURE_RUNS.approval);
    expect(run.status).toBe("succeeded");
    expect(run.finishedAt).not.toBeNull();
    const snap = await service.snapshot(FIXTURE_RUNS.approval);
    expect(snap.approvals[0]?.approval.status).toBe("consumed");
    expect(snap.artifacts[0]?.relativePath).toBe("reports/review.md");
  });
});

describe("run.retryNode (engine rules)", () => {
  it("spawns a fresh attempt for the latest failed node run", async () => {
    const service = createFixtureRunService();
    const spawned = await service.retryNode(FIXTURE_NODE_RUNS.retryR1);
    expect(spawned.nodeId).toBe("r1");
    expect(spawned.attempt).toBe(2);
    // Seeded events end at sequence 4; the retry event lands at sequence 5.
    const events = (await service.subscribe(FIXTURE_RUNS.retry, 4)).events;
    expect(
      events.some(
        (event) =>
          event.type === "node.statusChanged" &&
          (event.payload as { attempt: number }).attempt === 2,
      ),
    ).toBe(true);
  });

  it("rejects non-failed node runs, duplicate retries and terminal runs", async () => {
    const service = createFixtureRunService();
    expect(await rejectCode(service.retryNode(FIXTURE_NODE_RUNS.retryR2))).toBe(
      "INVALID_INPUT",
    );
    await service.retryNode(FIXTURE_NODE_RUNS.retryR1);
    expect(await rejectCode(service.retryNode(FIXTURE_NODE_RUNS.retryR1))).toBe(
      "INVALID_INPUT",
    );
    // Denied approval run is terminal: recovery needs a new run, not a retry.
    const other = createFixtureRunService();
    await other.decideApproval({
      approvalId: FIXTURE_APPROVALS.live,
      decision: "denied",
      expectedActionDigest: ACTION_DIGEST,
    });
    expect(await rejectCode(other.retryNode(FIXTURE_NODE_RUNS.approvalGate))).toBe(
      "INVALID_INPUT",
    );
  });

  it("completes the run after a successful retry (fixture script)", async () => {
    const service = createFixtureRunService();
    await service.retryNode(FIXTURE_NODE_RUNS.retryR1);
    await service.advanceScenario(FIXTURE_RUNS.retry);
    const run: Run = await service.get(FIXTURE_RUNS.retry);
    expect(run.status).toBe("succeeded");
    const events = (await service.subscribe(FIXTURE_RUNS.retry, 0)).events;
    expect(isSequenceMonotonic(events)).toBe(true);
  });
});

describe("approval inbox", () => {
  it("lists approvals across runs with their UI invalidation reasons", async () => {
    const service = createFixtureRunService();
    const inbox = await service.listApprovals();
    expect(inbox.length).toBeGreaterThanOrEqual(3);
    const byReason = new Map(inbox.map((item) => [item.approval.id, item.invalidReason]));
    expect(byReason.get(FIXTURE_APPROVALS.stale)).toBe("generation");
    expect(byReason.get(FIXTURE_APPROVALS.expired)).toBe("expired");
    expect(byReason.get(FIXTURE_APPROVALS.live)).toBeUndefined();
  });
});
