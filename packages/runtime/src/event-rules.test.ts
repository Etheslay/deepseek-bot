/**
 * One local event starts one run. The same event does not start a second
 * run. A disabled rule records a skip and still does not start a run after
 * it is enabled later.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  claimEventRuleKey,
  listEventRuleRecords,
  listPendingEventRuleReviews,
  saveEventRule,
  saveWorkflow,
  setEventRuleEnabled,
  setEventRuleReview,
} from "@deepseek-bot/storage";
import {
  approveEventRuleReview,
  denyEventRuleReview,
  evaluateEventRules,
  type EventRuleNotice,
} from "./event-rules.js";
import { WorkflowEngine } from "./engine.js";
import {
  botNode,
  insertBot,
  makeBot,
  makeWorkflowFixture,
  openTestDatabase,
  ScriptedExecutor,
  seedProfileAndWorkspace,
} from "./test-support.js";

function setup(): {
  db: ReturnType<typeof openTestDatabase>;
  engine: WorkflowEngine;
  botId: string;
  workflowId: string;
} {
  const db = openTestDatabase();
  const refs = seedProfileAndWorkspace(db);
  const bot = makeBot(refs);
  insertBot(db, bot);
  const executor = new ScriptedExecutor();
  const engine = new WorkflowEngine({ db, executor });
  const workflow = makeWorkflowFixture([botNode("a", bot.id)], []);
  saveWorkflow(db, workflow);
  return { db, engine, botId: bot.id, workflowId: workflow.id };
}

function runCount(db: ReturnType<typeof openTestDatabase>): number {
  return (db.raw.prepare("SELECT COUNT(*) AS n FROM runs;").get() as { n: number }).n;
}

function seedEvent(
  db: ReturnType<typeof openTestDatabase>,
  botId: string,
  eventId: string,
  eventType: "run.failed" | "run.completed",
): string {
  const runId = randomUUID();
  const at = "2026-10-27T03:00:00.000Z";
  db.raw
    .prepare(
      "INSERT INTO runs (id, status, trigger_kind, trigger_json, workflow_snapshot_json, bot_snapshots_json, idempotency_key, created_at, finished_at) " +
        "VALUES (?, 'failed', 'manual', ?, ?, ?, ?, ?, ?);",
    )
    .run(
      runId,
      JSON.stringify({ kind: "manual", idempotencyKey: randomUUID() }),
      JSON.stringify({
        id: randomUUID(),
        nodes: [{ id: "src", type: "bot", botId }],
      }),
      JSON.stringify([{ id: botId }]),
      randomUUID(),
      at,
      at,
    );
  db.raw
    .prepare(
      "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 0, ?, ?, ?);",
    )
    .run(eventId, runId, at, eventType, JSON.stringify({ reason: "boom" }));
  return runId;
}

describe("local event rules", () => {
  it("emits one notice per started/skipped outcome and survives a throwing hook", () => {
    const { db, engine, botId, workflowId } = setup();
    const notices: EventRuleNotice[] = [];
    const rule = saveEventRule(db, {
      botId,
      name: "通知规则",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    seedEvent(db, botId, randomUUID(), "run.failed");
    const fired = evaluateEventRules(db, engine, { onRuleOutcome: (n) => notices.push(n) });
    expect(fired.started).toBe(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      ruleId: rule.id,
      botId,
      ruleName: "通知规则",
      outcome: "started",
    });
    expect(notices[0]?.runId).not.toBeNull();

    // A throwing notice sink must never break the evaluation.
    seedEvent(db, botId, randomUUID(), "run.failed");
    const throwing = evaluateEventRules(db, engine, {
      onRuleOutcome: () => {
        throw new Error("notice sink blew up");
      },
    });
    expect(throwing.started).toBe(1);

    setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    seedEvent(db, botId, randomUUID(), "run.failed");
    const skippedPass = evaluateEventRules(db, engine, { onRuleOutcome: (n) => notices.push(n) });
    expect(skippedPass.skipped).toBe(1);
    expect(notices[1]).toMatchObject({ outcome: "skipped", reason: "rule disabled" });
    db.close();
  });
  it("starts one run for one matching local event and ignores an earlier event", () => {
    const { db, engine, botId, workflowId } = setup();
    const earlier = randomUUID();
    seedEvent(db, botId, earlier, "run.failed");
    const rule = saveEventRule(db, {
      botId,
      name: "失败后修一次",
      workflowId,
      eventType: "run.failed",
    });
    expect(rule.enabled).toBe(false);
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });

    const ignored = evaluateEventRules(db, engine);
    expect(ignored.started).toBe(0);
    expect(runCount(db)).toBe(1);

    const eventId = randomUUID();
    seedEvent(db, randomUUID(), randomUUID(), "run.failed");
    seedEvent(db, botId, eventId, "run.failed");
    const fired = evaluateEventRules(db, engine);
    expect(fired.started).toBe(1);
    expect(runCount(db)).toBe(4);
    const started = listEventRuleRecords(db, { botId, outcome: "started", limit: 20 });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ eventId, outcome: "started", reason: "matching local event" });
    expect(started[0]?.runId).not.toBeNull();
    db.close();
  });

  it("does not start a second run when the same event is seen again", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "一次",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    expect(evaluateEventRules(db, engine).started).toBe(1);
    const runsAfterFirst = runCount(db);

    db.raw.prepare("UPDATE event_rules SET cursor_event_rowid = 0 WHERE id = ?;").run(rule.id);
    const again = evaluateEventRules(db, engine);
    expect(again.started).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(runCount(db)).toBe(runsAfterFirst);
    const records = listEventRuleRecords(db, { botId, ruleId: rule.id, limit: 20 });
    expect(records.filter((record) => record.outcome === "started")).toHaveLength(1);
    expect(records.filter((record) => record.outcome === "duplicate" && record.eventId === eventId)).toHaveLength(1);
    db.close();
  });

  it("records a skip for a disabled rule and does not start a run after enable", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "先关着",
      workflowId,
      eventType: "run.completed",
    });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.completed");
    const skipped = evaluateEventRules(db, engine);
    expect(skipped.started).toBe(0);
    expect(skipped.skipped).toBe(1);
    expect(runCount(db)).toBe(1);
    const records = listEventRuleRecords(db, { botId, outcome: "skipped", limit: 20 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ eventId, outcome: "skipped", reason: "rule disabled", runId: null });

    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    const later = evaluateEventRules(db, engine);
    expect(later.started).toBe(0);
    expect(runCount(db)).toBe(1);
    db.close();
  });

  it("does not start another run from a run the rule itself started", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "不循环",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    seedEvent(db, botId, randomUUID(), "run.failed");
    expect(evaluateEventRules(db, engine).started).toBe(1);
    const started = listEventRuleRecords(db, { botId, outcome: "started", limit: 5 });
    const sourceRunId = started[0]?.runId;
    if (sourceRunId == null) {
      throw new Error("expected the event rule to start a run");
    }
    const runsAfterFirst = runCount(db);
    const followUp = randomUUID();
    db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 50, ?, 'run.failed', ?);",
      )
      .run(followUp, sourceRunId, "2026-10-27T05:00:00.000Z", JSON.stringify({ reason: "again" }));
    const second = evaluateEventRules(db, engine);
    expect(second.started).toBe(0);
    expect(second.skipped).toBe(1);
    expect(runCount(db)).toBe(runsAfterFirst);
    const skips = listEventRuleRecords(db, { botId, outcome: "skipped", limit: 5 });
    expect(skips[0]).toMatchObject({
      eventId: followUp,
      reason: "source run was started by an event rule",
      runId: null,
    });
    db.close();
  });

  it("holds a matching event for review and does not start a run", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "先评审",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    setEventRuleReview(db, { id: rule.id, botId });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    const held = evaluateEventRules(db, engine);
    expect(held).toMatchObject({ started: 0, pending: 1, skipped: 0 });
    expect(runCount(db)).toBe(1);
    const pending = listPendingEventRuleReviews(db, { botId, limit: 20 });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ eventId, status: "pending", runId: null });
    db.close();
  });

  it("starts exactly one run when a pending review is approved", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "批准一次",
      workflowId,
      eventType: "run.completed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    setEventRuleReview(db, { id: rule.id, botId });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.completed");
    expect(evaluateEventRules(db, engine).pending).toBe(1);
    const pending = listPendingEventRuleReviews(db, { botId, limit: 5 });
    const reviewId = pending[0]!.id;
    const runsBefore = runCount(db);

    const approved = approveEventRuleReview(db, engine, { botId, reviewId });
    expect(approved).toMatchObject({ status: "approved", eventId });
    expect(approved.runId).toEqual(expect.any(String));
    expect(runCount(db)).toBe(runsBefore + 1);
    expect(() => approveEventRuleReview(db, engine, { botId, reviewId })).toThrow(/not pending/);
    expect(runCount(db)).toBe(runsBefore + 1);
    const started = listEventRuleRecords(db, { botId, outcome: "started", limit: 5 });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ eventId, runId: approved.runId, reason: "review approved" });
    expect(listPendingEventRuleReviews(db, { botId, limit: 5 })).toEqual([]);
    db.close();
  });

  it("records a skip and starts nothing when a pending review is denied", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "拒绝",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    setEventRuleReview(db, { id: rule.id, botId });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    expect(evaluateEventRules(db, engine).pending).toBe(1);
    const reviewId = listPendingEventRuleReviews(db, { botId, limit: 5 })[0]!.id;
    const runsBefore = runCount(db);

    const denied = denyEventRuleReview(db, { botId, reviewId });
    expect(denied).toMatchObject({ status: "denied", eventId, runId: null });
    expect(runCount(db)).toBe(runsBefore);
    expect(() => denyEventRuleReview(db, { botId, reviewId })).toThrow(/not pending/);
    expect(runCount(db)).toBe(runsBefore);
    const skips = listEventRuleRecords(db, { botId, outcome: "skipped", limit: 5 });
    expect(skips).toEqual([
      expect.objectContaining({ eventId, outcome: "skipped", reason: "review denied", runId: null }),
    ]);
    expect(listPendingEventRuleReviews(db, { botId, limit: 5 })).toEqual([]);
    db.close();
  });

  it("does not enqueue a second pending item for the same event", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "不重复入队",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    setEventRuleReview(db, { id: rule.id, botId });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    expect(evaluateEventRules(db, engine)).toMatchObject({ pending: 1, started: 0, duplicates: 0 });
    const runsAfter = runCount(db);

    db.raw.prepare("UPDATE event_rules SET cursor_event_rowid = 0 WHERE id = ?;").run(rule.id);
    const again = evaluateEventRules(db, engine);
    expect(again).toMatchObject({ pending: 0, started: 0, duplicates: 1 });
    expect(runCount(db)).toBe(runsAfter);
    const pending = listPendingEventRuleReviews(db, { botId, ruleId: rule.id, limit: 20 });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ eventId, status: "pending" });
    db.close();
  });

  it("records a skip and does not enqueue when a review rule is disabled", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "关着的评审",
      workflowId,
      eventType: "run.completed",
    });
    setEventRuleReview(db, { id: rule.id, botId });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.completed");
    const skipped = evaluateEventRules(db, engine);
    expect(skipped).toMatchObject({ started: 0, pending: 0, skipped: 1 });
    expect(runCount(db)).toBe(1);
    expect(listPendingEventRuleReviews(db, { botId, limit: 20 })).toEqual([]);
    const records = listEventRuleRecords(db, { botId, outcome: "skipped", limit: 5 });
    expect(records[0]).toMatchObject({ eventId, reason: "rule disabled", runId: null });
    db.close();
  });

  it("drops an in-window replay as a duplicate with the window reason", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "窗口防重",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    expect(evaluateEventRules(db, engine).started).toBe(1);
    const runsAfterFirst = runCount(db);

    // A replay (cursor rewind) inside the dedupe window is claimed live, so
    // the sighting drops before reaching the engine again.
    db.raw.prepare("UPDATE event_rules SET cursor_event_rowid = 0 WHERE id = ?;").run(rule.id);
    const again = evaluateEventRules(db, engine);
    expect(again).toMatchObject({ started: 0, duplicates: 1 });
    expect(runCount(db)).toBe(runsAfterFirst);
    const records = listEventRuleRecords(db, { botId, ruleId: rule.id, outcome: "duplicate", limit: 5 });
    expect(records[0]).toMatchObject({
      eventId,
      outcome: "duplicate",
      reason: "duplicate trigger within window",
    });
    db.close();
  });

  it("recovers a claim whose pass crashed before executing", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "崩溃恢复",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    // A crashed pass claimed the key but never executed and never recorded
    // anything. The next evaluation must start the run, not lose the trigger.
    expect(claimEventRuleKey(db, { ruleId: rule.id, eventId })).toBe(true);
    const result = evaluateEventRules(db, engine);
    expect(result).toMatchObject({ started: 1, duplicates: 0 });
    expect(runCount(db)).toBe(2);
    expect(listEventRuleRecords(db, { botId, outcome: "started", limit: 5 })).toHaveLength(1);
    db.close();
  });

  it("falls back to the permanent record dedupe once the window has passed", () => {
    const { db, engine, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "过期回落",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    const eventId = randomUUID();
    seedEvent(db, botId, eventId, "run.failed");
    expect(evaluateEventRules(db, engine).started).toBe(1);
    // The claim expired long ago; the pass prunes it and the primary record
    // still blocks a second run — with the permanent reason, not the window's.
    db.raw
      .prepare("UPDATE event_rule_keys SET claimed_at = '2020-01-01T00:00:00.000Z' WHERE event_id = ?;")
      .run(eventId);
    db.raw.prepare("UPDATE event_rules SET cursor_event_rowid = 0 WHERE id = ?;").run(rule.id);
    const again = evaluateEventRules(db, engine);
    expect(again).toMatchObject({ started: 0, duplicates: 1 });
    const records = listEventRuleRecords(db, { botId, ruleId: rule.id, outcome: "duplicate", limit: 5 });
    expect(records[0]).toMatchObject({ eventId, outcome: "duplicate", reason: "duplicate event" });
    db.close();
  });
});
