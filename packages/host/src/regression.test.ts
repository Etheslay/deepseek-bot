/**
 * D12 regression through the host method surface, fake-harness driven:
 * QA-05 (three bots, sequential + independent branch, tracked inputs/outputs)
 * and QA-09 (host crash → recovery → resume carrying succeeded work).
 * Real-API legs of these scenarios run in the key-dependent QA campaign.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { listNodeRuns } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

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
  const root = mkdtempSync(join(tmpdir(), "dsb-regression-"));
  roots.push(root);
  return root;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

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
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
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
        "VALUES (?, ?, 'p', ?, ?, ?);",
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

async function started(
  root: string,
  workspace: string,
  scenario: string,
): Promise<{ host: DeepSeekBotHost; refs: ReturnType<typeof seedRefs> }> {
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "test-key",
    dshBin: fakeHarness,
    childEnv: (env) => ({ ...env, FAKE_SCENARIO: scenario }),
  });
  hosts.push(host);
  return { host, refs: seedRefs(host.db, workspace) };
}

async function makeBot(host: DeepSeekBotHost, refs: ReturnType<typeof seedRefs>, name: string) {
  return (await host.handleMethod("bot.create", {
    name,
    instructions: "测试指令。",
    modelProfileId: refs.profileId,
    workspaceId: refs.workspaceId,
    toolPolicyId: refs.toolPolicyId,
  })) as { id: string; revision: string };
}

describe("D12 regression (fake harness, real orchestration)", () => {
  it("QA-05: three bots run sequentially and on independent branches with tracked outputs", async () => {
    const root = makeRoot();
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    const { host, refs } = await started(root, workspace, "ok");
    const botA = await makeBot(host, refs, "机器人甲");
    const botB = await makeBot(host, refs, "机器人乙");
    const botC = await makeBot(host, refs, "机器人丙");

    const workflow = (await host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "三机器人工作流",
        schemaVersion: "0.1",
        nodes: [
          { id: "n1", type: "bot", botId: botA.id, instructionTemplate: "第一步。", inputBindings: [], retryPolicy: { maxRetries: 0 } },
          { id: "n2", type: "bot", botId: botB.id, instructionTemplate: "基于 {{input.draft}} 继续。", inputBindings: [{ inputKey: "draft", required: true }], retryPolicy: { maxRetries: 0 } },
          { id: "n3", type: "bot", botId: botC.id, instructionTemplate: "独立分支。", inputBindings: [], retryPolicy: { maxRetries: 0 } },
        ],
        edges: [{ fromNodeId: "n1", outputKey: "response", toNodeId: "n2", inputKey: "draft" }],
        limits: { maxConcurrentNodes: 2 },
      },
    })) as { id: string; revision: string };

    const run = (await host.handleMethod("run.start", {
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
      idempotencyKey: randomUUID(),
    })) as { id: string };

    await waitFor(async () => {
      const current = (await host.handleMethod("run.get", { runId: run.id })) as { status: string };
      return current.status === "succeeded";
    });

    const nodeRuns = listNodeRuns(host.db, run.id);
    const byNode = new Map(nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
    expect(byNode.get("n1")?.status).toBe("succeeded");
    expect(byNode.get("n2")?.status).toBe("succeeded");
    expect(byNode.get("n3")?.status).toBe("succeeded");
    // Each bot ran in its own harness session, traceable on the node run.
    expect(byNode.get("n1")?.sessionId).toBeTruthy();
    expect(byNode.get("n2")?.sessionId).not.toBe(byNode.get("n1")?.sessionId);
  }, 60_000);

  it("QA-09: crash mid-run recovers to interrupted and resumes carrying finished work", async () => {
    const root = makeRoot();
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    const first = await started(root, workspace, "first-ok-then-hang");
    const bot = await makeBot(first.host, first.refs, "恢复机器人");
    const workflow = (await first.host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "两步工作流",
        schemaVersion: "0.1",
        nodes: [
          { id: "n1", type: "bot", botId: bot.id, instructionTemplate: "先做。", inputBindings: [], retryPolicy: { maxRetries: 0 } },
          { id: "n2", type: "bot", botId: bot.id, instructionTemplate: "后做。", inputBindings: [], retryPolicy: { maxRetries: 0 } },
        ],
        edges: [{ fromNodeId: "n1", outputKey: "response", toNodeId: "n2", inputKey: "draft" }],
        limits: { maxConcurrentNodes: 1 },
      },
    })) as { id: string; revision: string };
    const run = (await first.host.handleMethod("run.start", {
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
      idempotencyKey: randomUUID(),
    })) as { id: string };

    // Wait for n1 to finish and n2 to hang, then crash the host (db handle
    // closed under the live run — exactly the state a killed process leaves).
    await waitFor(() => {
      const nodeRuns = listNodeRuns(first.host.db, run.id);
      const n1 = nodeRuns.find((nodeRun) => nodeRun.nodeId === "n1");
      return n1?.status === "succeeded";
    });
    first.host.db.close();
    hosts.pop();

    // A fresh host on the same data root recovers the interrupted run.
    const second = await started(root, workspace, "ok");
    expect(second.host.recoveredRuns).toHaveLength(1);
    expect(second.host.recoveredRuns[0]?.runId).toBe(run.id);
    const recovered = (await second.host.handleMethod("run.get", { runId: run.id })) as {
      status: string;
    };
    expect(recovered.status).toBe("interrupted");

    // Resume through the method surface: succeeded n1 is carried, n2 runs.
    const resumed = (await second.host.handleMethod("run.resume", {
      runId: run.id,
    })) as { id: string; status: string; resumedFromRunId: string | null };
    expect(resumed.id).not.toBe(run.id);
    expect(resumed.resumedFromRunId).toBe(run.id);
    await waitFor(async () => {
      const current = (await second.host.handleMethod("run.get", { runId: resumed.id })) as {
        status: string;
      };
      return current.status === "succeeded";
    });
    const resumedNodeRuns = listNodeRuns(second.host.db, resumed.id);
    const n1 = resumedNodeRuns.find((nodeRun) => nodeRun.nodeId === "n1");
    expect(n1?.status).toBe("succeeded");
    expect(n1?.attempt).toBe(1);
  }, 90_000);
});
