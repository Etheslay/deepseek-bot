import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  consumeApproval,
  createApproval,
  createNodeRun,
  createRun,
  decideApproval,
  expireApprovals,
  getApproval,
  listApprovals,
  registerArtifact,
  getArtifact,
  listArtifacts,
  StorageError,
} from "./index.js";
import type { NodeRun } from "@deepseek-bot/contracts";
import {
  makeApproval,
  makeArtifact,
  makeLayout,
  makeRun,
  makeTempRoot,
  makeTestClock,
  makeWorkflow,
  openTestDatabase,
} from "./test-support.js";

function seedRunAndNode(db: ReturnType<typeof openTestDatabase>): { runId: string; nodeRunId: string } {
  const run = createRun(db, makeRun(makeWorkflow())).run;
  const nodeRun: NodeRun = {
    id: randomUUID(),
    runId: run.id,
    nodeId: "n1",
    attempt: 1,
    status: "pending",
    inputRefs: [],
    outputRefs: [],
    sessionId: null,
  };
  createNodeRun(db, nodeRun);
  return { runId: run.id, nodeRunId: nodeRun.id };
}

describe("approval repository", () => {
  it("decides a pending approval once and rejects double decisions", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { runId, nodeRunId } = seedRunAndNode(db);
    const approval = makeApproval(runId, nodeRunId);
    createApproval(db, approval);

    const approved = decideApproval(db, { id: approval.id, decision: "approved" });
    expect(approved.status).toBe("approved");

    try {
      decideApproval(db, { id: approval.id, decision: "denied" });
      expect.fail("expected double-decision rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect((error as StorageError).details["status"]).toBe("approved");
    }
    db.close();
  });

  it("expires approvals past their TTL with the stable code", () => {
    const clock = makeTestClock("2026-10-24T00:00:00.000Z");
    const db = openTestDatabase(makeLayout(makeTempRoot()), clock);
    const { runId, nodeRunId } = seedRunAndNode(db);
    // Expires 10 minutes after creation (default TTL per CONTRACTS §2).
    const approval = makeApproval(runId, nodeRunId, {
      expiresAt: "2026-10-24T00:10:00.000Z",
    });
    createApproval(db, approval);

    clock.setIso("2026-10-24T00:11:00.000Z");
    try {
      decideApproval(db, { id: approval.id, decision: "approved" });
      expect.fail("expected approval expiry");
    } catch (error) {
      expect((error as StorageError).code).toBe("APPROVAL_EXPIRED");
    }
    expect(getApproval(db, approval.id)?.status).toBe("expired");
    db.close();
  });

  it("consumes an approved approval exactly once", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { runId, nodeRunId } = seedRunAndNode(db);
    const approval = makeApproval(runId, nodeRunId);
    createApproval(db, approval);

    expect(() => consumeApproval(db, { id: approval.id })).toThrow(/approved/);
    decideApproval(db, { id: approval.id, decision: "approved" });
    expect(consumeApproval(db, { id: approval.id }).status).toBe("consumed");
    expect(() => consumeApproval(db, { id: approval.id })).toThrow(/consumed/);
    db.close();
  });

  it("sweeps expired pending approvals", () => {
    const clock = makeTestClock("2026-10-24T00:00:00.000Z");
    const db = openTestDatabase(makeLayout(makeTempRoot()), clock);
    const { runId, nodeRunId } = seedRunAndNode(db);
    createApproval(db, makeApproval(runId, nodeRunId, { expiresAt: "2026-10-24T00:05:00.000Z" }));
    createApproval(db, makeApproval(runId, nodeRunId, { id: randomUUID(), expiresAt: "2026-10-24T01:00:00.000Z" }));

    clock.setIso("2026-10-24T00:30:00.000Z");
    expect(expireApprovals(db)).toBe(1);
    expect(listApprovals(db, { runId, status: "pending" })).toHaveLength(1);
    db.close();
  });
});

describe("artifact repository", () => {
  it("registers artifacts with run and node-run foreign keys", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { runId, nodeRunId } = seedRunAndNode(db);
    const artifact = makeArtifact(runId, nodeRunId);
    registerArtifact(db, artifact);
    expect(getArtifact(db, artifact.id)).toEqual(artifact);
    expect(listArtifacts(db, { runId })).toHaveLength(1);
    expect(listArtifacts(db, { nodeRunId })).toHaveLength(1);
    expect(() => registerArtifact(db, makeArtifact(randomUUID(), nodeRunId))).toThrow(
      /run does not exist/,
    );
    db.close();
  });
});

describe("approval guard branches", () => {
  it("rejects decisions and consumption for unknown approvals", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() => decideApproval(db, { id: randomUUID(), decision: "approved" })).toThrow(
      /not found/,
    );
    expect(() => consumeApproval(db, { id: randomUUID() })).toThrow(/not found/);
    db.close();
  });

  it("rejects approvals created with a non-pending status", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { runId, nodeRunId } = seedRunAndNode(db);
    expect(() =>
      createApproval(db, makeApproval(runId, nodeRunId, { status: "approved" })),
    ).toThrow(/pending/);
    db.close();
  });
});

describe("artifact guard branches", () => {
  it("rejects unknown node runs and duplicate artifact ids", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { runId, nodeRunId } = seedRunAndNode(db);
    expect(() =>
      registerArtifact(db, makeArtifact(runId, randomUUID())),
    ).toThrow(/node run does not exist/);
    const artifact = makeArtifact(runId, nodeRunId);
    registerArtifact(db, artifact);
    expect(() => registerArtifact(db, artifact)).toThrow(/already exists/);
    db.close();
  });
});
