/**
 * Local event rules: one bot, default off, and one primary record per event.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendEventRuleRecord,
  createBot,
  listEventRules,
  saveEventRule,
  saveWorkflow,
  setEventRuleEnabled,
  type OpenedDatabase,
} from "../index.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  makeWorkflow,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "../test-support.js";

function setup(): { db: OpenedDatabase; botId: string; otherBotId: string; workflowId: string } {
  const db = openTestDatabase(makeLayout(makeTempRoot()));
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
});
