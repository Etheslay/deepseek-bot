import { describe, expect, it } from "vitest";
import {
  APPROVAL_STATUSES_TERMINAL,
  ApprovalSchema,
  ArtifactSchema,
  AssistantDeltaSchema,
  assignBatchAvatars,
  AVATAR_COLORS,
  AVATAR_SHAPES,
  avatarPoolKey,
  BotSchema,
  BotCreationDraftSchema,
  BotGroupSchema,
  canonicalAvatarPool,
  ContractErrorSchema,
  ERROR_CODES,
  EventEnvelopeSchema,
  IanaTimeZoneSchema,
  IsoDateTimeUtcSchema,
  MediaTypeSchema,
  NODE_RUN_TERMINAL_STATUSES,
  NodeRunSchema,
  RelativeArtifactPathSchema,
  RUN_TERMINAL_STATUSES,
  RunSchema,
  RunTriggerSchema,
  ScheduleSchema,
  Sha256HexSchema,
  TransitionError,
  UuidSchema,
  WorkflowNodeSchema,
  assertNodeRunTransition,
  assertRunTransition,
  canTransitionNodeRun,
  canTransitionRun,
  isNodeRunTerminal,
  isRunTerminal,
  isSequenceMonotonic,
  parseEventPayload,
} from "./index.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("primitives", () => {
  it("accepts lowercase UUIDs and rejects other formats", () => {
    expect(UuidSchema.safeParse(UUID).success).toBe(true);
    expect(
      UuidSchema.safeParse("A1B2C3D4-E5F6-4A5B-8C6D-7E8F9A0B1C2D").success,
    ).toBe(false);
    expect(UuidSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(UuidSchema.safeParse("11111111111141118111111111111111").success).toBe(
      false,
    );
  });

  it("requires UTC Z timestamps", () => {
    expect(IsoDateTimeUtcSchema.safeParse("2026-10-24T10:00:00Z").success).toBe(
      true,
    );
    expect(
      IsoDateTimeUtcSchema.safeParse("2026-10-24T10:00:00+01:00").success,
    ).toBe(false);
    expect(
      IsoDateTimeUtcSchema.safeParse("2026-10-24T10:00:00").success,
    ).toBe(false);
    expect(IsoDateTimeUtcSchema.safeParse("2026-10-24 10:00:00").success).toBe(
      false,
    );
  });

  it("validates IANA time zones", () => {
    expect(IanaTimeZoneSchema.safeParse("Asia/Shanghai").success).toBe(true);
    expect(IanaTimeZoneSchema.safeParse("UTC").success).toBe(true);
    expect(IanaTimeZoneSchema.safeParse("Mars/Olympus").success).toBe(false);
    expect(IanaTimeZoneSchema.safeParse("").success).toBe(false);
  });

  it("rejects path traversal in artifact relative paths", () => {
    expect(RelativeArtifactPathSchema.safeParse("out/report.md").success).toBe(
      true,
    );
    expect(RelativeArtifactPathSchema.safeParse("../escape.md").success).toBe(
      false,
    );
    expect(RelativeArtifactPathSchema.safeParse("a/../../b").success).toBe(
      false,
    );
    expect(RelativeArtifactPathSchema.safeParse("a//b").success).toBe(false);
    expect(RelativeArtifactPathSchema.safeParse("/abs/path.md").success).toBe(
      false,
    );
    expect(RelativeArtifactPathSchema.safeParse("C:\\tmp\\x.md").success).toBe(
      false,
    );
  });

  it("validates media types and sha-256 digests", () => {
    expect(MediaTypeSchema.safeParse("text/markdown").success).toBe(true);
    expect(
      MediaTypeSchema.safeParse("application/json; charset=utf-8").success,
    ).toBe(true);
    expect(MediaTypeSchema.safeParse("noslash").success).toBe(false);

    const digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(Sha256HexSchema.safeParse(digest).success).toBe(true);
    expect(Sha256HexSchema.safeParse(digest.slice(0, 63)).success).toBe(false);
    expect(Sha256HexSchema.safeParse(digest.replace("9f", "ZZ")).success).toBe(
      false,
    );
  });
});

