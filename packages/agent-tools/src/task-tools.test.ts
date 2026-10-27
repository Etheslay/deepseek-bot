/**
 * dispatch_task / list_tasks tool layer (v0.5 manager orchestration §3.3):
 * strict input schemas, the FR-8 coordinator rules at the gateway, the exact
 * payload mapping into the Host dispatcher and error propagation/audit.
 *
 * The tool-name → CapabilityId binding (dispatch_task → app.dispatch_task,
 * list_tasks → app.read) lives in packages/host/src/agent-permissions.ts;
 * from this package's side the observable contract is that the gateway
 * checkpoint receives the tool name and that the capability ids it returns
 * ride into the audit record — both asserted below.
 */
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@deepseek-bot/contracts";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import {
  bindTaskTools,
  DispatchTaskInputSchema,
  ListTasksInputSchema,
  type TaskToolBotView,
  type TaskToolDeps,
} from "./task-tools.js";
import type { GrantCheckResult } from "./types.js";

const COORD = "11111111-1111-4111-8111-111111111111";
const WORKER = "22222222-2222-4222-8222-222222222222";
const HOP = "33333333-3333-4333-8333-333333333333";
const CROSS_GROUP = "44444444-4444-4444-8444-444444444444";
const ARCHIVED = "55555555-5555-4555-8555-555555555555";
const ROOT_TASK = "99999999-9999-4999-8999-999999999999";
const MISSING_BOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Bots the fake resolver knows: one live group "g-live" plus a cross-group bot. */
const BOTS: Readonly<Record<string, TaskToolBotView>> = {
  [COORD]: { id: COORD, name: "调度台", role: "coordinator", groupId: "g-live", archivedAt: null },
  [WORKER]: { id: WORKER, name: "执行者", role: "standard", groupId: "g-live", archivedAt: null },
  [HOP]: { id: HOP, name: "接力者", role: "standard", groupId: "g-live", archivedAt: null },
  [CROSS_GROUP]: { id: CROSS_GROUP, name: "别组机器人", role: "standard", groupId: "g-other", archivedAt: null },
  [ARCHIVED]: {
    id: ARCHIVED,
    name: "已归档",
    role: "standard",
    groupId: "g-live",
    archivedAt: "2026-10-26T00:00:00.000Z",
  },
};

const TASK: Task = {
  id: ROOT_TASK,
  fromBotId: COORD,
  toBotId: WORKER,
  instruction: "写一份部署手册",
  status: "queued",
  resultSummary: null,
  rootTaskId: ROOT_TASK,
  chainIndex: 0,
  chainTotal: 1,
  createdAt: "2026-10-27T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  workerMessageIds: [],
};

type DispatchInput = Parameters<TaskToolDeps["dispatch"]>[0];
type ListFilter = Parameters<TaskToolDeps["listForBot"]>[1];

interface SetupOptions {
  dispatch?: (input: DispatchInput) => Promise<Task>;
  listForBot?: (botId: string, filter: ListFilter) => Promise<{ tasks: Task[] }>;
  /** Fixed grant checkpoint result (defaults to allow without authorization refs). */
  grant?: GrantCheckResult;
}

function setup(options: SetupOptions = {}) {
  const audit = new MemoryAuditSink();
  const dispatch = vi.fn(options.dispatch ?? (async (_input: DispatchInput) => TASK));
  const listForBot = vi.fn(options.listForBot ?? (async (_botId: string, _filter: ListFilter) => ({ tasks: [TASK] })));
  const resolveBot = vi.fn((botId: string) => BOTS[botId]);
  const deps: TaskToolDeps = { resolveBot, dispatch, listForBot };
  const registry = new ToolRegistry();
  for (const tool of bindTaskTools(deps)) {
    registry.register(tool);
  }
  const grantCheck = vi.fn(async () => options.grant ?? { allowed: true });
  const gateway = new ToolGateway({
    registry,
    audit,
    grants: { check: grantCheck },
    now: () => new Date("2026-10-27T00:00:00Z"),
  });
  return { gateway, audit, dispatch, listForBot, resolveBot, grantCheck };
}

