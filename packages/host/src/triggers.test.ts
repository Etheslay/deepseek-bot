/**
 * D20 end-to-end at the host surface: a rule watches the persisted stream,
 * a failed run enqueues a firing, the review decision starts the target
 * workflow, and runs started by the queue never re-fire (loop guard).
 * Missed events (older than this boot) are enqueued as "missed".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createHost, DEFAULT_MODEL_PROFILE_ID, type DeepSeekBotHost } from "./host.js";
import { evaluateTriggerRules } from "./triggers.js";
import { isTriggerStartedRun } from "@deepseek-bot/storage";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    // The queue-started run settles asynchronously on a closed database;
    // Windows may hold the directory past shutdown (best effort — leftover
    // temp dirs are harmless and never fail the suite on cleanup noise).
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
});

async function makeHost(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-host-triggers-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-not-used",
    triggers: { intervalMs: 3_600_000 }, // keep the poll out of the test's way
  });
  hosts.push(host);
  return host;
}

/** A one-bot target workflow through the public surface. */
async function seedWorkflow(host: DeepSeekBotHost, name: string): Promise<{
  workflowId: string;
  botId: string;
  revision: string;
}> {
  const policy = host.db.raw.prepare("SELECT id FROM tool_policies LIMIT 1;").get() as {
    id: string;
  };
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
  })) as { id: string; revision: string };
  return { workflowId: saved.id, botId: bot.id, revision: saved.revision };
}

/** A finished failed run + its terminal event, seeded directly. */
function seedFailedRun(
  host: DeepSeekBotHost,
  sourceWorkflowId: string,
  eventTimestamp: string,
): string {
  const runId = randomUUID();
  const at = eventTimestamp;
  host.db.raw
    .prepare(
      "INSERT INTO runs (id, status, trigger_kind, trigger_json, workflow_snapshot_json, bot_snapshots_json, idempotency_key, created_at, finished_at) " +
        "VALUES (?, 'failed', 'manual', ?, ?, '[]', ?, ?, ?);",
    )
    .run(
      runId,
      JSON.stringify({ kind: "manual", idempotencyKey: randomUUID() }),
      JSON.stringify({ id: sourceWorkflowId, revision: randomUUID(), name: "src", schemaVersion: "0.1", nodes: [], edges: [], limits: { maxConcurrentNodes: 2 } }),
      randomUUID(),
      at,
      at,
    );
  host.db.raw
    .prepare(
      "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, 0, ?, 'run.failed', ?);",
    )
    .run(randomUUID(), runId, eventTimestamp, JSON.stringify({ reason: "boom", errorCode: "RUNTIME_UNAVAILABLE" }));
  return runId;
}

describe("D20 trigger evaluation and review queue", () => {
  it("enqueues a firing for a matching failed run and starts the target on approval", async () => {
    const host = await makeHost();
    const target = await seedWorkflow(host, "remediate");
    const source = await seedWorkflow(host, "flaky");
    const rule = (await host.handleMethod("trigger.save", {
      rule: {
        name: "失败即修复",
        workflowId: target.workflowId,
        eventType: "run.failed",
        filterWorkflowId: source.workflowId,
      },
    })) as { id: string };
    await host.handleMethod("trigger.enable", { id: rule.id });

    const runId = seedFailedRun(host, source.workflowId, "2026-10-27T00:00:00.000Z");
    // Boot after the event: it is an ordinary ("event") firing, not missed.
    const result = evaluateTriggerRules(host.db, {
      bootAt: new Date("2026-10-26T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ enqueued: 1, missed: 0 });

    const listed = (await host.handleMethod("trigger.firing.list", {
      status: "pending",
    })) as {
      firings: Array<{ id: string; ruleName: string; sourceRunId: string | null; reason: string }>;
    };
    expect(listed.firings).toHaveLength(1);
    expect(listed.firings[0]).toMatchObject({
      ruleName: "失败即修复",
      sourceRunId: runId,
      reason: "event",
    });

    const decision = (await host.handleMethod("trigger.firing.decide", {
      firingId: listed.firings[0]!.id,
      decision: "start",
    })) as { firing: { status: string }; runId: string | null };
    expect(decision.firing.status).toBe("approved");
    expect(decision.runId).not.toBeNull();
    expect(isTriggerStartedRun(host.db, decision.runId!)).toBe(true);

    // The queue-started run failing again must not re-fire the rule: append
    // a terminal failure event to the run the queue itself started.
    host.db.raw
      .prepare(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, type, payload_json) " +
          "VALUES (?, ?, (SELECT COALESCE(MAX(sequence), -1) + 1 FROM events WHERE run_id = ?), ?, 'run.failed', ?);",
      )
      .run(
        randomUUID(),
        decision.runId!,
        decision.runId!,
        "2026-10-27T01:00:00.000Z",
        JSON.stringify({ reason: "boom again", errorCode: "RUNTIME_UNAVAILABLE" }),
      );
    const second = evaluateTriggerRules(host.db, {
      bootAt: new Date("2026-10-26T00:00:00.000Z"),
    });
    // The only new failed event belongs to a queue-started run → no firing.
    expect(second.enqueued).toBe(0);

    await expect(
      host.handleMethod("trigger.firing.decide", {
        firingId: listed.firings[0]!.id,
        decision: "dismiss",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("marks events older than this boot as missed and dismisses them", async () => {
    const host = await makeHost();
    const target = await seedWorkflow(host, "notify");
    await host.handleMethod("trigger.save", {
      rule: { name: "错过可见", workflowId: target.workflowId, eventType: "run.failed" },
    });
    await host.handleMethod("trigger.enable", {
      id: ((await host.handleMethod("trigger.list", {})) as { rules: Array<{ id: string }> })
        .rules[0]!.id,
    });
    seedFailedRun(host, target.workflowId, "2026-10-20T00:00:00.000Z");
    const result = evaluateTriggerRules(host.db, {
      bootAt: new Date("2026-10-26T00:00:00.000Z"),
    });
    expect(result.missed).toBe(1);
    const listed = (await host.handleMethod("trigger.firing.list", {})) as {
      firings: Array<{ id: string; reason: string; status: string }>;
    };
    expect(listed.firings[0]).toMatchObject({ reason: "missed", status: "pending" });
    const decision = (await host.handleMethod("trigger.firing.decide", {
      firingId: listed.firings[0]!.id,
      decision: "dismiss",
    })) as { firing: { status: string }; runId: string | null };
    expect(decision.firing.status).toBe("dismissed");
    expect(decision.runId).toBeNull();
  });

  it("rejects unknown workflows in rules and unknown firings in decisions", async () => {
    const host = await makeHost();
    await expect(
      host.handleMethod("trigger.save", {
        rule: { name: "ghost", workflowId: randomUUID(), eventType: "run.failed" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("trigger.firing.decide", {
        firingId: randomUUID(),
        decision: "start",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
