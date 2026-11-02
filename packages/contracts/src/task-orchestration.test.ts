/**
 * v0.5 manager orchestration contract tests (TASK_MANAGER_ORCHESTRATION.md).
 * Covers the role field's additive compatibility, the task.* method payload
 * shapes, the relay chain constraints (T7), the task.status event payload and
 * the app.dispatch_task capability default (U2/U5 contract half).
 */
import { describe, expect, it } from "vitest";
import {
  BotSchema,
  ChatMessageMetaSchema,
  EventEnvelopeSchema,
  TaskEventEnvelopeSchema,
  TaskSchema,
  defaultPermissionMode,
  isPermissionModeAllowed,
  METHOD_CONTRACTS,
  parseRequest,
  parseTaskEventPayload,
  requiresPerActionApproval,
  type Bot,
  type Method,
} from "./index.js";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const COORDINATOR = "20000000-0000-4000-8000-000000000001";
const WORKER_A = "20000000-0000-4000-8000-000000000002";
const WORKER_B = "20000000-0000-4000-8000-000000000003";
const WORKER_C = "20000000-0000-4000-8000-000000000004";
const TASK = "50000000-0000-4000-8000-000000000001";

function envelope(method: Method, payload: unknown): unknown {
  return {
    protocolVersion: "0.5",
    requestId: REQUEST_ID,
    method,
    payload,
  };
}

function bot(id: string, overrides: Partial<Bot> = {}): Bot {
  return BotSchema.parse({
    id,
    revision: "60000000-0000-4000-8000-000000000001",
    name: `bot-${id.slice(0, 4)}`,
    instructions: "",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
    archivedAt: null,
    ...overrides,
  });
}

describe("bot role (v0.5)", () => {
  it("defaults the role to standard so pre-0.5 stored bots keep parsing", () => {
    const parsed = BotSchema.parse({
      id: COORDINATOR,
      revision: "60000000-0000-4000-8000-000000000001",
      name: "legacy",
      instructions: "",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
      archivedAt: null,
    });
    expect(parsed.role).toBe("standard");
  });

  it("accepts the coordinator role on the human create/update surface", () => {
    const create = METHOD_CONTRACTS["bot.create"].request.safeParse({
      name: "manager",
      instructions: "",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
      role: "coordinator",
    });
    expect(create.success).toBe(true);
    const patch = METHOD_CONTRACTS["bot.update"].request.safeParse({
      id: COORDINATOR,
      expectedRevision: "60000000-0000-4000-8000-000000000001",
      patch: { role: "coordinator" },
    });
    expect(patch.success).toBe(true);
  });

  it("never lets the model-facing batch path carry a role field (U2)", () => {
    const batch = METHOD_CONTRACTS["bot.batchCreate"].request.safeParse({
      newGroup: { name: "content team" },
      bots: [
        {
          name: "writer",
          instructions: "",
          // A model attempting to self-promote must fail schema validation.
          role: "coordinator",
        },
      ],
    });
    expect(batch.success).toBe(false);
  });

  it("keeps role out of BotSchema output when unset in stored snapshots", () => {
    const parsed = bot(WORKER_A);
    expect(parsed.role).toBe("standard");
    expect(() => bot(WORKER_A, { role: "admin" as never })).toThrow();
  });
});

describe("task.dispatch contract", () => {
  it("accepts a same-group dispatch and normalizes the trimmed instruction", () => {
    const parsed = parseRequest(envelope("task.dispatch", {
      fromBotId: COORDINATOR,
      toBotId: WORKER_A,
      task: "  写本周选题清单  ",
    }), "task.dispatch");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.payload.task).toBe("写本周选题清单");
    }
  });

  it("rejects self-dispatch and repeats in the relay chain (U8)", () => {
    const self = parseRequest(envelope("task.dispatch", {
      fromBotId: COORDINATOR,
      toBotId: COORDINATOR,
      task: "自己派给自己",
    }), "task.dispatch");
    expect(self.success).toBe(false);

    const repeated = parseRequest(envelope("task.dispatch", {
      fromBotId: COORDINATOR,
      toBotId: WORKER_A,
      task: "接力",
      chain: [
        { botId: WORKER_B, instruction: "第二步" },
        { botId: WORKER_A, instruction: "绕回第一步" },
      ],
    }), "task.dispatch");
    expect(repeated.success).toBe(false);
  });

  it("caps the relay chain at TASK_CHAIN_MAX hops (U8)", () => {
    const tooLong = parseRequest(envelope("task.dispatch", {
      fromBotId: COORDINATOR,
      toBotId: WORKER_A,
      task: "接力",
      chain: [
        { botId: WORKER_B, instruction: "二" },
        { botId: WORKER_C, instruction: "三" },
        { botId: "20000000-0000-4000-8000-000000000005", instruction: "四" },
        { botId: "20000000-0000-4000-8000-000000000006", instruction: "五" },
      ],
    }), "task.dispatch");
    expect(tooLong.success).toBe(false);
  });

  it("rejects instructions above the 8000 character budget", () => {
    const parsed = parseRequest(envelope("task.dispatch", {
      fromBotId: COORDINATOR,
      toBotId: WORKER_A,
      task: "长".repeat(8_001),
    }), "task.dispatch");
    expect(parsed.success).toBe(false);
  });
});

