/**
 * Real DeepSeek API smoke (QA-05 real leg) + QA-06 auth classification.
 *
 * QA-05 runs ONLY when DEEPSEEK_API_KEY is present in the environment
 * (TESTING.md §1: 真实冒烟独立运行、显式配置 Key/预算，不进常规 CI)。The key is
 * injected per attempt through the host's resolveApiKey; it is never logged,
 * persisted or embedded here. Budget: ~3 deepseek-chat turns per invocation.
 *
 * QA-06 is fake-wire driven (no API cost): the "turn-error" fake scenario
 * replays the exact 401 turn/end shape captured from a real bad-credential
 * run (2026-10-25: turn/end reason.kind "error" with code AUTH / status 401 —
 * the agent still settles to idle afterwards, so the adapter must classify
 * turn errors or the run would report success with an empty response).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { listNodeRuns } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

const REAL_KEY = process.env["DEEPSEEK_API_KEY"];
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

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
}

function seedRefs(
  db: DeepSeekBotHost["db"],
  workspacePath: string,
  credentialRef: string,
): { profileId: string; workspaceId: string; toolPolicyId: string } {
  const now = db.now().toISOString();
  const profileId = randomUUID();
  const workspaceId = randomUUID();
  const toolPolicyId = randomUUID();
  db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'smoke', ?, ?);")
    .run(credentialRef, now, now);
  db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com/v1', ?, '{\"maxTokens\":512}', ?, ?);",
    )
    .run(profileId, credentialRef, now, now);
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, workspacePath, now, now);
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) " +
        "VALUES (?, ?, 'smoke', ?, ?, ?);",
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

describe.skipIf(REAL_KEY === undefined)("real API smoke", () => {
  it("QA-05 real: three bots run sequentially and independently through the real harness", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-real-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    const realRef = `cred:${randomUUID()}`;
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async (ref) => {
        if (ref === realRef) {
          if (REAL_KEY === undefined) throw new Error("unreachable");
          return REAL_KEY;
        }
        throw new Error("unknown credential ref");
      },
    });
    hosts.push(host);
    const refs = seedRefs(host.db, workspace, realRef);

    const makeBot = async (name: string, instructions: string) =>
      (await host.handleMethod("bot.create", {
        name,
        instructions,
        modelProfileId: refs.profileId,
        workspaceId: refs.workspaceId,
        toolPolicyId: refs.toolPolicyId,
      })) as { id: string };

    const botA = await makeBot("真机机器人甲", "你只回复文本，不使用任何工具。");
    const botB = await makeBot("真机机器人乙", "你只回复文本，不使用任何工具。");
    const botC = await makeBot("真机机器人丙", "你只回复文本，不使用任何工具。");

    const workflow = (await host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "真机三机器人工作流",
        schemaVersion: "0.1",
        nodes: [
          {
            id: "n1",
            type: "bot",
            botId: botA.id,
            instructionTemplate: "用一句不超过二十字的中文介绍本地调度。",
            inputBindings: [],
            retryPolicy: { maxRetries: 0 },
          },
          {
            id: "n2",
            type: "bot",
            botId: botB.id,
            instructionTemplate: "把下面这段话翻译成英文，只输出译文：{{input.draft}}",
            inputBindings: [{ inputKey: "draft", required: true }],
            retryPolicy: { maxRetries: 0 },
          },
          {
            id: "n3",
            type: "bot",
            botId: botC.id,
            instructionTemplate: "回复数字 42，不要输出其他内容。",
            inputBindings: [],
            retryPolicy: { maxRetries: 0 },
          },
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
      const current = (await host.handleMethod("run.get", { runId: run.id })) as {
        status: string;
      };
      return current.status === "succeeded";
    });

    const nodeRuns = listNodeRuns(host.db, run.id);
    const byNode = new Map(nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
    for (const nodeId of ["n1", "n2", "n3"]) {
      expect(byNode.get(nodeId)?.status, nodeId).toBe("succeeded");
      expect(byNode.get(nodeId)?.sessionId, nodeId).toBeTruthy();
    }
    // Distinct real harness sessions per node.
    expect(byNode.get("n1")?.sessionId).not.toBe(byNode.get("n2")?.sessionId);
    expect(byNode.get("n2")?.sessionId).not.toBe(byNode.get("n3")?.sessionId);
  }, 300_000);
});

describe("QA-06 auth classification (fake wire, real 401 shape)", () => {
  it("fails the node as AUTH_FAILED when the turn ends with a provider error", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-auth-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "ignored-by-fake",
      dshBin: fakeHarness,
      childEnv: (env) => ({ ...env, FAKE_SCENARIO: "turn-error" }),
    });
    hosts.push(host);
    const refs = seedRefs(host.db, workspace, `cred:${randomUUID()}`);
    const bot = (await host.handleMethod("bot.create", {
      name: "坏凭据机器人",
      instructions: "只回复文本。",
      modelProfileId: refs.profileId,
      workspaceId: refs.workspaceId,
      toolPolicyId: refs.toolPolicyId,
    })) as { id: string };
    const workflow = (await host.handleMethod("workflow.save", {
      workflow: {
        id: randomUUID(),
        revision: randomUUID(),
        name: "坏凭据工作流",
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
    })) as { id: string };

    await waitFor(async () => {
      const current = (await host.handleMethod("run.get", { runId: run.id })) as {
        status: string;
      };
      return current.status === "failed" || current.status === "succeeded";
    });

    const runStatus = (await host.handleMethod("run.get", { runId: run.id })) as {
      status: string;
    };
    expect(runStatus.status).toBe("failed");
    const events = (await host.handleMethod("events.subscribe", {
      runId: run.id,
      afterSequence: 0,
    })) as {
      events: Array<{ type: string; payload: { to?: string; reason?: string } }>;
    };
    const failureEvent = events.events.find(
      (event) => event.type === "node.statusChanged" && event.payload.to === "failed",
    );
    expect(failureEvent?.payload.reason).toContain("AUTH_FAILED");
    // Non-retryable classification: exactly one attempt, no retry loop.
    const attempts = listNodeRuns(host.db, run.id).filter(
      (nodeRun) => nodeRun.nodeId === "n1",
    );
    expect(attempts).toHaveLength(1);
  });
});
