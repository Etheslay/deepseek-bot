/**
 * v0.5 manager orchestration host tests (TASK_MANAGER_ORCHESTRATION.md §5):
 * U1 role rules, U3 queue + cancel, U4 restart sweep, U5 approval wiring,
 * U6 save_workflow, U7 dual-identity audit, U8–U12 relay chains (T7).
 * The chat turns run against the fake harness (FAKE_SCENARIO per host).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval, Task } from "@deepseek-bot/contracts";
import { createBot, getBot, insertTask, listChatMessages, listTasks, listWorkflows } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);
const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

// Shutdown used to run once in afterAll, one host after another. This file
// keeps a host per test (about twenty, including restart boots). On the
// Windows CI runner that sequence did not finish inside Vitest's 10s hook
// budget, so the hook timed out inside host.shutdown() after every test had
// already passed. Close the hosts as each test ends — one or two, and the
// ones a test already closed return immediately — then delete the temp
// roots after the processes have released them.
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.shutdown().catch(() => undefined)));
}, 20_000);

afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface GroupFixture {
  host: DeepSeekBotHost;
  coordinator: string;
  workerA: string;
  workerB: string;
  outsider: string;
}

async function hostWithGroup(
  scenario = "ok",
  hostOptions: Partial<Parameters<typeof createHost>[0]> = {},
): Promise<GroupFixture> {
  const root = mkdtempSync(join(tmpdir(), "dsb-dispatch-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, FAKE_SCENARIO: scenario }),
    ...hostOptions,
  });
  hosts.push(host);
  const now = host.db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  host.db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const profileId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  const workspaceId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, join(root, "ws"), now, now);
  mkdirSync(join(root, "ws"), { recursive: true });
  const policyId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(
      policyId,
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
  const groupA = randomUUID();
  const groupB = randomUUID();
  host.db.raw
    .prepare("INSERT INTO bot_groups (id, revision, name, archived_at, created_at, updated_at) VALUES (?, ?, 'team a', NULL, ?, ?);")
    .run(groupA, randomUUID(), now, now);
  host.db.raw
    .prepare("INSERT INTO bot_groups (id, revision, name, archived_at, created_at, updated_at) VALUES (?, ?, 'team b', NULL, ?, ?);")
    .run(groupB, randomUUID(), now, now);
  const seed = (name: string, groupId: string, role: "standard" | "coordinator"): string =>
    createBot(host.db, {
      bot: {
        id: randomUUID(),
        revision: randomUUID(),
        name,
        instructions: "be brief",
        modelProfileId: profileId,
        workspaceId,
        toolPolicyId: policyId,
        groupId,
        role,
        archivedAt: null,
      },
    }).bot.id;
  if (scenario === "app-tool") {
    // The fake harness calls create_group. That capability defaults to allow;
    // these tests still need the executor's own approval card.
    await host.handleMethod("permission.policy.set", {
      capability: "app.create_group",
      mode: "ask",
    });
  }
  return {
    host,
    coordinator: seed("manager", groupA, "coordinator"),
    workerA: seed("writer", groupA, "standard"),
    workerB: seed("coder", groupA, "standard"),
    outsider: seed("lurker", groupB, "standard"),
  };
}

async function allowPolicy(host: DeepSeekBotHost, capability: "app.dispatch_task" | "app.create_workflow" | "app.create_group"): Promise<void> {
  await host.handleMethod("permission.policy.set", { capability, mode: "allow" });
}

async function taskOf(host: DeepSeekBotHost, taskId: string): Promise<Task> {
  const tasks = (await host.handleMethod("task.list", { limit: 100 })) as { tasks: Task[] };
  const task = tasks.tasks.find((row) => row.id === taskId);
  if (task === undefined) throw new Error(`task ${taskId} not listed`);
  return task;
}

async function waitForTask(
  host: DeepSeekBotHost,
  taskId: string,
  status: Task["status"],
): Promise<Task> {
  let task: Task | undefined;
  await vi.waitFor(
    async () => {
      task = await taskOf(host, taskId);
      expect(task.status).toBe(status);
    },
    // The executor runs a whole fake-harness turn per hop; the 1s default
    // poll budget starves whenever the suite runs alongside other
    // harness children, so poll on a deadline instead.
    { timeout: 20_000, interval: 100 },
  );
  return task!;
}

describe("U1 interop identity rules (TASK_BOT_INTEROP.md)", () => {
  it("allows standard bots and cross-group targets; still rejects self and untrusted callers", async () => {
    const fx = await hostWithGroup();
    await allowPolicy(fx.host, "app.dispatch_task");

    // A standard bot dispatches without any coordinator role — interop makes
    // every bot equal (the gateway explains; the UI never hides this).
    const fromWorker = (await fx.host.agentTools.call(
      { id: `chat:${fx.workerA}`, botId: fx.workerA, sessionId: `chat:${fx.workerA}` },
      "dispatch_task",
      { toBotId: fx.workerB, task: "worker 直接派活" },
    )) as Task;
    expect(fromWorker.status).toBe("queued");

    // Cross-group targets are allowed: the coordinator names the outsider.
    const crossGroup = (await fx.host.agentTools.call(
      { id: `chat:${fx.coordinator}`, botId: fx.coordinator, sessionId: `chat:${fx.coordinator}` },
      "dispatch_task",
      { toBotId: fx.outsider, task: "跨组协作" },
    )) as Task;
    expect(crossGroup.toBotId).toBe(fx.outsider);

    // Self-dispatch is refused at the tool layer.
    await expect(
      fx.host.agentTools.call(
        { id: `chat:${fx.coordinator}`, botId: fx.coordinator, sessionId: `chat:${fx.coordinator}` },
        "dispatch_task",
        { toBotId: fx.coordinator, task: "自己派给自己" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // A caller without a trusted botId never reaches the rules at all.
    await expect(
      fx.host.agentTools.call({ id: "ui:some-window" }, "dispatch_task", {
        toBotId: fx.workerA,
        task: "无身份调用",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });

    // The authoritative method surface enforces the same identity rules.
    const viaMethod = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.workerA,
      toBotId: fx.outsider,
      task: "standard 跨组派发",
    })) as Task;
    expect(viaMethod.toBotId).toBe(fx.outsider);
  });

  it("still refuses archived senders and archived targets", async () => {
    const fx = await hostWithGroup();
    await allowPolicy(fx.host, "app.dispatch_task");
    const bot = getBot(fx.host.db, fx.workerB)!;
    await fx.host.handleMethod("bot.archive", {
      id: bot.id,
      expectedRevision: bot.revision,
    });
    await expect(
      fx.host.agentTools.call(
        { id: `chat:${fx.coordinator}`, botId: fx.coordinator, sessionId: `chat:${fx.coordinator}` },
        "dispatch_task",
        { toBotId: fx.workerB, task: "发给已归档" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The archived bot itself cannot dispatch either.
    await expect(
      fx.host.agentTools.call(
        { id: `chat:${fx.workerB}`, botId: fx.workerB, sessionId: `chat:${fx.workerB}` },
        "dispatch_task",
        { toBotId: fx.workerA, task: "已归档者派发" },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });
});

describe("dispatch idempotency (TASK_BOT_INTEROP.md)", () => {
  it("replays the first task for the same idempotencyKey instead of queueing twice", async () => {
    const fx = await hostWithGroup();
    await allowPolicy(fx.host, "app.dispatch_task");
    const key = randomUUID();

    const first = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "只做一次",
      idempotencyKey: key,
    })) as Task;
    await waitForTask(fx.host, first.id, "done");

    // A retry with the same key — even with a different instruction text —
    // replays the first task (first write wins).
    const retry = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "重试同一条",
      idempotencyKey: key,
    })) as Task;
    expect(retry.id).toBe(first.id);

    // Another sender using the same key is NOT deduped against someone
    // else's task; a fresh key creates a fresh task.
    const otherSender = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.workerA,
      toBotId: fx.workerB,
      task: "worker 的任务",
      idempotencyKey: key,
    })) as Task;
    expect(otherSender.id).not.toBe(first.id);

    // Exactly one dispatch marker and one task row for the deduped sender.
    const history = listChatMessages(fx.host.db, fx.workerA, 20);
    const markers = history.filter((row) => row.meta?.kind === "dispatch");
    expect(markers).toHaveLength(1);
    expect(markers[0]!.text.includes("只做一次")).toBe(true);
    expect(history.filter((row) => row.meta?.kind === "dispatch_reply")).toHaveLength(1);
    const all = listTasks(fx.host.db, { limit: 100 });
    expect(all.filter((row) => row.fromBotId === fx.coordinator)).toHaveLength(1);
  });

  it("keeps plain behavior when no idempotencyKey is sent", async () => {
    const fx = await hostWithGroup();
    await allowPolicy(fx.host, "app.dispatch_task");
    const first = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "第一次",
    })) as Task;
    const second = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "第一次",
    })) as Task;
    expect(second.id).not.toBe(first.id);
    await waitForTask(fx.host, second.id, "done");
  });
});

describe("U3 queue and cancel", () => {
  it("serializes two dispatches to one busy executor", async () => {
    const fx = await hostWithGroup("ok");
    const first = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "第一件",
    })) as Task;
    const second = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "第二件",
    })) as Task;
    const doneFirst = await waitForTask(fx.host, first.id, "done");
    const doneSecond = await waitForTask(fx.host, second.id, "done");
    expect(doneSecond.startedAt === null || doneFirst.finishedAt === null || doneSecond.startedAt >= doneFirst.finishedAt!).toBe(true);
    // The executor session keeps the two marked instructions in order.
    const history = listChatMessages(fx.host.db, fx.workerA, 20);
    const markers = history.filter((row) => row.meta?.kind === "dispatch");
    expect(markers.map((row) => row.text)).toHaveLength(2);
    expect(markers[0]!.text.includes("第一件")).toBe(true);
    expect(markers[1]!.text.includes("第二件")).toBe(true);
  });

  it("cancels a queued task directly and a running task via chat.cancel", async () => {
    const fx = await hostWithGroup("hang");
    const first = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "会卡住",
    })) as Task;
    const second = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "排队中",
    })) as Task;
    await waitForTask(fx.host, first.id, "running");
    await waitForTask(fx.host, second.id, "queued");
    const cancelledQueued = (await fx.host.handleMethod("task.cancel", {
      taskId: second.id,
    })) as Task;
    expect(cancelledQueued.status).toBe("cancelled");
    // A running cancel is asynchronous: the method acknowledges and the
    // pump settles the row when the aborted turn comes back.
    await fx.host.handleMethod("task.cancel", { taskId: first.id });
    await waitForTask(fx.host, first.id, "cancelled");
  });
});

describe("U4 restart sweep (FR-10)", () => {
  it("marks queued and running tasks interrupted on the next boot", async () => {
    const fx = await hostWithGroup("ok");
    insertTask(fx.host.db, {
      id: randomUUID(),
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      instruction: "重启前排队",
      rootTaskId: randomUUID(),
      chainIndex: 0,
      chainTotal: 1,
    });
    const runningId = randomUUID();
    const running = insertTask(fx.host.db, {
      id: runningId,
      fromBotId: fx.coordinator,
      toBotId: fx.workerB,
      instruction: "重启前执行中",
      rootTaskId: runningId,
      chainIndex: 0,
      chainTotal: 1,
    });
    // Force it into running the way the dispatcher would.
    const { markTaskRunning } = await import("@deepseek-bot/storage");
    markTaskRunning(fx.host.db, running.id);
    const root = fx.host.layout.root;
    await fx.host.shutdown();

    const restarted = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "sk-test-only",
      dshBin: fakeHarness,
    });
    hosts.push(restarted);
    expect(restarted.interruptedTasks).toBe(2);
    const interrupted = (await restarted.handleMethod("task.list", {
      status: "interrupted",
    })) as { tasks: Task[] };
    expect(interrupted.tasks).toHaveLength(2);
  });
});

describe("U5 approval wiring for app.dispatch_task", () => {
  it("asks by default, shows exact params, and honors deny policies", async () => {
    const fx = await hostWithGroup();
    const pendingCall = fx.host.agentTools.call(
      { id: `chat:${fx.coordinator}`, botId: fx.coordinator, sessionId: `chat:${fx.coordinator}` },
      "dispatch_task",
      { toBotId: fx.workerA, task: "写本周选题清单" },
    );
    let approval: AppApproval | undefined;
    await vi.waitFor(
      async () => {
        const list = (await fx.host.handleMethod("permission.approval.list", {
          botId: fx.coordinator,
        })) as { approvals: AppApproval[] };
        approval = list.approvals[0];
        expect(approval).toBeDefined();
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(approval!.capabilities).toEqual(["app.dispatch_task"]);
    expect(approval!.params).toEqual({ toBotId: fx.workerA, task: "写本周选题清单" });
    await fx.host.handleMethod("permission.approval.decide", {
      approvalId: approval!.id,
      expectedActionDigest: approval!.actionDigest,
      decision: "approved",
      scope: "once",
    });
    const task = (await pendingCall) as Task;
    expect(task.status).toBe("queued");
    await waitForTask(fx.host, task.id, "done");

    // A deny policy wins over everything the model tries afterwards.
    await fx.host.handleMethod("permission.policy.set", {
      capability: "app.dispatch_task",
      mode: "deny",
    });
    await expect(
      fx.host.agentTools.call(
        { id: `chat:${fx.coordinator}`, botId: fx.coordinator, sessionId: `chat:${fx.coordinator}` },
        "dispatch_task",
        { toBotId: fx.workerA, task: "deny 后再试" },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });
});

describe("U6 save_workflow tool (T4)", () => {
  it("U6: never persists a semantically invalid draft and saves valid ones into the editor catalog", async () => {
    const fx = await hostWithGroup();
    await allowPolicy(fx.host, "app.create_workflow");
    const caller = { id: `chat:${fx.coordinator}`, botId: fx.coordinator, sessionId: `chat:${fx.coordinator}` };
    const botNode = { id: "n1", type: "bot" as const, botId: fx.workerA, instructionTemplate: "出稿", inputBindings: [], retryPolicy: { maxRetries: 0 } };
    // Schema-valid shape, but the edge references a node that does not
    // exist — semantic validation must reject it before any save.
    const invalid = (await fx.host.agentTools.call(caller, "save_workflow", {
      name: "坏草稿",
      schemaVersion: "0.1",
      nodes: [botNode],
      edges: [{ fromNodeId: "ghost", outputKey: "out", toNodeId: "n1", inputKey: "in" }],
    })) as { saved: boolean };
    expect(invalid.saved).toBe(false);
    // The D07 editor catalog reads the same storage the host saved to; the
    // host has no workflow.list method (that surface lives in the desktop
    // service), so the assertion goes through storage directly.
    expect(listWorkflows(fx.host.db)).toHaveLength(0);

    const saved = (await fx.host.agentTools.call(caller, "save_workflow", {
      name: "内容流水线",
      schemaVersion: "0.1",
      nodes: [botNode],
      edges: [],
    })) as { saved: boolean; workflow: { id: string } };
    expect(saved.saved).toBe(true);
    const workflows = listWorkflows(fx.host.db);
    expect(workflows.map((wf) => wf.id)).toContain(saved.workflow.id);
  });
});

describe("U7 dual-identity audit (FR-5)", () => {
  it("records the coordinator on the dispatch and the executor on its own tool call", async () => {
    const fx = await hostWithGroup("app-tool");
    await allowPolicy(fx.host, "app.dispatch_task");
    const dispatched = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "触发一次回合",
    })) as Task;
    // The executor's own in-turn create_group still needs its own approval —
    // dispatching never borrows the coordinator's authorization.
    let approval: AppApproval | undefined;
    await vi.waitFor(
      async () => {
        const list = (await fx.host.handleMethod("permission.approval.list", {
          botId: fx.workerA,
        })) as { approvals: AppApproval[] };
        approval = list.approvals[0];
        expect(approval).toBeDefined();
      },
      { timeout: 20_000, interval: 100 },
    );
    await fx.host.handleMethod("permission.approval.decide", {
      approvalId: approval!.id,
      expectedActionDigest: approval!.actionDigest,
      decision: "approved",
      scope: "once",
    });
    await waitForTask(fx.host, dispatched.id, "done");

    const auditText = readFileSync(
      join(fx.host.layout.logs, "agent-tools-audit.jsonl"),
      "utf8",
    );
    const records = auditText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { tool: string; botId?: string; outcome: string });
    const dispatchRecords = records.filter((record) => record.tool === "dispatch_task");
    expect(dispatchRecords.length).toBeGreaterThanOrEqual(1);
    expect(dispatchRecords.every((record) => record.botId === fx.coordinator)).toBe(true);
    const executorRecords = records.filter((record) => record.tool === "create_group");
    expect(executorRecords.length).toBeGreaterThanOrEqual(1);
    expect(executorRecords.every((record) => record.botId === fx.workerA)).toBe(true);
  });
});

describe("T7 relay chains (U8–U11)", () => {
  it("U8: rejects duplicate-botId and over-limit chains; cross-group chains pass", async () => {
    const fx = await hostWithGroup();
    // A cross-group hop is allowed (interop): coordinator → workerA → outsider.
    const crossChain = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "跨组接力",
      chain: [{ botId: fx.outsider, instruction: "越组一步" }],
    })) as Task;
    expect(crossChain.chainTotal).toBe(2);
    await waitForTask(fx.host, crossChain.id, "done");
    await expect(
      fx.host.handleMethod("task.dispatch", {
        fromBotId: fx.coordinator,
        toBotId: fx.workerA,
        task: "重复跳",
        chain: [
          { botId: fx.workerB, instruction: "第二步" },
          { botId: fx.workerB, instruction: "重复 botId" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      fx.host.handleMethod("task.dispatch", {
        fromBotId: fx.coordinator,
        toBotId: fx.workerA,
        task: "超长链",
        chain: [
          { botId: fx.workerB, instruction: "二" },
          { botId: fx.outsider, instruction: "三" },
          { botId: fx.workerA, instruction: "四" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("U9: runs a two-hop relay and injects the upstream handoff summary", async () => {
    const fx = await hostWithGroup("echo-model");
    const root = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "设计首页草图",
      chain: [{ botId: fx.workerB, instruction: "按设计稿编码" }],
    })) as Task;
    expect(root.chainTotal).toBe(2);
    await waitForTask(fx.host, root.id, "done");
    const hop2 = (await waitForTask(fx.host, (
      (await fx.host.handleMethod("task.list", { rootTaskId: root.id })) as { tasks: Task[] }
    ).tasks.find((task) => task.chainIndex === 1)!.id, "done"));
    expect(hop2.fromBotId).toBe(fx.workerA);
    expect(hop2.rootTaskId).toBe(root.id);

    // The coder's session shows "来自 manager 的派发"? No — hop 2 was sent by
    // the writer, so the marker names the writer as sender.
    const coderHistory = listChatMessages(fx.host.db, fx.workerB, 20);
    const marker = coderHistory.find((row) => row.meta?.kind === "dispatch");
    expect(marker?.meta).toMatchObject({ kind: "dispatch", fromBotId: fx.workerA, taskId: hop2.id });
    expect(marker?.text).toContain("【上游交接 · 目标】设计首页草图");
    expect(marker?.text).toContain("按设计稿编码");
    // The writer's own result flowed into the coder's prompt via the echo.
    const writerTask = await taskOf(fx.host, root.id);
    expect(hop2.resultSummary).toContain(writerTask.resultSummary ?? "无法回放");
  });

  it("U10: a deny policy before hop 2 leaves the remaining hop skipped with a notice", async () => {
    const fx = await hostWithGroup("app-tool");
    await allowPolicy(fx.host, "app.dispatch_task");
    const root = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "第一跳会等审批",
      chain: [{ botId: fx.workerB, instruction: "永远不该跑" }],
    })) as Task;
    let approval: AppApproval | undefined;
    await vi.waitFor(
      async () => {
        const list = (await fx.host.handleMethod("permission.approval.list", {
          botId: fx.workerA,
        })) as { approvals: AppApproval[] };
        approval = list.approvals[0];
        expect(approval).toBeDefined();
      },
      { timeout: 20_000, interval: 100 },
    );
    // Revocation-equivalent: deny the capability while hop 1 is in flight.
    await fx.host.handleMethod("permission.policy.set", {
      capability: "app.dispatch_task",
      mode: "deny",
    });
    await fx.host.handleMethod("permission.approval.decide", {
      approvalId: approval!.id,
      expectedActionDigest: approval!.actionDigest,
      decision: "approved",
      scope: "once",
    });
    await waitForTask(fx.host, root.id, "done");
    const hops = (await fx.host.handleMethod("task.list", {
      rootTaskId: root.id,
    })) as { tasks: Task[] };
    expect(hops.tasks.find((task) => task.chainIndex === 1)?.status).toBe("skipped");
    const coordinatorHistory = listChatMessages(fx.host.db, fx.coordinator, 50);
    const interruption = coordinatorHistory.find(
      (row) => row.meta?.kind === "task_notice" && row.meta.status === "skipped",
    );
    expect(interruption?.text).toContain("接力链中断");
  });

  it("U11: cancelling the root cascades to the queued hop", async () => {
    const fx = await hostWithGroup("hang");
    const root = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "卡住的第一跳",
      chain: [{ botId: fx.workerB, instruction: "不该执行" }],
    })) as Task;
    await waitForTask(fx.host, root.id, "running");
    const hops = (await fx.host.handleMethod("task.list", {
      rootTaskId: root.id,
    })) as { tasks: Task[] };
    const hop2 = hops.tasks.find((task) => task.chainIndex === 1)!;
    expect(hop2.status).toBe("queued");
    await fx.host.handleMethod("task.cancel", { taskId: root.id });
    await waitForTask(fx.host, root.id, "cancelled");
    await waitForTask(fx.host, hop2.id, "cancelled");
  });

  it("U12: a restart interrupts both hops of an in-flight chain", async () => {
    const fx = await hostWithGroup("ok");
    const rootId = randomUUID();
    const hop2Id = randomUUID();
    // Seed the chain rows the dispatcher would have persisted, one running
    // and one queued, as if the process died mid-turn.
    insertTask(fx.host.db, {
      id: rootId,
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      instruction: "重启前",
      rootTaskId: rootId,
      chainIndex: 0,
      chainTotal: 2,
    });
    insertTask(fx.host.db, {
      id: hop2Id,
      fromBotId: fx.workerA,
      toBotId: fx.workerB,
      instruction: "排队跳",
      rootTaskId: rootId,
      chainIndex: 1,
      chainTotal: 2,
    });
    const { markTaskRunning } = await import("@deepseek-bot/storage");
    markTaskRunning(fx.host.db, rootId);
    const rootDir = fx.host.layout.root;
    await fx.host.shutdown();
    const restarted = await createHost({
      dataRoot: rootDir,
      resolveApiKey: async () => "sk-test-only",
      dshBin: fakeHarness,
    });
    hosts.push(restarted);
    expect(restarted.interruptedTasks).toBe(2);
    const hops = (await restarted.handleMethod("task.list", {
      rootTaskId: rootId,
    })) as { tasks: Task[] };
    expect(hops.tasks.map((task) => task.status)).toEqual(["interrupted", "interrupted"]);
    expect(hops.tasks.map((task) => task.chainIndex).sort()).toEqual([0, 1]);
  });
});

describe("queue cap (Q3)", () => {
  it("refuses dispatch beyond the per-bot queued cap", async () => {
    const fx = await hostWithGroup("hang", { tasks: { queuedCapPerBot: 2 } });
    // First dispatch occupies the executor (running), the next two queue up
    // to the cap; a fourth dispatch is refused with a readable error.
    for (const index of [1, 2, 3]) {
      await fx.host.handleMethod("task.dispatch", {
        fromBotId: fx.coordinator,
        toBotId: fx.workerA,
        task: `任务 ${index}`,
      });
    }
    await expect(
      fx.host.handleMethod("task.dispatch", {
        fromBotId: fx.coordinator,
        toBotId: fx.workerA,
        task: "超限任务",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(listTasks(fx.host.db, { toBotId: fx.workerA })).toHaveLength(3);
  });
});

describe("dispatcher copy follows the UI locale", () => {
  it("writes English handoff framing and delivery notices when the UI language is en", async () => {
    const fx = await hostWithGroup("echo-model", { tasks: { locale: "en" } });
    const root = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "design the landing sketch",
      chain: [{ botId: fx.workerB, instruction: "code it from the sketch" }],
    })) as Task;
    await waitForTask(fx.host, root.id, "done");
    await waitForTask(
      fx.host,
      ((await fx.host.handleMethod("task.list", { rootTaskId: root.id })) as { tasks: Task[] })
        .tasks.find((task) => task.chainIndex === 1)!.id,
      "done",
    );

    // The coder's marker carries the English handoff header + task marker.
    const coderHistory = listChatMessages(fx.host.db, fx.workerB, 20);
    const marker = coderHistory.find((row) => row.meta?.kind === "dispatch");
    expect(marker?.text).toContain("[Upstream handoff · Goal] design the landing sketch");
    expect(marker?.text).toContain("[Task] code it from the sketch");

    // The coordinator's delivery notice is English too.
    const notices = listChatMessages(fx.host.db, fx.coordinator, 50).filter(
      (row) => row.meta?.kind === "task_notice",
    );
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0]?.text).toContain("Task notice (Completed)");
    expect(notices[0]?.text).toContain('task dispatched from "manager" to "writer" completed');
  });

  it("settings.update { ui.locale } applies live and survives a Host restart", async () => {
    const fx = await hostWithGroup("ok");
    const zhRoot = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "默认语言任务",
    })) as Task;
    await waitForTask(fx.host, zhRoot.id, "done");
    expect(
      listChatMessages(fx.host.db, fx.coordinator, 50).some(
        (row) => row.meta?.kind === "task_notice" && row.text.includes("任务通知（已完成）"),
      ),
    ).toBe(true);

    // Live switch: the next notice is English, no Host restart involved.
    await fx.host.handleMethod("settings.update", { patch: { "ui.locale": "en" } });
    const enRoot = (await fx.host.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerB,
      task: "switched task",
    })) as Task;
    await waitForTask(fx.host, enRoot.id, "done");
    const noticesAfterSwitch = listChatMessages(fx.host.db, fx.coordinator, 50).filter(
      (row) => row.meta?.kind === "task_notice",
    );
    expect(noticesAfterSwitch.some((row) => row.text.includes("任务通知（已完成）"))).toBe(true);
    expect(noticesAfterSwitch.some((row) => row.text.includes("Task notice (Completed)"))).toBe(
      true,
    );

    // The pushed value persists in the settings KV; the restarted Host seeds
    // it, so the language survives a data.restore-style process restart.
    const rootDir = fx.host.layout.root;
    await fx.host.shutdown();
    const restarted = await createHost({
      dataRoot: rootDir,
      resolveApiKey: async () => "sk-test-only",
      dshBin: fakeHarness,
    });
    hosts.push(restarted);
    const afterRestart = (await restarted.handleMethod("task.dispatch", {
      fromBotId: fx.coordinator,
      toBotId: fx.workerA,
      task: "after restart",
    })) as Task;
    await waitForTask(restarted, afterRestart.id, "done");
    expect(
      listChatMessages(restarted.db, fx.coordinator, 50).filter(
        (row) => row.meta?.kind === "task_notice" && row.text.includes("Task notice (Completed)"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