describe("error object", () => {
  it("exposes the 16 stable codes", () => {
    expect(ERROR_CODES).toHaveLength(16);
    expect(ERROR_CODES).toContain("REVISION_CONFLICT");
    expect(ERROR_CODES).toContain("APPROVAL_EXPIRED");
  });

  it("requires code, message, retryable and requestId", () => {
    const valid = {
      code: "RATE_LIMITED",
      message: "slow down",
      retryable: true,
      requestId: UUID,
    };
    expect(ContractErrorSchema.safeParse(valid).success).toBe(true);
    expect(
      ContractErrorSchema.safeParse({ ...valid, retryable: undefined }).success,
    ).toBe(false);
    expect(
      ContractErrorSchema.safeParse({ ...valid, code: "NOT_A_CODE" }).success,
    ).toBe(false);
  });
});

describe("status machines", () => {
  it("follows the Run lifecycle from CONTRACTS §5", () => {
    expect(canTransitionRun("queued", "running")).toBe(true);
    expect(canTransitionRun("running", "waiting_approval")).toBe(true);
    expect(canTransitionRun("waiting_approval", "running")).toBe(true);
    expect(canTransitionRun("running", "cancelling")).toBe(true);
    expect(canTransitionRun("waiting_approval", "cancelling")).toBe(true);
    expect(canTransitionRun("cancelling", "cancelled")).toBe(true);
    expect(canTransitionRun("running", "interrupted")).toBe(true);
    expect(canTransitionRun("queued", "succeeded")).toBe(false);
    expect(canTransitionRun("cancelling", "running")).toBe(false);
    expect(canTransitionRun("cancelled", "running")).toBe(false);
    expect(canTransitionRun("succeeded", "running")).toBe(false);
  });

  it("treats succeeded/failed/cancelled/interrupted as terminal", () => {
    expect(RUN_TERMINAL_STATUSES).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "interrupted",
    ]);
    expect(isRunTerminal("interrupted")).toBe(true);
    expect(isRunTerminal("cancelling")).toBe(false);
  });

  it("follows the NodeRun lifecycle including skipped", () => {
    expect(canTransitionNodeRun("pending", "running")).toBe(true);
    expect(canTransitionNodeRun("pending", "skipped")).toBe(true);
    expect(canTransitionNodeRun("pending", "succeeded")).toBe(false);
    expect(canTransitionNodeRun("running", "waiting_approval")).toBe(true);
    expect(canTransitionNodeRun("waiting_approval", "failed")).toBe(true);
    expect(canTransitionNodeRun("skipped", "running")).toBe(false);
    expect(NODE_RUN_TERMINAL_STATUSES).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "skipped",
      "interrupted",
    ]);
    expect(isNodeRunTerminal("skipped")).toBe(true);
  });

  it("throws TransitionError for illegal transitions", () => {
    expect(() => assertRunTransition("succeeded", "running")).toThrow(
      TransitionError,
    );
    expect(() => assertNodeRunTransition("succeeded", "running")).toThrow(
      TransitionError,
    );
    expect(() => assertRunTransition("running", "succeeded")).not.toThrow();
  });
});