/** Trusted chat-turn caller bound to the coordinator bot. */
const coordinator = { id: `chat:s1/${COORD}`, botId: COORD };
const VALID_DISPATCH = { toBotId: WORKER, task: "写一份部署手册" };

describe("bindTaskTools metadata", () => {
  it("exposes dispatch_task and list_tasks with the exported schemas", () => {
    const tools = bindTaskTools({
      resolveBot: () => undefined,
      dispatch: async () => TASK,
      listForBot: async () => ({ tasks: [] }),
    });
    expect(tools.map((tool) => tool.name)).toEqual(["dispatch_task", "list_tasks"]);
    expect(tools[0]?.inputSchema).toBe(DispatchTaskInputSchema);
    expect(tools[1]?.inputSchema).toBe(ListTasksInputSchema);
    expect(tools[0]?.description).toContain("coordinator");
    expect(tools[0]?.description).toContain("4 hops");
    expect(tools[1]?.description).toContain("read-only");
  });

  it("routes the tool names through the grant checkpoint and audits the bound capability ids", async () => {
    const { gateway, audit } = setup({
      grant: { allowed: true, capabilities: ["app.dispatch_task"] },
    });
    await gateway.call(coordinator, "dispatch_task", VALID_DISPATCH);
    expect(audit.records[0]).toMatchObject({
      tool: "dispatch_task",
      outcome: "ok",
      capabilities: ["app.dispatch_task"],
    });
  });

  it("audits list_tasks under the read capability", async () => {
    const { gateway, audit } = setup({ grant: { allowed: true, capabilities: ["app.read"] } });
    await gateway.call(coordinator, "list_tasks", {});
    expect(audit.records[0]).toMatchObject({
      tool: "list_tasks",
      outcome: "ok",
      capabilities: ["app.read"],
    });
  });
});

describe("DispatchTaskInputSchema", () => {
  it("accepts the minimal shape and trims the instruction", () => {
    const parsed = DispatchTaskInputSchema.parse({
      toBotId: WORKER,
      task: "  写一份部署手册  ",
    });
    expect(parsed).toEqual({ toBotId: WORKER, task: "写一份部署手册" });
  });

  it("keeps the instruction at 8000 characters and rejects one more", () => {
    expect(
      DispatchTaskInputSchema.safeParse({ toBotId: WORKER, task: "x".repeat(8_000) }).success,
    ).toBe(true);
    expect(
      DispatchTaskInputSchema.safeParse({ toBotId: WORKER, task: "x".repeat(8_001) }).success,
    ).toBe(false);
  });

  it("bounds context at 4000 characters after trimming", () => {
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        context: "x".repeat(4_000),
      }).success,
    ).toBe(true);
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        context: "x".repeat(4_001),
      }).success,
    ).toBe(false);
    // trim + min(1): a whitespace-only context is not a context.
    expect(
      DispatchTaskInputSchema.safeParse({ toBotId: WORKER, task: "t", context: "   " }).success,
    ).toBe(false);
  });

  it("allows up to TASK_CHAIN_MAX - 1 pre-declared hops", () => {
    const hops = ["66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"].map(
      (botId) => ({ botId, instruction: "接力一跳" }),
    );
    expect(hops).toHaveLength(3);
    expect(
      DispatchTaskInputSchema.safeParse({ toBotId: WORKER, task: "t", chain: hops }).success,
    ).toBe(true);
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        chain: [...hops, { botId: COORD, instruction: "第四跳会超过 4 跳上限" }],
      }).success,
    ).toBe(false);
  });

  it("validates each hop strictly: uuid botId, non-empty bounded instruction, no extra keys", () => {
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        chain: [{ botId: "not-a-uuid", instruction: "x" }],
      }).success,
    ).toBe(false);
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        chain: [{ botId: HOP, instruction: "   " }],
      }).success,
    ).toBe(false);
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        chain: [{ botId: HOP, instruction: "x".repeat(8_001) }],
      }).success,
    ).toBe(false);
    expect(
      DispatchTaskInputSchema.safeParse({
        toBotId: WORKER,
        task: "t",
        chain: [{ botId: HOP, instruction: "x", fromBotId: WORKER }],
      }).success,
    ).toBe(false);
  });

  it("rejects missing fields, non-uuid targets and blank instructions", async () => {
    expect(DispatchTaskInputSchema.safeParse({}).success).toBe(false);
    expect(DispatchTaskInputSchema.safeParse({ toBotId: WORKER }).success).toBe(false);
    expect(DispatchTaskInputSchema.safeParse({ task: "t" }).success).toBe(false);
    expect(
      DispatchTaskInputSchema.safeParse({ toBotId: "nope", task: "t" }).success,
    ).toBe(false);
    expect(
      DispatchTaskInputSchema.safeParse({ toBotId: WORKER, task: "   " }).success,
    ).toBe(false);
  });
});