describe("task entity and queries", () => {
  it("round-trips a relay root task", () => {
    const task = TaskSchema.parse({
      id: TASK,
      fromBotId: COORDINATOR,
      toBotId: WORKER_A,
      instruction: "设计首页",
      status: "queued",
      resultSummary: null,
      rootTaskId: TASK,
      chainIndex: 0,
      chainTotal: 3,
      createdAt: "2026-10-26T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      workerMessageIds: [],
    });
    expect(task.chainTotal).toBe(3);
    expect(() => TaskSchema.parse({ ...task, chainIndex: 4 })).toThrow();
    expect(() => TaskSchema.parse({ ...task, status: "skipped" })).not.toThrow();
  });

  it("filters by rootTaskId, participant and status", () => {
    const list = METHOD_CONTRACTS["task.list"].request;
    expect(list.safeParse({ rootTaskId: TASK }).success).toBe(true);
    expect(list.safeParse({ toBotId: WORKER_A, status: "queued" }).success).toBe(true);
    expect(list.safeParse({ status: "queued", limit: 200 }).success).toBe(false);
  });
});

describe("chat message meta (v0.5)", () => {
  it("parses dispatch markers, task notices, and answered choice cards", () => {
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "dispatch",
        taskId: TASK,
        fromBotId: COORDINATOR,
      }).success,
    ).toBe(true);
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "dispatch_reply",
        taskId: TASK,
        fromBotId: COORDINATOR,
      }).success,
    ).toBe(true);
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "task_notice",
        taskId: TASK,
        status: "done",
        resultSummary: "清单已写完",
      }).success,
    ).toBe(true);
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "choice",
        question: "Which first?",
        options: [
          { id: "A", label: "Alpha" },
          { id: "D", label: "以上都不是" },
        ],
        other: true,
        answered: "Alpha",
      }).success,
    ).toBe(true);
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "choice",
        question: "Which first?",
        options: [
          { id: "A", label: "Alpha" },
          { id: "B", label: "Beta" },
        ],
        answered: "",
      }).success,
    ).toBe(false);
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "choice",
        question: "Which first?",
        options: [{ id: "A", label: "Alpha" }],
        answered: "Alpha",
      }).success,
    ).toBe(false);
    expect(
      ChatMessageMetaSchema.safeParse({
        kind: "choice",
        question: "Which first?",
        options: [
          { id: "A", label: "Alpha" },
          { id: "B", label: "Beta" },
        ],
        answered: "Alpha",
        secret: "no",
      }).success,
    ).toBe(false);
    expect(ChatMessageMetaSchema.safeParse({ kind: "relay" }).success).toBe(false);
  });
});

describe("task.status event (v0.5)", () => {
  it("requires a reason on terminal transitions and validates envelopes", () => {
    const payload = { taskId: TASK, from: "running", to: "done" };
    expect(parseTaskEventPayload({ type: "task.status", payload }).success).toBe(false);
    const done = parseTaskEventPayload({
      type: "task.status",
      payload: { ...payload, reason: "turn finished" },
    });
    expect(done.success).toBe(true);
    const envelope = TaskEventEnvelopeSchema.safeParse({
      eventId: "70000000-0000-4000-8000-000000000001",
      taskId: TASK,
      sequence: 0,
      timestamp: "2026-10-26T00:00:00.000Z",
      type: "task.status",
      payload: { taskId: TASK, from: "queued", to: "running" },
    });
    expect(envelope.success).toBe(true);
    // Run envelopes stay untouched: a task.status never enters the runs log.
    expect(
      EventEnvelopeSchema.safeParse({
        eventId: "70000000-0000-4000-8000-000000000001",
        runId: TASK,
        sequence: 0,
        timestamp: "2026-10-26T00:00:00.000Z",
        type: "task.status",
        payload: {},
      }).success,
    ).toBe(false);
  });
});

describe("app.dispatch_task capability (U5 contract half)", () => {
  it("defaults to ask and permits every grant scope", () => {
    expect(defaultPermissionMode("app.dispatch_task")).toBe("ask");
    expect(requiresPerActionApproval("app.dispatch_task")).toBe(false);
    expect(isPermissionModeAllowed("app.dispatch_task", "allow")).toBe(true);
    expect(isPermissionModeAllowed("app.dispatch_task", "ask")).toBe(true);
    expect(isPermissionModeAllowed("app.dispatch_task", "deny")).toBe(true);
  });

  it("keeps app.start_run locked to ask (Q1 unchanged)", () => {
    expect(requiresPerActionApproval("app.start_run")).toBe(true);
    expect(isPermissionModeAllowed("app.start_run", "allow")).toBe(false);
  });
});
