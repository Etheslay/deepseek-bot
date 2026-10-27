/**
 * Host surface for one bot's local event rule: save, list, enable, disable,
 * and a listable skip. Starting a run is covered in the runtime suite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { evaluateEventRules } from "@deepseek-bot/runtime";
import { createHost, DEFAULT_MODEL_PROFILE_ID, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function makeHost(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-host-event-rules-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-not-used",
    triggers: { intervalMs: 3_600_000 },
  });
  hosts.push(host);
  return host;
}

async function seedWorkflow(host: DeepSeekBotHost, name: string): Promise<{ workflowId: string; botId: string }> {
  const policy = host.db.raw.prepare("SELECT id FROM tool_policies LIMIT 1;").get() as { id: string };
  const ws = host.db.raw.prepare("SELECT id FROM workspaces LIMIT 1;").get() as { id: string };
  const bot = (await host.handleMethod("bot.create", {
    name: `${name}-bot`,
    instructions: "x",
    modelProfileId: DEFAULT_MODEL_PROFILE_ID,
    workspaceId: ws.id,
    toolPolicyId: policy.id,
  })) as { id: string };
  const saved = (await host.handleMethod("workflow.save", {
    workflow: {
      name,
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
  return { workflowId: saved.id, botId: bot.id };
}

describe("eventRule host methods", () => {
  it("saves a disabled rule, toggles it, and lists a disabled skip", async () => {
    const host = await makeHost();
    const owned = await seedWorkflow(host, "repair");
    const other = await seedWorkflow(host, "other");
    const saved = (await host.handleMethod("eventRule.save", {
      botId: owned.botId,
      rule: { name: "失败后修一次", workflowId: owned.workflowId, eventType: "run.failed" },
    })) as { id: string; enabled: boolean; botId: string };
    expect(saved.enabled).toBe(false);
    expect(saved.botId).toBe(owned.botId);

    const listed = (await host.handleMethod("eventRule.list", { botId: owned.botId })) as {
      rules: Array<{ id: string; enabled: boolean }>;
    };
    expect(listed.rules.map((rule) => rule.id)).toEqual([saved.id]);
    const otherList = (await host.handleMethod("eventRule.list", { botId: other.botId })) as {
      rules: unknown[];
    };
    expect(otherList.rules).toEqual([]);

    await expect(
      host.handleMethod("eventRule.enable", { botId: other.botId, id: saved.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const enabled = (await host.handleMethod("eventRule.enable", {
      botId: owned.botId,
      id: saved.id,
    })) as { enabled: boolean };
    expect(enabled.enabled).toBe(true);
    const disabled = (await host.handleMethod("eventRule.disable", {
      botId: owned.botId,
      id: saved.id,
    })) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    const eventId = randomUUID();
    const runId = randomUUID();
    const at = "2026-10-27T04:00:00.000Z";
    host.db.raw
      .prepare(
        "INSERT INTO runs (id, status, trigger_kind, trigger_json, workflow_snapshot_json, bot_snapshots_json, idempotency_key, created_at, finished_at) " +
          "VALUES (?, 'failed', 'manual', ?, '{}', ?, ?, ?, ?);",
      )
      .run(
        runId,
        JSON.stringify({ kind: "manual", idempotencyKey: randomUUID() }),
        JSON.stringify([{ id: owned.botId }]),
        randomUUID(),
        at,
        at,
      );
    host.db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 0, ?, 'run.failed', '{}');",
      )
      .run(eventId, runId, at);
    const evaluated = evaluateEventRules(host.db, host.engine);
    expect(evaluated).toMatchObject({ started: 0, skipped: 1 });
    const records = (await host.handleMethod("eventRule.record.list", {
      botId: owned.botId,
      outcome: "skipped",
    })) as { records: Array<{ eventId: string; reason: string; runId: string | null }> };
    expect(records.records).toEqual([
      expect.objectContaining({ eventId, reason: "rule disabled", runId: null }),
    ]);
  });

  it("lists a pending review, approves one run, and denies another", async () => {
    const host = await makeHost();
    const owned = await seedWorkflow(host, "review");
    const other = await seedWorkflow(host, "stranger");
    const saved = (await host.handleMethod("eventRule.save", {
      botId: owned.botId,
      rule: { name: "失败先看", workflowId: owned.workflowId, eventType: "run.failed" },
    })) as { id: string; enabled: boolean; review: boolean };
    expect(saved).toMatchObject({ enabled: false, review: false });
    await expect(
      host.handleMethod("eventRule.review", { botId: other.botId, id: saved.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const reviewing = (await host.handleMethod("eventRule.review", {
      botId: owned.botId,
      id: saved.id,
    })) as { review: boolean; enabled: boolean };
    expect(reviewing.review).toBe(true);
    expect(reviewing.enabled).toBe(false);
    await host.handleMethod("eventRule.enable", { botId: owned.botId, id: saved.id });

    const firstEvent = randomUUID();
    const secondEvent = randomUUID();
    const at = "2026-10-27T06:00:00.000Z";
    for (const eventId of [firstEvent, secondEvent]) {
      const runId = randomUUID();
      host.db.raw
        .prepare(
          "INSERT INTO runs (id, status, trigger_kind, trigger_json, workflow_snapshot_json, bot_snapshots_json, idempotency_key, created_at, finished_at) " +
            "VALUES (?, 'failed', 'manual', ?, '{}', ?, ?, ?, ?);",
        )
        .run(
          runId,
          JSON.stringify({ kind: "manual", idempotencyKey: randomUUID() }),
          JSON.stringify([{ id: owned.botId }]),
          randomUUID(),
          at,
          at,
        );
      host.db.raw
        .prepare(
          "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 0, ?, 'run.failed', '{}');",
        )
        .run(eventId, runId, at);
    }
    expect(evaluateEventRules(host.db, host.engine)).toMatchObject({ started: 0, pending: 2, skipped: 0 });
    const listed = (await host.handleMethod("eventRule.review.list", { botId: owned.botId })) as {
      items: Array<{ id: string; eventId: string; status: string }>;
    };
    expect(listed.items).toHaveLength(2);
    expect(listed.items.every((item) => item.status === "pending")).toBe(true);
    const otherList = (await host.handleMethod("eventRule.review.list", { botId: other.botId })) as {
      items: unknown[];
    };
    expect(otherList.items).toEqual([]);
    const runsBefore = (
      host.db.raw.prepare("SELECT COUNT(*) AS n FROM runs;").get() as { n: number }
    ).n;

    const approved = (await host.handleMethod("eventRule.review.approve", {
      botId: owned.botId,
      id: listed.items[0]!.id,
    })) as { status: string; runId: string; eventId: string };
    expect(approved.status).toBe("approved");
    expect(approved.runId).toEqual(expect.any(String));
    expect(
      (host.db.raw.prepare("SELECT COUNT(*) AS n FROM runs;").get() as { n: number }).n,
    ).toBe(runsBefore + 1);
    await expect(
      host.handleMethod("eventRule.review.approve", { botId: owned.botId, id: listed.items[0]!.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      (host.db.raw.prepare("SELECT COUNT(*) AS n FROM runs;").get() as { n: number }).n,
    ).toBe(runsBefore + 1);

    const denied = (await host.handleMethod("eventRule.review.deny", {
      botId: owned.botId,
      id: listed.items[1]!.id,
    })) as { status: string; runId: null; eventId: string };
    expect(denied).toMatchObject({ status: "denied", runId: null });
    const remaining = (await host.handleMethod("eventRule.review.list", { botId: owned.botId })) as {
      items: unknown[];
    };
    expect(remaining.items).toEqual([]);
    const records = (await host.handleMethod("eventRule.record.list", { botId: owned.botId })) as {
      records: Array<{ eventId: string; outcome: string; reason: string; runId: string | null }>;
    };
    expect(records.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: approved.eventId,
          outcome: "started",
          reason: "review approved",
          runId: approved.runId,
        }),
        expect.objectContaining({
          eventId: denied.eventId,
          outcome: "skipped",
          reason: "review denied",
          runId: null,
        }),
      ]),
    );
    await expect(
      host.handleMethod("eventRule.review.approve", { botId: owned.botId, id: randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("records a real state change once, skips a no-op, and lists newest first", async () => {
    const host = await makeHost();
    const owned = await seedWorkflow(host, "states");
    const other = await seedWorkflow(host, "states-other");
    const saved = (await host.handleMethod("eventRule.save", {
      botId: owned.botId,
      rule: { name: "状态记录", workflowId: owned.workflowId, eventType: "run.completed" },
    })) as { id: string };
    const empty = (await host.handleMethod("eventRule.state.list", { botId: owned.botId })) as {
      states: unknown[];
    };
    expect(empty.states).toEqual([]);

    await host.handleMethod("eventRule.enable", { botId: owned.botId, id: saved.id });
    await host.handleMethod("eventRule.enable", { botId: owned.botId, id: saved.id });
    await host.handleMethod("eventRule.disable", { botId: owned.botId, id: saved.id });
    await host.handleMethod("eventRule.disable", { botId: owned.botId, id: saved.id });
    await host.handleMethod("eventRule.review", { botId: owned.botId, id: saved.id });
    await host.handleMethod("eventRule.review", { botId: owned.botId, id: saved.id });

    const listed = (await host.handleMethod("eventRule.state.list", { botId: owned.botId })) as {
      states: Array<{ ruleId: string; botId: string; state: string; at: string }>;
    };
    expect(listed.states.map((row) => row.state)).toEqual(["review", "disabled", "enabled"]);
    expect(listed.states.every((row) => row.ruleId === saved.id && row.botId === owned.botId)).toBe(true);
    expect(listed.states.every((row) => row.at.length > 0)).toBe(true);
    const hidden = (await host.handleMethod("eventRule.state.list", { botId: other.botId })) as {
      states: unknown[];
    };
    expect(hidden.states).toEqual([]);
  });
});