describe("entities", () => {
  const bot = {
    id: UUID,
    revision: "22222222-2222-4222-8222-222222222222",
    name: "note-summarizer",
    instructions: "You summarize notes.",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
    archivedAt: null,
  };

  it("parses an active bot", () => {
    expect(BotSchema.safeParse(bot).success).toBe(true);
  });

  it("parses pre-v0.2 bots without avatar/groupId keys (stored snapshots)", () => {
    expect("avatar" in bot).toBe(false);
    expect(BotSchema.safeParse(bot).success).toBe(true);
  });

  it("parses avatar and groupId fields and rejects unknown pool values", () => {
    const decorated = {
      ...bot,
      avatar: { shape: "star5", color: "#3b93f0" },
      groupId: "77777777-7777-4777-8777-777777777777",
    };
    expect(BotSchema.safeParse(decorated).success).toBe(true);
    expect(
      BotSchema.safeParse({
        ...decorated,
        avatar: { shape: "moon-slice", color: "#3b93f0" },
      }).success,
    ).toBe(false);
    expect(
      BotSchema.safeParse({
        ...decorated,
        avatar: { shape: "star5", color: "#ff00ff" },
      }).success,
    ).toBe(false);
  });

  it("parses bot groups", () => {
    expect(
      BotGroupSchema.safeParse({
        id: UUID,
        revision: "22222222-2222-4222-8222-222222222222",
        name: "research-squad",
        archivedAt: null,
      }).success,
    ).toBe(true);
  });

  it("treats every bot creation draft field as optional", () => {
    expect(BotCreationDraftSchema.safeParse({}).success).toBe(true);
    expect(
      BotCreationDraftSchema.safeParse({
        name: "scout",
        instructions: "Look things up.",
        avatar: { shape: "egg", color: "#f0b429" },
      }).success,
    ).toBe(true);
    expect(
      BotCreationDraftSchema.safeParse({
        avatar: { shape: "egg", color: "#ff00ff" },
      }).success,
    ).toBe(false);
  });

  it("assigns distinct avatars, explicit picks win, repeats only after exhaustion", () => {
    const pool = canonicalAvatarPool();
    expect(pool).toHaveLength(AVATAR_SHAPES.length * AVATAR_COLORS.length);

    const taken = new Set([avatarPoolKey(pool[0]!), avatarPoolKey(pool[1]!)]);
    const assigned = assignBatchAvatars({
      count: 3,
      explicit: [{ shape: "heart", color: "#e8483f" }, undefined, undefined],
      taken,
    });
    expect(assigned[0]).toEqual({ shape: "heart", color: "#e8483f" });
    const keys = assigned.slice(1).map(avatarPoolKey);
    expect(keys).toEqual([avatarPoolKey(pool[2]!), avatarPoolKey(pool[3]!)]);
    expect(new Set([...keys, ...taken]).size).toBe(4);

    // Exhausted scope: automatic picks cycle over the pool.
    const everything = new Set(pool.map(avatarPoolKey));
    const exhausted = assignBatchAvatars({
      count: 2,
      explicit: [undefined, undefined],
      taken: everything,
    });
    expect(exhausted).toEqual([pool[0], pool[1]]);
  });

  it("requires botId on bot nodes and forbids it on approval nodes", () => {
    expect(
      WorkflowNodeSchema.safeParse({
        id: "n1",
        type: "bot",
        instructionTemplate: "Do things.",
      }).success,
    ).toBe(false);
    expect(
      WorkflowNodeSchema.safeParse({
        id: "n1",
        type: "bot",
        botId: UUID,
        instructionTemplate: "Do things.",
      }).success,
    ).toBe(true);
    expect(
      WorkflowNodeSchema.safeParse({
        id: "n2",
        type: "approval",
        botId: UUID,
        instructionTemplate: "Approve?",
      }).success,
    ).toBe(false);
    expect(
      WorkflowNodeSchema.safeParse({
        id: "n2",
        type: "approval",
        instructionTemplate: "Approve?",
      }).success,
    ).toBe(true);
  });

  it("defaults workflow node collections and retry policy", () => {
    const node = WorkflowNodeSchema.parse({
      id: "n1",
      type: "approval",
      instructionTemplate: "Approve?",
    });
    expect(node.inputBindings).toEqual([]);
    expect(node.retryPolicy).toEqual({ maxRetries: 0 });
  });

  it("constrains schedule triggers to carry schedule context", () => {
    expect(
      RunTriggerSchema.safeParse({
        kind: "manual",
        idempotencyKey: UUID,
      }).success,
    ).toBe(true);
    expect(
      RunTriggerSchema.safeParse({ kind: "schedule", idempotencyKey: UUID })
        .success,
    ).toBe(false);
    expect(
      RunTriggerSchema.safeParse({
        kind: "schedule",
        idempotencyKey: UUID,
        scheduleId: "55555555-5555-4555-8555-555555555555",
        occurrenceUtc: "2026-10-24T10:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("pins v0.1 misfire policy and 5-field cron recurrence", () => {
    const base = {
      id: UUID,
      workflowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      timezone: "Asia/Shanghai",
      nextRunAt: null,
      enabled: true,
    };
    expect(
      ScheduleSchema.safeParse({
        ...base,
        recurrence: "0 9 * * 1-5",
        misfirePolicy: "skip-and-notify",
      }).success,
    ).toBe(true);
    expect(
      ScheduleSchema.safeParse({
        ...base,
        recurrence: "0 9 * *",
        misfirePolicy: "skip-and-notify",
      }).success,
    ).toBe(false);
    expect(
      ScheduleSchema.safeParse({
        ...base,
        recurrence: "0 9 * * 1-5",
        misfirePolicy: "catch-up",
      }).success,
    ).toBe(false);
  });

  it("keeps approval statuses closed with one-shot consumption", () => {
    const approval = {
      id: UUID,
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      actionDigest:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      resource: "D:\\workspaces\\demo\\report.md",
      expiresAt: "2026-10-24T10:10:00Z",
      status: "pending",
    };
    expect(ApprovalSchema.safeParse(approval).success).toBe(true);
    expect(ApprovalSchema.safeParse({ ...approval, status: "revoked" }).success)
      .toBe(false);
    expect(APPROVAL_STATUSES_TERMINAL).toEqual([
      "denied",
      "expired",
      "consumed",
    ]);
  });

  it("rejects artifacts escaping the artifact directory", () => {
    const artifact = {
      id: UUID,
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      relativePath: "runs/2026-10-24/summary.md",
      mediaType: "text/markdown",
      size: 120,
      checksum: {
        algorithm: "sha256",
        value:
          "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
    };
    expect(ArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(
      ArtifactSchema.safeParse({
        ...artifact,
        relativePath: "../outside.md",
      }).success,
    ).toBe(false);
    expect(
      ArtifactSchema.safeParse({ ...artifact, checksum: { algorithm: "md5", value: "x" } })
        .success,
    ).toBe(false);
  });

  it("requires Run to embed an immutable workflow snapshot", () => {
    const run = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      workflowSnapshot: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "daily-note",
        schemaVersion: "0.1",
        nodes: [
          {
            id: "n1",
            type: "bot",
            botId: UUID,
            instructionTemplate: "Summarize.",
          },
        ],
        edges: [],
      },
      botSnapshots: [],
      status: "queued",
      trigger: { kind: "manual", idempotencyKey: UUID },
      createdAt: "2026-10-24T10:00:00Z",
      finishedAt: null,
    };
    const parsed = RunSchema.safeParse(run);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.workflowSnapshot.limits).toEqual({
        maxConcurrentNodes: 2,
      });
      expect(parsed.data.workflowSnapshot.nodes[0]?.retryPolicy).toEqual({
        maxRetries: 0,
      });
    }
  });

  it("validates NodeRun with artifact references and session mapping", () => {
    expect(
      NodeRunSchema.safeParse({
        id: UUID,
        runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        nodeId: "n1",
        attempt: 1,
        status: "running",
        inputRefs: [],
        outputRefs: [{ artifactId: "23452345-2345-4234-8234-234523452345" }],
        sessionId: null,
      }).success,
    ).toBe(true);
    expect(
      NodeRunSchema.safeParse({
        id: UUID,
        runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        nodeId: "n1",
        attempt: 0,
        status: "running",
        inputRefs: [],
        outputRefs: [],
        sessionId: null,
      }).success,
    ).toBe(false);
  });
});

describe("events", () => {
  const base = {
    eventId: "20000000-0000-4000-8000-000000000001",
    runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sequence: 4,
    timestamp: "2026-10-24T10:00:00Z",
  };

  it("requires terminal status changes to carry a reason", () => {
    const withReason = {
      ...base,
      type: "run.statusChanged" as const,
      payload: { from: "running", to: "succeeded", reason: "done" },
    };
    const withoutReason = {
      ...base,
      type: "run.statusChanged" as const,
      payload: { from: "running", to: "succeeded" },
    };
    expect(EventEnvelopeSchema.safeParse(withReason).success).toBe(true);
    expect(parseEventPayload(withReason).success).toBe(true);
    expect(EventEnvelopeSchema.safeParse(withoutReason).success).toBe(true);
    expect(parseEventPayload(withoutReason).success).toBe(false);
  });

  it("validates assistant.delta as a transient stream", () => {
    expect(
      AssistantDeltaSchema.safeParse({
        streamId: "stream-1",
        chunkIndex: 0,
        textDelta: "Hel",
      }).success,
    ).toBe(true);
    expect(
      AssistantDeltaSchema.safeParse({ streamId: "s", chunkIndex: -1 })
        .success,
    ).toBe(false);
  });

  it("checks sequence monotonicity", () => {
    expect(isSequenceMonotonic([])).toBe(true);
    expect(isSequenceMonotonic([{ sequence: 0 }, { sequence: 1 }])).toBe(true);
    expect(isSequenceMonotonic([{ sequence: 0 }, { sequence: 0 }])).toBe(false);
    expect(isSequenceMonotonic([{ sequence: 2 }, { sequence: 1 }])).toBe(false);
  });
});
