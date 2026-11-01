import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MISFIRE_POLICY, WORKFLOW_SCHEMA_VERSION } from "@deepseek-bot/contracts";
import {
  DEFAULT_MODEL_PROFILE_ID,
  FLASH_MODEL_PROFILE_ID,
  REASONER_MODEL_PROFILE_ID,
  createHost,
  type DeepSeekBotHost,
} from "./host.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);

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

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-host-"));
  roots.push(root);
  return root;
}

/** Seed the profile/workspace/policy rows bot.create references (no contract
 * methods manage them yet — desktop setup seeds defaults). */
function seedRefs(db: DeepSeekBotHost["db"], workspacePath: string): {
  profileId: string;
  workspaceId: string;
  toolPolicyId: string;
} {
  const now = db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  const profileId = randomUUID();
  const workspaceId = randomUUID();
  const toolPolicyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'test', ?, ?);",
    )
    .run(ref, now, now);
  db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com/v1', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, workspacePath, now, now);
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) " +
        "VALUES (?, ?, 'host test policy', ?, ?, ?);",
    )
    .run(
      toolPolicyId,
      randomUUID(),
      JSON.stringify({
        filesystem: { enabled: false, operations: [] },
        shell: { mode: "disabled" },
        network: { mode: "disabled" },
        mcp: { enabled: false, requireApproval: false, servers: [] },
      }),
      now,
      now,
    );
  return { profileId, workspaceId, toolPolicyId };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

