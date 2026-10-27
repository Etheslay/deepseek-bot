/**
 * D20 trigger rules and the review queue: bot of CRUD, dedup per (rule,
 * source event), decide guards and the loop-guard lookup.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBot,
  decideTriggerFiring,
  deleteTriggerRule,
  getTriggerFiring,
  getTriggerCursor,
  isTriggerStartedRun,
  listTriggerFirings,
  listTriggerRules,
  recordTriggerFiring,
  saveTriggerRule,
  setTriggerEnabled,
  updateTriggerCursor,
  type OpenedDatabase,
} from "../index.js";
import { makeLayout, makeTempRoot, openTestDatabase, seedProfileAndWorkspace } from "../test-support.js";

const WORKFLOW = "77777777-7777-4777-8777-777777777777";
const SOURCE = "88888888-8888-4888-8888-888888888888";
const EVENT = "99999999-9999-4999-8999-999999999991";

function seeded(): OpenedDatabase {
  const db = openTestDatabase(makeLayout(makeTempRoot()));
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  createBotRow(db, profile.id, workspaceId);
  db.raw
    .prepare(
      "INSERT INTO workflows (id, revision, name, schema_version, nodes_json, edges_json, limits_json, created_at, updated_at) " +
        "VALUES (?, ?, 'target', '0.1', '[]', '[]', '{}', datetime('now'), datetime('now'));",
    )
    .run(WORKFLOW, randomUUID());
  db.raw
    .prepare(
      "INSERT INTO workflows (id, revision, name, schema_version, nodes_json, edges_json, limits_json, created_at, updated_at) " +
        "VALUES (?, ?, 'source', '0.1', '[]', '[]', '{}', datetime('now'), datetime('now'));",
    )
    .run(SOURCE, randomUUID());
  return db;
}

function createBotRow(db: OpenedDatabase, profileId: string, workspaceId: string): void {
  const now = db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', '{}', ?, ?);",
    )
    .run(policyId, randomUUID(), now, now);
  createBot(db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "trigger-bot",
      instructions: "x",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      archivedAt: null,
    },
  });
}

describe("trigger rules", () => {
  it("saves, toggles, updates and deletes rules with workflow validation", () => {
    const db = seeded();
    const rule = saveTriggerRule(db, {
      name: "失败即修复",
      workflowId: WORKFLOW,
      eventType: "run.failed",
      filterWorkflowId: SOURCE,
    });
    expect(rule).toMatchObject({
      name: "失败即修复",
      workflowId: WORKFLOW,
      eventType: "run.failed",
      filterWorkflowId: SOURCE,
      enabled: false,
    });
    expect(() =>
      saveTriggerRule(db, { name: "ghost", workflowId: randomUUID(), eventType: "run.failed" }),
    ).toThrowError(/target workflow does not exist/);
    expect(() =>
      saveTriggerRule(db, {
        name: "ghost-filter",
        workflowId: WORKFLOW,
        eventType: "run.failed",
        filterWorkflowId: randomUUID(),
      }),
    ).toThrowError(/source filter workflow does not exist/);

    expect(setTriggerEnabled(db, { id: rule.id, enabled: true }).enabled).toBe(true);
    const updated = saveTriggerRule(db, {
      id: rule.id,
      name: "改名",
      workflowId: SOURCE,
      eventType: "run.completed",
    });
    expect(updated).toMatchObject({ name: "改名", workflowId: SOURCE, enabled: true });
    expect(getTriggerCursor(db, rule.id)).toBe(0);
    updateTriggerCursor(db, rule.id, 42);
    expect(getTriggerCursor(db, rule.id)).toBe(42);

    deleteTriggerRule(db, rule.id);
    expect(listTriggerRules(db)).toEqual([]);
    db.close();
  });
});

describe("trigger firings", () => {
  function rule(db: OpenedDatabase) {
    return saveTriggerRule(db, {
      name: "r",
      workflowId: WORKFLOW,
      eventType: "run.failed",
    });
  }

  it("records once per (rule, source event) and lists newest first", () => {
    const db = seeded();
    const r = rule(db);
    expect(
      recordTriggerFiring(db, {
        ruleId: r.id,
        ruleName: r.name,
        workflowId: r.workflowId,
        eventType: r.eventType,
        sourceEventId: EVENT,
        sourceRunId: null,
        sourceWorkflowId: SOURCE,
        reason: "event",
      }),
    ).toBe(true);
    expect(
      recordTriggerFiring(db, {
        ruleId: r.id,
        ruleName: r.name,
        workflowId: r.workflowId,
        eventType: r.eventType,
        sourceEventId: EVENT,
        sourceRunId: null,
        sourceWorkflowId: SOURCE,
        reason: "event",
      }),
    ).toBe(false);
    const firings = listTriggerFirings(db, { status: "pending" });
    expect(firings).toHaveLength(1);
    expect(firings[0]).toMatchObject({
      ruleId: r.id,
      ruleName: "r",
      eventType: "run.failed",
      reason: "event",
      status: "pending",
    });
    db.close();
  });

  it("decides a pending firing once and guards replays", () => {
    const db = seeded();
    const r = rule(db);
    recordTriggerFiring(db, {
      ruleId: r.id,
      ruleName: r.name,
      workflowId: r.workflowId,
      eventType: r.eventType,
      sourceEventId: EVENT,
      sourceRunId: null,
      sourceWorkflowId: null,
      reason: "missed",
    });
    const firing = listTriggerFirings(db)[0]!;
    const dismissed = decideTriggerFiring(db, { firingId: firing.id, decision: "dismiss" });
    expect(dismissed.status).toBe("dismissed");
    expect(getTriggerFiring(db, firing.id)?.decidedAt).not.toBeNull();
    expect(() =>
      decideTriggerFiring(db, { firingId: firing.id, decision: "start" }),
    ).toThrowError(/already decided/);
    expect(() =>
      decideTriggerFiring(db, { firingId: randomUUID(), decision: "start" }),
    ).toThrowError(/not found/);
    db.close();
  });

  it("carries the loop guard through started_run_id", () => {
    const db = seeded();
    const r = rule(db);
    recordTriggerFiring(db, {
      ruleId: r.id,
      ruleName: r.name,
      workflowId: r.workflowId,
      eventType: r.eventType,
      sourceEventId: EVENT,
      sourceRunId: null,
      sourceWorkflowId: null,
      reason: "event",
    });
    const firing = listTriggerFirings(db)[0]!;
    const startedRunId = randomUUID();
    decideTriggerFiring(db, { firingId: firing.id, decision: "start", startedRunId });
    expect(isTriggerStartedRun(db, startedRunId)).toBe(true);
    expect(isTriggerStartedRun(db, randomUUID())).toBe(false);
    db.close();
  });
});
