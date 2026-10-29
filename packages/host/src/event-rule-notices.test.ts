/**
 * D20': automation state notices land in the owner bot's chat. Enabling a
 * rule writes one "enabled" notice; the scan turns a matching failed-run
 * event into a review notice (rule on review); disabling writes "disabled"
 * and later events surface as skips. All rows carry the "automation" meta
 * kind, so the renderer can style them without touching the message thread.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { evaluateEventRules } from "@deepseek-bot/runtime";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { writeAutomationNotice } from "./automation-notices.js";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function automationRows(host: DeepSeekBotHost): Array<{ text: string; meta: { outcome: string; ruleId: string } }> {
  return (
    host.db.raw
      .prepare(
        "SELECT text, meta_json FROM chat_messages WHERE meta_json LIKE '%\"automation\"%' ORDER BY rowid ASC;",
      )
      .all() as Array<{ text: string; meta_json: string }>
  ).map((row) => ({ text: row.text, meta: JSON.parse(row.meta_json) as { outcome: string; ruleId: string } }));
}

async function waitForAutomationRow(host: DeepSeekBotHost, outcome: string): Promise<void> {
  await vi.waitFor(
    () => {
      const rows = automationRows(host);
      expect(rows.some((row) => row.meta.outcome === outcome)).toBe(true);
    },
    { timeout: 10_000 },
  );
}

describe("automation notices", () => {
  it("writes enabled/review/disabled/skipped notices into the bot chat", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-host-automation-"));
    roots.push(root);
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
      triggers: { intervalMs: 3_600_000 },
    });
    hosts.push(host);
    const policy = host.db.raw.prepare("SELECT id FROM tool_policies LIMIT 1;").get() as { id: string };
    const ws = host.db.raw.prepare("SELECT id FROM workspaces LIMIT 1;").get() as { id: string };
    const bot = (await host.handleMethod("bot.create", {
      name: "automation-bot",
      instructions: "x",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: ws.id,
      toolPolicyId: policy.id,
    })) as { id: string };
    const saved = (await host.handleMethod("workflow.save", {
      workflow: {
        name: "修一次",
        schemaVersion: "0.1",
        nodes: [
          {
            id: "n1",
            type: "bot",
            botId: bot.id,
            instructionTemplate: "do the thing",
            inputBindings: [],
          },
        ],
        edges: [],
      },
    })) as { id: string };
    const rule = (await host.handleMethod("eventRule.save", {
      botId: bot.id,
      rule: { name: "失败后修一次", workflowId: saved.id, eventType: "run.failed" },
    })) as { id: string };
    // The scan timer stays disabled (one-shot direct evaluations below make
    // the test deterministic); the real timer path is exercised in D20 tests.

    // Enabled: one immediate notice, and no duplicate on a repeat enable.
    await host.handleMethod("eventRule.enable", { id: rule.id, botId: bot.id });
    await host.handleMethod("eventRule.enable", { id: rule.id, botId: bot.id });
    const afterEnable = automationRows(host);
    expect(afterEnable).toHaveLength(1);
    expect(afterEnable[0]?.meta.outcome).toBe("enabled");
    expect(afterEnable[0]?.text).toContain("失败后修一次");

    // Switch the rule to review mode: one "review" notice.
    await host.handleMethod("eventRule.review", { id: rule.id, botId: bot.id });
    const reviewsBeforeEvent = automationRows(host).filter(
      (row) => row.meta.outcome === "review",
    ).length;
    expect(reviewsBeforeEvent).toBe(1);

    // Seed one failed run + its terminal event; one deterministic scan pass
    // enqueues the review item and emits the review notice.
    const runId = randomUUID();
    const at = host.db.now().toISOString();
    host.db.raw
      .prepare(
        "INSERT INTO runs (id, status, trigger_kind, trigger_json, workflow_snapshot_json, bot_snapshots_json, idempotency_key, created_at, finished_at) " +
          "VALUES (?, 'failed', 'manual', ?, ?, ?, ?, ?, ?);",
      )
      .run(
        runId,
        JSON.stringify({ kind: "manual", idempotencyKey: randomUUID() }),
        JSON.stringify({ id: randomUUID(), nodes: [{ id: "src", type: "bot", botId: bot.id }] }),
        JSON.stringify([{ id: bot.id }]),
        randomUUID(),
        at,
        at,
      );
    host.db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 0, ?, ?, ?);",
      )
      .run(randomUUID(), runId, at, "run.failed", JSON.stringify({ reason: "boom" }));
    await evaluateEventRules(host.db, host.engine, {
      onRuleOutcome: (notice) => {
        writeAutomationNotice(
          host.db,
          {
            ruleId: notice.ruleId,
            botId: notice.botId,
            ruleName: notice.ruleName,
            outcome: notice.outcome,
            runId: notice.runId,
            reason: notice.reason,
          },
          "zh",
        );
      },
    });
    await waitForAutomationRow(host, "review");
    const reviewRows = automationRows(host).filter((row) => row.meta.outcome === "review");
    expect(reviewRows).toHaveLength(reviewsBeforeEvent + 1);

    // Disabled: one notice; a later event surfaces as a skip.
    await host.handleMethod("eventRule.disable", { id: rule.id, botId: bot.id });
    expect(automationRows(host).some((row) => row.meta.outcome === "disabled")).toBe(true);
    host.db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, ?, ?, ?, ?);",
      )
      .run(randomUUID(), runId, 1, host.db.now().toISOString(), "run.failed", JSON.stringify({ reason: "boom" }));
    await evaluateEventRules(host.db, host.engine, {
      onRuleOutcome: (notice) => {
        writeAutomationNotice(
          host.db,
          {
            ruleId: notice.ruleId,
            botId: notice.botId,
            ruleName: notice.ruleName,
            outcome: notice.outcome,
            runId: notice.runId,
            reason: notice.reason,
          },
          "zh",
        );
      },
    });
    await waitForAutomationRow(host, "skipped");
    const skipRows = automationRows(host).filter((row) => row.meta.outcome === "skipped");
    expect(skipRows[skipRows.length - 1]?.text).toContain("rule disabled");
  });
});
