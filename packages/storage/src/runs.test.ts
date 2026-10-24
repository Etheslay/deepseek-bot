import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  countActiveRuns,
  createNodeRun,
  createRun,
  getRun,
  listNodeRuns,
  listRuns,
  setNodeRunSession,
  transitionNodeRun,
  transitionRun,
} from "./index.js";
import {
  makeLayout,
  makeRun,
  makeTempRoot,
  makeTestClock,
  makeWorkflow,
  openTestDatabase,
} from "./test-support.js";

describe("run repository", () => {
  it("creates runs and deduplicates by idempotencyKey", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = makeWorkflow();
    const run = makeRun(workflow);
    const first = createRun(db, run);
    expect(first.created).toBe(true);

    const duplicate = createRun(db, makeRun(workflow, { id: randomUUID(), trigger: { kind: "manual", idempotencyKey: run.trigger.idempotencyKey } }));
    expect(duplicate.created).toBe(false);
    expect(duplicate.run.id).toBe(run.id);
    db.close();
  });

  it("deduplicates schedule triggers per occurrence", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const workflow = makeWorkflow();
    const scheduleId = randomUUID();
    const occurrence = "2026-10-24T09:00:00.000Z";
    const trigger = { kind: "schedule" as const, idempotencyKey: randomUUID(), scheduleId, occurrenceUtc: occurrence };
    const first = createRun(db, makeRun(workflow, { trigger }));
    const second = createRun(db, makeRun(workflow, { trigger: { ...trigger, idempotencyKey: randomUUID() } }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    const otherOccurrence = createRun(db, makeRun(workflow, {
      trigger: { ...trigger, idempotencyKey: randomUUID(), occurrenceUtc: "2026-10-24T10:00:00.000Z" },
    }));
    expect(otherOccurrence.created).toBe(true);
    db.close();
  });

  it("applies the contract state machine and stamps finishedAt on terminal states", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;

    // queued → succeeded is forbidden by the contract table.
    try {
      transitionRun(db, { id: run.id, to: "succeeded" });
      expect.fail("expected transition rejection");
    } catch (error) {
      expect((error as Error).message).toMatch(/transition/i);
    }

    const running = transitionRun(db, { id: run.id, to: "running" });
    expect(running.status).toBe("running");
    expect(running.finishedAt).toBeNull();
    expect(transitionRun(db, { id: run.id, to: "succeeded" }).finishedAt).toBe(
      db.now().toISOString(),
    );
    db.close();
  });

  it("counts active runs for backup preconditions", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    expect(countActiveRuns(db)).toBe(1);
    transitionRun(db, { id: run.id, to: "running" });
    transitionRun(db, { id: run.id, to: "succeeded" });
    expect(countActiveRuns(db)).toBe(0);
    db.close();
  });

  it("lists runs newest first with optional status filter", () => {
    const clock = makeTestClock("2026-10-24T00:00:00.000Z");
    const db = openTestDatabase(makeLayout(makeTempRoot()), clock);
    const a = createRun(db, makeRun(makeWorkflow())).run;
    clock.advanceMs(1);
    const b = createRun(db, makeRun(makeWorkflow())).run;
    expect(listRuns(db).map((run) => run.id)).toEqual([b.id, a.id]);
    transitionRun(db, { id: b.id, to: "running" });
    expect(listRuns(db, { statuses: ["running"] }).map((run) => run.id)).toEqual([b.id]);
    db.close();
  });
});

describe("node run repository", () => {
  it("creates node runs against an existing run and rejects duplicate attempts", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    const nodeRun = {
      id: randomUUID(),
      runId: run.id,
      nodeId: "n1",
      attempt: 1,
      status: "pending" as const,
      inputRefs: [],
      outputRefs: [],
      sessionId: null,
    };
    createNodeRun(db, nodeRun);
    expect(() =>
      createNodeRun(db, { ...nodeRun, id: randomUUID() }),
    ).toThrow(/attempt/);
    expect(() =>
      createNodeRun(db, { ...nodeRun, id: randomUUID(), runId: randomUUID() }),
    ).toThrow(/run does not exist/);
    db.close();
  });

  it("transitions node runs through the contract table", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    const nodeRun = {
      id: randomUUID(),
      runId: run.id,
      nodeId: "n1",
      attempt: 1,
      status: "pending" as const,
      inputRefs: [],
      outputRefs: [],
      sessionId: null,
    };
    createNodeRun(db, nodeRun);

    const running = transitionNodeRun(db, { id: nodeRun.id, to: "running" });
    expect(running.status).toBe("running");
    const withSession = setNodeRunSession(db, { id: nodeRun.id, sessionId: "sess-123" });
    expect(withSession.sessionId).toBe("sess-123");

    expect(() => transitionNodeRun(db, { id: nodeRun.id, to: "pending" })).toThrow();
    expect(transitionNodeRun(db, { id: nodeRun.id, to: "succeeded" }).status).toBe("succeeded");
    expect(listNodeRuns(db, run.id)).toHaveLength(1);
    db.close();
  });
});

describe("run repository not-found and guard paths", () => {
  it("reports missing runs and node runs", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(getRun(db, randomUUID())).toBeUndefined();
    expect(() => transitionRun(db, { id: randomUUID(), to: "running" })).toThrow(
      /run not found/,
    );
    expect(() =>
      transitionNodeRun(db, { id: randomUUID(), to: "running" }),
    ).toThrow(/node run not found/);
    expect(() =>
      setNodeRunSession(db, { id: randomUUID(), sessionId: null }),
    ).toThrow(/node run not found/);
    expect(() => createNodeRun(db, {
      id: randomUUID(),
      runId: randomUUID(),
      nodeId: "n1",
      attempt: 1,
      status: "pending",
      inputRefs: [],
      outputRefs: [],
      sessionId: null,
    })).toThrow(/run does not exist/);
    db.close();
  });

  it("rejects node runs created in a non-pending status", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    expect(() =>
      createNodeRun(db, {
        id: randomUUID(),
        runId: run.id,
        nodeId: "n1",
        attempt: 1,
        status: "running",
        inputRefs: [],
        outputRefs: [],
        sessionId: null,
      }),
    ).toThrow(/pending/);
    db.close();
  });
});
