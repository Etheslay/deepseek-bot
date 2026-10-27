/**
 * Local event rules: one bot, default off, and one primary record per event.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendEventRuleRecord,
  createBot,
  decideEventRuleReview,
  enqueueEventRuleReview,
  findEventRuleReview,
  listEventRuleStates,
  listEventRules,
  listPendingEventRuleReviews,
  saveEventRule,
  saveWorkflow,
  setEventRuleEnabled,
  setEventRuleReview,
  type OpenedDatabase,
} from "../index.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  makeTestClock,
  makeWorkflow,
  openTestDatabase,
  seedProfileAndWorkspace,
  type TestClock,
} from "../test-support.js";

function setup(clock?: TestClock): { db: OpenedDatabase; botId: string; otherBotId: string; workflowId: string } {
  const db = openTestDatabase(makeLayout(makeTempRoot()), clock);
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  const now = db.now().toISOString();
  const policyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', '{}', ?, ?);",
    )
    .run(policyId, randomUUID(), now, now);
  const bot = makeBot(profile, workspaceId, { toolPolicyId: policyId });
  const other = makeBot(profile, workspaceId, { toolPolicyId: policyId, name: "另一个" });
  createBot(db, { bot });
  createBot(db, { bot: other });
  const base = makeWorkflow();
  const node = base.nodes[0]!;
  const workflow = makeWorkflow({
    nodes: [{ ...node, botId: bot.id }],
  });
  saveWorkflow(db, workflow);
  return { db, botId: bot.id, otherBotId: other.id, workflowId: workflow.id };
}

describe("event rules", () => {
  it("saves a disabled rule for one bot and keeps another bot's list empty", () => {
    const { db, botId, otherBotId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: " 失败后修一次 ",
      workflowId,
      eventType: "run.failed",
    });
    expect(rule.enabled).toBe(false);
    expect(rule.review).toBe(false);
    expect(rule.botId).toBe(botId);
    expect(rule.name).toBe("失败后修一次");
    expect(listEventRules(db, botId).map((item) => item.id)).toEqual([rule.id]);
    expect(listEventRules(db, otherBotId)).toEqual([]);

    const enabled = setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    expect(enabled.enabled).toBe(true);
    const disabled = setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(() => setEventRuleEnabled(db, { id: rule.id, botId: otherBotId, enabled: true })).toThrow(
      /not found/,
    );
    db.close();
  });

  it("rejects a workflow that does not include the bot", () => {
    const { db, otherBotId, workflowId } = setup();
    expect(() =>
      saveEventRule(db, {
        botId: otherBotId,
        name: "别人的",
        workflowId,
        eventType: "run.completed",
      }),
    ).toThrow(/does not include this bot/);
    db.close();
  });

  it("keeps a single primary record for one event", () => {
    const { db, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "一次",
      workflowId,
      eventType: "run.failed",
    });
    const eventId = randomUUID();
    appendEventRuleRecord(db, {
      ruleId: rule.id,
      eventId,
      outcome: "skipped",
      runId: null,
      reason: "rule disabled",
    });
    expect(() =>
      appendEventRuleRecord(db, {
        ruleId: rule.id,
        eventId,
        outcome: "started",
        runId: randomUUID(),
        reason: "matching local event",
      }),
    ).toThrow(/duplicate/);
    const duplicate = appendEventRuleRecord(db, {
      ruleId: rule.id,
      eventId,
      outcome: "duplicate",
      runId: null,
      reason: "duplicate event",
    });
    expect(duplicate.outcome).toBe("duplicate");
    db.close();
  });

  it("holds one pending review for an event and rejects a second", () => {
    const { db, botId, otherBotId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "先看一眼",
      workflowId,
      eventType: "run.failed",
    });
    expect(() => setEventRuleReview(db, { id: rule.id, botId: otherBotId })).toThrow(/not found/);
    const reviewing = setEventRuleReview(db, { id: rule.id, botId });
    expect(reviewing.review).toBe(true);
    expect(reviewing.enabled).toBe(false);

    const eventId = randomUUID();
    const pending = enqueueEventRuleReview(db, { ruleId: rule.id, eventId });
    expect(pending.status).toBe("pending");
    expect(findEventRuleReview(db, rule.id, eventId)?.id).toBe(pending.id);
    expect(findEventRuleReview(db, rule.id, randomUUID())).toBeUndefined();
    expect(() => enqueueEventRuleReview(db, { ruleId: rule.id, eventId })).toThrow(/duplicate/);
    expect(listPendingEventRuleReviews(db, { botId, limit: 0 })).toHaveLength(1);
    expect(listPendingEventRuleReviews(db, { botId, ruleId: rule.id, limit: 500 })).toEqual([
      expect.objectContaining({ id: pending.id, eventId, status: "pending" }),
    ]);
    expect(listPendingEventRuleReviews(db, { botId: otherBotId, limit: 20 })).toEqual([]);

    const denied = decideEventRuleReview(db, { id: pending.id, status: "denied", runId: null });
    expect(denied).toMatchObject({ status: "denied", runId: null });
    expect(denied.decidedAt).toEqual(expect.any(String));
    expect(() => decideEventRuleReview(db, { id: pending.id, status: "approved", runId: randomUUID() })).toThrow(
      /not pending/,
    );
    expect(listPendingEventRuleReviews(db, { botId, limit: 20 })).toEqual([]);
    expect(() => decideEventRuleReview(db, { id: randomUUID(), status: "denied", runId: null })).toThrow(
      /not found/,
    );
    db.close();
  });

  it("records one state row when a rule is enabled, disabled, or set to review", () => {
    const { db, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "记下开关",
      workflowId,
      eventType: "run.failed",
    });
    expect(listEventRuleStates(db, { botId, limit: 20 })).toEqual([]);

    const enabled = setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    expect(enabled.enabled).toBe(true);
    const afterEnable = listEventRuleStates(db, { botId, limit: 20 });
    expect(afterEnable).toEqual([
      expect.objectContaining({
        ruleId: rule.id,
        botId,
        state: "enabled",
        createdAt: expect.any(String),
      }),
    ]);

    const disabled = setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    expect(disabled.enabled).toBe(false);
    const reviewing = setEventRuleReview(db, { id: rule.id, botId });
    expect(reviewing.review).toBe(true);
    expect(listEventRuleStates(db, { botId, limit: 20 }).map((row) => row.state)).toEqual([
      "review",
      "disabled",
      "enabled",
    ]);
    db.close();
  });

  it("does not record a repeat call that leaves the state unchanged", () => {
    const { db, botId, workflowId } = setup();
    const rule = saveEventRule(db, {
      botId,
      name: "重复不算",
      workflowId,
      eventType: "run.completed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    expect(listEventRuleStates(db, { botId, limit: 20 })).toEqual([]);

    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    expect(listEventRuleStates(db, { botId, limit: 20 })).toHaveLength(1);

    setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    setEventRuleReview(db, { id: rule.id, botId });
    setEventRuleReview(db, { id: rule.id, botId });
    expect(listEventRuleStates(db, { botId, limit: 20 }).map((row) => row.state)).toEqual([
      "review",
      "disabled",
      "enabled",
    ]);
    db.close();
  });

  it("lists state rows for one bot newest first", () => {
    const clock = makeTestClock("2026-10-27T08:00:00.000Z");
    const { db, botId, otherBotId, workflowId } = setup(clock);
    const rule = saveEventRule(db, {
      botId,
      name: "按时间",
      workflowId,
      eventType: "run.failed",
    });
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: true });
    clock.advanceMs(1000);
    setEventRuleEnabled(db, { id: rule.id, botId, enabled: false });
    clock.advanceMs(1000);
    setEventRuleReview(db, { id: rule.id, botId });

    const listed = listEventRuleStates(db, { botId, limit: 20 });
    expect(
      listed.map((row) => ({
        state: row.state,
        at: row.createdAt,
        ruleId: row.ruleId,
        botId: row.botId,
      })),
    ).toEqual([
      { state: "review", at: "2026-10-27T08:00:02.000Z", ruleId: rule.id, botId },
      { state: "disabled", at: "2026-10-27T08:00:01.000Z", ruleId: rule.id, botId },
      { state: "enabled", at: "2026-10-27T08:00:00.000Z", ruleId: rule.id, botId },
    ]);
    expect(listEventRuleStates(db, { botId: otherBotId, limit: 20 })).toEqual([]);
    expect(listEventRuleStates(db, { botId, limit: 1 })).toEqual([
      expect.objectContaining({ state: "review" }),
    ]);
    db.close();
  });
});
