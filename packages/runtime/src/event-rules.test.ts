/**
 * One local event starts one run. The same event does not start a second
 * run. A disabled rule records a skip and still does not start a run after
 * it is enabled later.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { listEventRuleRecords, saveEventRule, saveWorkflow, setEventRuleEnabled } from "@deepseek-bot/storage";
import { evaluateEventRules } from "./event-rules.js";
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
    const runsAfterFirst = runCount(db);
    const followUp = randomUUID();
    db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 50, ?, 'run.failed', ?);",
      )
      .run(followUp, started[0]?.runId, "2026-10-27T05:00:00.000Z", JSON.stringify({ reason: "again" }));
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
});