describe("createHost", () => {
  let root: string;
  let workspace: string;
  let refs: ReturnType<typeof seedRefs>;
  let host: DeepSeekBotHost;

  beforeEach(() => {
    root = makeRoot();
    workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
  });

  async function started(): Promise<DeepSeekBotHost> {
    const created = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
      dshBin: fakeHarness,
      childEnv: (env) => ({ ...env, FAKE_SCENARIO: "ok" }),
    });
    hosts.push(created);
    refs = seedRefs(created.db, workspace);
    host = created;
    return created;
  }

  it("seeds the built-in chat, reasoner, and vision model profiles idempotently (GAP_AUDIT G5; open-defects §2.1 plan 乙)", async () => {
    // Deliberately NOT via started(): that helper seeds extra test profiles,
    // and this case pins the exact built-in set.
    const first = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
      dshBin: fakeHarness,
      childEnv: (env) => ({ ...env, FAKE_SCENARIO: "ok" }),
    });
    hosts.push(first);
    host = first;
    const rows = first.db.raw
      .prepare("SELECT id, model, endpoint FROM model_profiles;")
      .all() as Array<{ id: string; model: string; endpoint: string }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(DEFAULT_MODEL_PROFILE_ID)).toMatchObject({
      model: "deepseek-chat",
      endpoint: "https://api.deepseek.com",
    });
    expect(byId.get(REASONER_MODEL_PROFILE_ID)).toMatchObject({
      model: "deepseek-reasoner",
      endpoint: "https://api.deepseek.com",
    });
    expect(byId.get(FLASH_MODEL_PROFILE_ID)).toMatchObject({
      model: "deepseek-flash",
      endpoint: "https://api.deepseek.com",
    });

    // Re-open the same data root: the seed runs again and INSERT OR IGNORE
    // must keep exactly one row per built-in profile.
    await first.shutdown();
    hosts.pop();
    const reopened = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
      dshBin: fakeHarness,
      childEnv: (env) => ({ ...env, FAKE_SCENARIO: "ok" }),
    });
    hosts.push(reopened);
    host = reopened;
    const reasonerRows = reopened.db.raw
      .prepare("SELECT id FROM model_profiles WHERE id = ?;")
      .all(REASONER_MODEL_PROFILE_ID) as Array<{ id: string }>;
    expect(reasonerRows).toHaveLength(1);
    const total = reopened.db.raw
      .prepare("SELECT COUNT(*) AS total FROM model_profiles;")
      .get() as { total: number };
    expect(total.total).toBe(3);
  });

  it("runs a workflow end to end through the method surface (fake harness)", async () => {
    await started();
    const bot = (await host.handleMethod(
      "bot.create",
      {
        name: "集成机器人",
        instructions: "测试指令。",
        modelProfileId: refs.profileId,
        workspaceId: refs.workspaceId,
        toolPolicyId: refs.toolPolicyId,
      },
      randomUUID(),
    )) as { id: string; revision: string };

    const workflow = (await host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "单节点工作流",
        schemaVersion: "0.1",
        nodes: [
          {
            id: "n1",
            type: "bot",
            botId: bot.id,
            instructionTemplate: "回复 OK。",
            inputBindings: [],
            retryPolicy: { maxRetries: 0 },
          },
        ],
        edges: [],
        limits: { maxConcurrentNodes: 1 },
      },
    })) as { id: string; revision: string };

    const run = (await host.handleMethod("run.start", {
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
      idempotencyKey: randomUUID(),
    })) as { id: string; status: string };

    await waitFor(async () => {
      const current = (await host.handleMethod("run.get", { runId: run.id })) as {
        status: string;
      };
      return current.status === "succeeded";
    });
    const finished = (await host.handleMethod("run.get", { runId: run.id })) as {
      status: string;
      finishedAt: string | null;
    };
    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).not.toBeNull();
    const usage = host.db.raw.prepare("SELECT bot_id, model, session_id, input_tokens, output_tokens, source FROM usage_events WHERE bot_id = ?").all(bot.id) as Array<{ bot_id: string; model: string | null; session_id: string; input_tokens: number; output_tokens: number; source: string }>;
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ bot_id: bot.id, model: null, source: "estimated" });
    expect(usage[0]?.session_id).toBeTruthy();
    expect(usage[0]?.input_tokens).toBeGreaterThan(0);
    expect(usage[0]?.output_tokens).toBeGreaterThan(0);

    const events = (await host.handleMethod("events.subscribe", {
      runId: run.id,
      afterSequence: 0,
    })) as { events: Array<{ type: string }>; snapshotRequired: boolean };
    expect(events.snapshotRequired).toBe(false);
    // The engine's log opens with the queued→running transition; the run row
    // itself arrives via run.start/run.get (run.created emission is a known
    // contract gap noted for the D12 report).
    expect(events.events.map((event) => event.type)).toContain("run.statusChanged");

    const listed = (await host.handleMethod("run.list", { limit: 10 })) as {
      runs: Array<{ id: string }>;
    };
    expect(listed.runs.map((entry) => entry.id)).toContain(run.id);

    // v0.12 read surface: the editor opens a saved document by id (workflow.list
    // only carries summaries) and the run monitor renders one frame instead of
    // joining the fixture service's separate lists.
    const fetched = (await host.handleMethod("workflow.get", { id: workflow.id })) as {
      id: string;
      revision: string;
      nodes: Array<{ id: string }>;
    };
    expect(fetched.id).toBe(workflow.id);
    expect(fetched.revision).toBe(workflow.revision);
    expect(fetched.nodes.map((node) => node.id)).toEqual(["n1"]);

    const snapshot = (await host.handleMethod("run.snapshot", { runId: run.id })) as {
      run: { id: string; status: string };
      nodeRuns: Array<{ nodeId: string; status: string }>;
      approvals: unknown[];
      artifacts: unknown[];
    };
    expect(snapshot.run).toMatchObject({ id: run.id, status: "succeeded" });
    expect(snapshot.nodeRuns.map((node) => node.nodeId)).toEqual(["n1"]);
    expect(snapshot.nodeRuns[0]?.status).toBe("succeeded");
    expect(snapshot.approvals).toEqual([]);
    expect(snapshot.artifacts).toEqual([]);

    const approvalInbox = (await host.handleMethod("approval.list", {
      runId: run.id,
      status: "pending",
    })) as { approvals: unknown[] };
    expect(approvalInbox.approvals).toEqual([]);

    await expect(host.handleMethod("workflow.get", { id: randomUUID() })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  }, 60_000);

  it("deduplicates bot.create by envelope requestId", async () => {
    await started();
    const requestId = randomUUID();
    const payload = {
      name: "去重机器人",
      instructions: "测试指令。",
      modelProfileId: refs.profileId,
      workspaceId: refs.workspaceId,
      toolPolicyId: refs.toolPolicyId,
    };
    const first = (await host.handleMethod("bot.create", payload, requestId)) as { id: string };
    const second = (await host.handleMethod("bot.create", payload, requestId)) as { id: string };
    expect(second.id).toBe(first.id);
  });

  it("rejects invalid payloads, stale revisions and unsupported templates", async () => {
    await started();
    const bot = (await host.handleMethod("bot.create", {
      name: "冲突机器人",
      instructions: "x",
      modelProfileId: refs.profileId,
      workspaceId: refs.workspaceId,
      toolPolicyId: refs.toolPolicyId,
    })) as { id: string; revision: string };

    await expect(
      host.handleMethod("bot.update", { id: bot.id, expectedRevision: randomUUID(), patch: { name: "新名" } }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    await expect(
      host.handleMethod("bot.create", { name: "" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    await expect(host.handleMethod("settings.testConnection", { modelProfile: {} })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    const imported = (await host.handleMethod("workflow.import", {
      template: {
        schemaVersion: "9.9",
        workflow: {
          name: "未来模板",
          schemaVersion: "9.9",
          nodes: [
            {
              id: "n1",
              type: "bot",
              botId: bot.id,
              instructionTemplate: "x",
              inputBindings: [],
              retryPolicy: { maxRetries: 0 },
            },
          ],
          edges: [],
          limits: { maxConcurrentNodes: 1 },
        },
      },
    })) as { accepted: boolean; errorCode?: string };
    expect(imported).toMatchObject({ accepted: false, errorCode: "DATA_VERSION_UNSUPPORTED" });
  });

  it("strips smuggled policy fields from workflow templates (G11' acceptance)", async () => {
    await started();
    const bot = (await host.handleMethod("bot.create", {
      name: "模板机器人",
      instructions: "x",
      modelProfileId: refs.profileId,
      workspaceId: refs.workspaceId,
      toolPolicyId: refs.toolPolicyId,
    })) as { id: string; toolPolicyId: string };

    // A tampered template tries to smuggle per-node permission grants through
    // both entry points. Each parses through the frozen schema, which strips
    // unknown keys — a workflow node keeps no policy of its own, so the
    // referenced bot's CURRENT toolPolicyId governs at run time.
    const smuggle = {
      toolPolicyId: randomUUID(),
      permissions: { shell: "allow" },
      allowedTools: ["exec.shell"],
    };
    const node = () => ({
      id: "n1",
      type: "bot",
      botId: bot.id,
      instructionTemplate: "x",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
      ...smuggle,
    });

    const imported = (await host.handleMethod("workflow.import", {
      template: {
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        workflow: {
          name: "越权模板",
          schemaVersion: WORKFLOW_SCHEMA_VERSION,
          nodes: [node()],
          edges: [],
          limits: { maxConcurrentNodes: 1 },
        },
      },
    })) as { accepted: boolean };
    expect(imported.accepted).toBe(true);

    const saved = (await host.handleMethod("workflow.save", {
      workflow: {
        name: "越权草稿",
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        nodes: [node()],
        edges: [],
        limits: { maxConcurrentNodes: 1 },
      },
    })) as { id: string; nodes: Array<Record<string, unknown>> };
    expect(saved.nodes[0]).toBeDefined();
    expect(saved.nodes[0]).not.toHaveProperty("toolPolicyId");
    expect(saved.nodes[0]).not.toHaveProperty("permissions");
    expect(saved.nodes[0]).not.toHaveProperty("allowedTools");

    const listed = (await host.handleMethod("workflow.list", {})) as {
      workflows: Array<{ id: string; name: string; revision: string }>;
    };
    const fromTemplate = listed.workflows.find((entry) => entry.name === "越权模板");
    expect(fromTemplate).toBeDefined();
    const exported = (await host.handleMethod("workflow.export", {
      id: fromTemplate?.id ?? "",
      expectedRevision: fromTemplate?.revision ?? "",
    })) as { workflow: { nodes: Array<Record<string, unknown>> } };
    expect(exported.workflow.nodes[0]).not.toHaveProperty("toolPolicyId");
    expect(exported.workflow.nodes[0]).not.toHaveProperty("permissions");
    expect(exported.workflow.nodes[0]).not.toHaveProperty("allowedTools");

    // The bot's own policy is untouched and remains the only authority.
    expect(bot.toolPolicyId).toBe(refs.toolPolicyId);
  });

  it("schedules, describes and backs up through the method surface", async () => {
    await started();
    const bot = (await host.handleMethod("bot.create", {
      name: "调度机器人",
      instructions: "x",
      modelProfileId: refs.profileId,
      workspaceId: refs.workspaceId,
      toolPolicyId: refs.toolPolicyId,
    })) as { id: string };
    const workflow = (await host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "调度工作流",
        schemaVersion: "0.1",
        nodes: [
          {
            id: "n1",
            type: "bot",
            botId: bot.id,
            instructionTemplate: "x",
            inputBindings: [],
            retryPolicy: { maxRetries: 0 },
          },
        ],
        edges: [],
        limits: { maxConcurrentNodes: 1 },
      },
    })) as { id: string };

    const scheduleId = randomUUID();
    const schedule = (await host.handleMethod("schedule.save", {
      schedule: {
        id: scheduleId,
        workflowId: workflow.id,
        timezone: "Asia/Shanghai",
        recurrence: "*/5 * * * *",
        enabled: true,
        misfirePolicy: MISFIRE_POLICY,
      },
    })) as { id: string; nextRunAt: string | null; enabled: boolean };
    expect(schedule.id).toBe(scheduleId);
    expect(schedule.enabled).toBe(true);
    // Enabled schedules get their next occurrence computed on save (D10).
    expect(schedule.nextRunAt).not.toBeNull();

    // Disabled schedules (no id minted client-side) persist with nextRunAt null.
    const plain = (await host.handleMethod("schedule.save", {
      schedule: {
        workflowId: workflow.id,
        timezone: "Asia/Shanghai",
        recurrence: "*/5 * * * *",
        enabled: false,
        misfirePolicy: MISFIRE_POLICY,
      },
    })) as { id: string; nextRunAt: string | null; enabled: boolean };
    expect(plain.id).not.toBe(scheduleId);
    expect(plain.nextRunAt).toBeNull();
    expect(plain.enabled).toBe(false);

    const enabled = (await host.handleMethod("schedule.enable", {
      id: schedule.id,
      expectedRevision: randomUUID(),
    })) as unknown as { id: string };
    expect(enabled.id).toBe(schedule.id);
    const disabled = (await host.handleMethod("schedule.disable", {
      id: schedule.id,
      expectedRevision: randomUUID(),
    })) as unknown as { id: string };
    expect(disabled.id).toBe(schedule.id);

    const described = (await host.handleMethod("data.describe", {})) as {
      schemaVersion: string;
      counts: Record<string, number>;
    };
    expect(described.schemaVersion).toBe(String(host.db.schemaVersion));
    expect(described.counts.schedules).toBe(2);

    const backup = (await host.handleMethod("data.backup", {})) as {
      backupId: string;
      sizeBytes: number;
    };
    expect(backup.sizeBytes).toBeGreaterThan(0);

    // The scheduler tick loop starts and stops cleanly (30s default cadence —
    // no tick fires inside the test).
    host.start();
    host.scheduler.stop();
  });

  it("covers validation, export, cancel, retry, approvals, settings and restore edges", async () => {
    await started();
    const bot = (await host.handleMethod("bot.create", {
      name: "覆盖机器人",
      instructions: "x",
      modelProfileId: refs.profileId,
      workspaceId: refs.workspaceId,
      toolPolicyId: refs.toolPolicyId,
    })) as { id: string; revision: string };
    const node = {
      id: "n1",
      type: "bot",
      botId: bot.id,
      instructionTemplate: "x",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    };
    const workflow = (await host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "覆盖工作流",
        schemaVersion: "0.1",
        nodes: [node],
        edges: [],
        limits: { maxConcurrentNodes: 1 },
      },
    })) as { id: string; revision: string };

    // workflow.validate: cycle detection through the method surface
    const cycle = (await host.handleMethod("workflow.validate", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "环",
        schemaVersion: "0.1",
        nodes: [
          node,
          { ...node, id: "n2", botId: bot.id },
        ],
        edges: [
          { fromNodeId: "n1", outputKey: "response", toNodeId: "n2", inputKey: "topic" },
          { fromNodeId: "n2", outputKey: "response", toNodeId: "n1", inputKey: "topic" },
        ],
        limits: { maxConcurrentNodes: 1 },
      },
    })) as { valid: boolean; errors: Array<{ code?: string }> };
    expect(cycle.valid).toBe(false);
    expect(cycle.errors.length).toBeGreaterThan(0);

    // workflow.export: happy path and revision conflict
    const exported = (await host.handleMethod("workflow.export", {
      id: workflow.id,
      expectedRevision: workflow.revision,
    })) as { workflow: { id: string }; exportedAt: string };
    expect(exported.workflow.id).toBe(workflow.id);
    expect(exported.exportedAt).toBeTruthy();
    await expect(
      host.handleMethod("workflow.export", { id: workflow.id, expectedRevision: randomUUID() }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    // run.cancel on a run that never started executing: cancelled cleanly
    const run = (await host.handleMethod("run.start", {
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
      idempotencyKey: randomUUID(),
    })) as { id: string };
    await waitFor(async () => {
      const current = (await host.handleMethod("run.get", { runId: run.id })) as {
        status: string;
      };
      return current.status !== "queued" && current.status !== "running";
    });
    const cancelled = (await host.handleMethod("run.cancel", { runId: run.id })) as {
      id: string;
      status: string;
    };
    expect(cancelled.id).toBe(run.id);
    expect(["succeeded", "cancelled", "failed"]).toContain(cancelled.status);

    // run.retryNode / approval.decide: unknown ids fail classified
    await expect(
      host.handleMethod("run.retryNode", { nodeRunId: randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("approval.decide", {
        approvalId: randomUUID(),
        decision: "approved",
        expectedActionDigest: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // settings.update persists raw settings
    await host.handleMethod("settings.update", { patch: { "ui.theme": "dark" } });
    expect(
      host.db.raw.prepare("SELECT value_json FROM settings WHERE key = 'ui.theme';").get(),
    ).toMatchObject({ value_json: '"dark"' });

    // data.restore with an unknown backup id fails classified
    await expect(
      host.handleMethod("data.restore", { backupId: randomUUID() }),
    ).rejects.toThrow();
  });

  it("assembles with every option supplied", async () => {
    const created = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "key",
      dshBin: fakeHarness,
      childEnv: (env) => ({ ...env, FAKE_SCENARIO: "ok" }),
      provider: "deepseek-official",
      now: () => new Date(),
      scheduler: { tickIntervalMs: 60_000, misfireGraceMs: 120_000 },
      onMissed: () => undefined,
    });
    hosts.push(created);
    expect(created.bridge.url.startsWith("http://127.0.0.1:")).toBe(true);
    expect(created.bridge.token.startsWith("dsb-")).toBe(true);
    expect(created.bootGeneration).toBeGreaterThan(0);
    expect(created.recoveredRuns).toEqual([]);
    const bots = (await created.handleMethod("bot.list", {})) as { bots: unknown[] };
    expect(bots.bots).toEqual([]);
    await created.shutdown();
    hosts.pop();
  });

  it("throws a classified error after shutdown", async () => {
    const created = await started();
    await created.shutdown();
    hosts.pop();
    await expect(created.handleMethod("bot.list", {})).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  });
});