describe("ListTasksInputSchema", () => {
  it("defaults the limit to 20 on an empty query", () => {
    expect(ListTasksInputSchema.parse({})).toEqual({ limit: 20 });
  });

  it("accepts exactly the task status vocabulary", () => {
    for (const status of ["queued", "running", "done", "failed", "cancelled", "skipped", "interrupted"] as const) {
      expect(ListTasksInputSchema.safeParse({ status }).success).toBe(true);
    }
    expect(ListTasksInputSchema.safeParse({ status: "pending" }).success).toBe(false);
  });

  it("keeps the limit an integer within 1..50", () => {
    expect(ListTasksInputSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(ListTasksInputSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(ListTasksInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(ListTasksInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(ListTasksInputSchema.safeParse({ limit: 2.5 }).success).toBe(false);
  });

  it("requires a uuid rootTaskId and stays strict", () => {
    expect(ListTasksInputSchema.safeParse({ rootTaskId: ROOT_TASK }).success).toBe(true);
    expect(ListTasksInputSchema.safeParse({ rootTaskId: "root-1" }).success).toBe(false);
    // Strictness also blocks a model from naming another bot as the scope.
    expect(ListTasksInputSchema.safeParse({ botId: WORKER }).success).toBe(false);
  });
});

describe("dispatch_task handler", () => {
  it("dispatches with the trusted coordinator id and forwards the created task", async () => {
    const { gateway, dispatch } = setup();
    const result = await gateway.call(coordinator, "dispatch_task", VALID_DISPATCH);
    expect(result).toBe(TASK);
    expect(dispatch).toHaveBeenCalledWith({
      fromBotId: COORD,
      toBotId: WORKER,
      task: "写一份部署手册",
    });
  });

  it("trims the instruction before handing it to the dispatcher", async () => {
    const { gateway, dispatch } = setup();
    await gateway.call(coordinator, "dispatch_task", {
      toBotId: WORKER,
      task: "  完成调研  ",
    });
    expect(dispatch).toHaveBeenCalledWith({
      fromBotId: COORD,
      toBotId: WORKER,
      task: "完成调研",
    });
  });

  it("omits context, chain and authorization keys when the model sent none", async () => {
    const { gateway, dispatch } = setup();
    await gateway.call(coordinator, "dispatch_task", VALID_DISPATCH);
    const input = dispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect("context" in input).toBe(false);
    expect("chain" in input).toBe(false);
    expect("authorization" in input).toBe(false);
  });

  it("forwards context and the pre-declared chain verbatim", async () => {
    const { gateway, dispatch } = setup();
    const chain = [{ botId: HOP, instruction: "复核部署手册" }];
    await gateway.call(coordinator, "dispatch_task", {
      toBotId: WORKER,
      task: "写一份部署手册",
      context: "面向新同事",
      chain,
    });
    expect(dispatch).toHaveBeenCalledWith({
      fromBotId: COORD,
      toBotId: WORKER,
      task: "写一份部署手册",
      context: "面向新同事",
      chain,
    });
  });

  it("carries approval/grant references from the checkpoint into the dispatch", async () => {
    const { gateway, dispatch, audit } = setup({
      grant: { allowed: true, approvalId: "approval-1", grantIds: ["grant-1"] },
    });
    await gateway.call(coordinator, "dispatch_task", VALID_DISPATCH);
    expect(dispatch).toHaveBeenCalledWith({
      fromBotId: COORD,
      toBotId: WORKER,
      task: "写一份部署手册",
      authorization: { approvalId: "approval-1", grantIds: ["grant-1"] },
    });
    expect(audit.records[0]).toMatchObject({
      approvalId: "approval-1",
      grantIds: ["grant-1"],
    });
  });

  it("records only the grant ids when no approval was minted", async () => {
    const { gateway, dispatch } = setup({ grant: { allowed: true, grantIds: ["grant-9"] } });
    await gateway.call(coordinator, "dispatch_task", VALID_DISPATCH);
    const input = dispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.authorization).toEqual({ grantIds: ["grant-9"] });
  });

  it("records only the approval id when the call rode no permanent grant", async () => {
    const { gateway, dispatch } = setup({ grant: { allowed: true, approvalId: "approval-7" } });
    await gateway.call(coordinator, "dispatch_task", VALID_DISPATCH);
    const input = dispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.authorization).toEqual({ approvalId: "approval-7" });
  });

  it("requires a bot-bound caller before touching deps", async () => {
    const { gateway, dispatch, resolveBot } = setup();
    await expect(
      gateway.call({ id: "ui:1" }, "dispatch_task", VALID_DISPATCH),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(resolveBot).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a caller bot that is missing or archived", async () => {
    const missing = setup();
    await expect(
      missing.gateway.call({ id: "chat:s1/x", botId: MISSING_BOT }, "dispatch_task", VALID_DISPATCH),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const archived = setup();
    await expect(
      archived.gateway.call({ id: `chat:s1/${ARCHIVED}`, botId: ARCHIVED }, "dispatch_task", VALID_DISPATCH),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(missing.dispatch).not.toHaveBeenCalled();
    expect(archived.dispatch).not.toHaveBeenCalled();
  });

  it("rejects standard-role bots from dispatching", async () => {
    const { gateway, dispatch } = setup();
    await expect(
      gateway.call({ id: `chat:s1/${WORKER}`, botId: WORKER }, "dispatch_task", VALID_DISPATCH),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses to dispatch a task to the coordinator itself", async () => {
    const { gateway, dispatch } = setup();
    await expect(
      gateway.call(coordinator, "dispatch_task", { toBotId: COORD, task: "自己干活" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "不能把任务派发给自己" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("explains a missing or archived target with its bot id", async () => {
    const { gateway } = setup();
    await expect(
      gateway.call(coordinator, "dispatch_task", { toBotId: MISSING_BOT, task: "t" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: `目标 bot 不存在或已归档：${MISSING_BOT}`,
    });
    await expect(
      gateway.call(coordinator, "dispatch_task", { toBotId: ARCHIVED, task: "t" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: `目标 bot 不存在或已归档：${ARCHIVED}`,
    });
  });

  it("rejects cross-group dispatch and a coordinator without a group", async () => {
    const { gateway, dispatch } = setup();
    await expect(
      gateway.call(coordinator, "dispatch_task", { toBotId: CROSS_GROUP, task: "t" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    // A group-less coordinator has nobody reachable ("groupId === null" leg).
    const lonely = setup();
    lonely.resolveBot.mockImplementation((botId) =>
      botId === COORD
        ? { id: COORD, name: "无组调度台", role: "coordinator", groupId: null, archivedAt: null }
        : BOTS[botId],
    );
    await expect(
      lonely.gateway.call(coordinator, "dispatch_task", VALID_DISPATCH),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("validates every chain hop with the same reachability rules", async () => {
    const { gateway, dispatch } = setup();
    await expect(
      gateway.call(coordinator, "dispatch_task", {
        toBotId: WORKER,
        task: "t",
        chain: [{ botId: HOP, instruction: "在组内" }, { botId: CROSS_GROUP, instruction: "跨组" }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects schema-invalid dispatch parameters before any handler runs", async () => {
    const { gateway, dispatch, resolveBot } = setup();
    await expect(
      gateway.call(coordinator, "dispatch_task", { task: "缺少目标 bot" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      gateway.call(coordinator, "dispatch_task", { toBotId: "not-a-uuid", task: "t" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      gateway.call(coordinator, "dispatch_task", { toBotId: WORKER, task: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Strict top level: the model cannot forge an authorization reference.
    await expect(
      gateway.call(coordinator, "dispatch_task", {
        ...VALID_DISPATCH,
        authorization: { approvalId: "self-approved" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(resolveBot).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("propagates dispatcher rejections as audited runtime errors", async () => {
    const { gateway, audit } = setup({
      dispatch: async () => {
        throw new Error("任务队列已满");
      },
    });
    await expect(
      gateway.call(coordinator, "dispatch_task", VALID_DISPATCH),
    ).rejects.toThrow("任务队列已满");
    expect(audit.records[0]).toMatchObject({
      tool: "dispatch_task",
      outcome: "error",
      code: "RUNTIME_ERROR",
      reason: "tool execution failed",
    });
  });
});

describe("list_tasks handler", () => {
  it("applies the default limit and scopes the query to the trusted caller", async () => {
    const { gateway, listForBot } = setup();
    const result = (await gateway.call(coordinator, "list_tasks", {})) as { tasks: Task[] };
    expect(result.tasks).toEqual([TASK]);
    expect(listForBot).toHaveBeenCalledWith(COORD, { limit: 20 });
  });

  it("forwards status and rootTaskId filters when provided", async () => {
    const { gateway, listForBot } = setup();
    await gateway.call(coordinator, "list_tasks", {
      status: "running",
      rootTaskId: ROOT_TASK,
      limit: 5,
    });
    expect(listForBot).toHaveBeenCalledWith(COORD, {
      status: "running",
      rootTaskId: ROOT_TASK,
      limit: 5,
    });
  });

  it("omits the rootTaskId key when only a status is given", async () => {
    const { gateway, listForBot } = setup();
    await gateway.call(coordinator, "list_tasks", { status: "done" });
    const filter = listForBot.mock.calls[0]![1] as Record<string, unknown>;
    expect("rootTaskId" in filter).toBe(false);
    expect(filter).toEqual({ status: "done", limit: 20 });
  });

  it("shares the coordinator requirement with dispatch_task", async () => {
    const { gateway, listForBot } = setup();
    await expect(
      gateway.call({ id: `chat:s1/${WORKER}`, botId: WORKER }, "list_tasks", {}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await expect(
      gateway.call({ id: "ui:1" }, "list_tasks", {}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(listForBot).not.toHaveBeenCalled();
  });

  it("rejects invalid filters before the store runs", async () => {
    const { gateway, listForBot } = setup();
    await expect(
      gateway.call(coordinator, "list_tasks", { status: "pending" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      gateway.call(coordinator, "list_tasks", { limit: 51 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Strictness is the only thing keeping the model from naming another bot.
    await expect(
      gateway.call(coordinator, "list_tasks", { botId: WORKER }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(listForBot).not.toHaveBeenCalled();
  });

  it("propagates store failures as audited runtime errors", async () => {
    const { gateway, audit } = setup({
      listForBot: async () => {
        throw new Error("存储不可用");
      },
    });
    await expect(gateway.call(coordinator, "list_tasks", {})).rejects.toThrow("存储不可用");
    expect(audit.records[0]).toMatchObject({
      tool: "list_tasks",
      outcome: "error",
      code: "RUNTIME_ERROR",
    });
  });
});
