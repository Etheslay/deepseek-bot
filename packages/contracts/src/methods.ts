/**
 * Method boundary contract (docs/CONTRACTS.md §1, §3).
 *
 * The Host only accepts whitelisted methods; `METHODS` is that whitelist
 * and `METHOD_CONTRACTS` pins the request/response payload schemas for
 * each. Envelope size is capped at 1 MiB single-message; large artifacts
 * travel as artifact references, not inline payload.
 */
import { z } from "zod";
import {
  ApprovalSchema,
  AvatarSchema,
  BotGroupSchema,
  BotSchema,
  ImportableWorkflowDraftSchema,
  NodeRunSchema,
  RunSchema,
  ScheduleSchema,
  WorkflowDraftSchema,
  WorkflowSchema,
} from "./entities.js";
import {
  ErrorCodeSchema,
} from "./errors.js";
import {
  IsoDateTimeUtcSchema,
  NonEmptyStringSchema,
  Sha256HexSchema,
  TEXT_LIMITS,
  UuidSchema,
} from "./primitives.js";
import { RUN_STATUSES } from "./status.js";
import {
  isProtocolVersionSupported,
  PROTOCOL_VERSION,
} from "./version.js";
import {
  EventEnvelopeSchema,
} from "./events.js";
import { WorkflowIssueSchema } from "./workflow.js";
import { PERMISSION_METHODS } from "./permissions.js";

export const MAX_MESSAGE_BYTES = 1_048_576;

export function messageSizeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

export function isWithinMessageSizeLimit(value: unknown): boolean {
  return messageSizeBytes(value) <= MAX_MESSAGE_BYTES;
}

// ---------------------------------------------------------------------------
// Method whitelist
// ---------------------------------------------------------------------------

export const METHODS = [
  "bot.list",
  "bot.create",
  "bot.update",
  "bot.archive",
  "bot.batchCreate",
  "group.create",
  "group.list",
  "creation.revoke",
  "workflow.validate",
  "workflow.save",
  "workflow.export",
  "workflow.import",
  "run.start",
  "run.get",
  "run.list",
  "run.cancel",
  "run.retryNode",
  "run.resume",
  "events.subscribe",
  "approval.decide",
  "chat.send",
  "chat.history",
  "chat.cancel",
  "question.list",
  "question.answer",
  "search.config.get",
  "search.config.set",
  "search.results.list",
  "memory.list",
  "memory.write",
  "memory.delete",
  "grant.create",
  "grant.list",
  "grant.revoke",
  "policy.get",
  "policy.set",
  "tool.invoke",
  "schedule.save",
  "schedule.enable",
  "schedule.disable",
  "settings.testConnection",
  "settings.update",
  "data.backup",
  "data.restore",
  "data.describe",
  "permission.policy.list",
  "permission.policy.set",
  "permission.grant.list",
  "permission.grant.revoke",
  "permission.approval.list",
  "permission.approval.decide",
  "permission.audit.list",
] as const;

export type Method = (typeof METHODS)[number];

export const GrantSchema = z.object({
  id: UuidSchema,
  capability: z.string().min(1).max(64),
  botId: UuidSchema.nullable(),
  scope: z.enum(["once", "session", "persistent"]),
  maxUses: z.int().min(0),
  used: z.int().min(0),
  expiresAt: IsoDateTimeUtcSchema.nullable(),
  revokedAt: IsoDateTimeUtcSchema.nullable(),
  createdAt: IsoDateTimeUtcSchema,
});

export const MethodSchema = z.enum(METHODS);

export const RequestEnvelopeSchema = z.object({
  protocolVersion: z
    .string()
    .refine(isProtocolVersionSupported, {
      message: `unsupported protocolVersion; supported: ${PROTOCOL_VERSION}`,
    }),
  requestId: UuidSchema,
  method: MethodSchema,
  payload: z.unknown(),
});

export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

const BotPatchSchema = z
  .object({
    name: NonEmptyStringSchema(TEXT_LIMITS.name).optional(),
    instructions: z.string().max(TEXT_LIMITS.instructions).optional(),
    modelProfileId: UuidSchema.optional(),
    workspaceId: UuidSchema.optional(),
    toolPolicyId: UuidSchema.optional(),
    // null clears the assignment (nullish, like BotSchema's fields).
    avatar: AvatarSchema.nullish(),
    groupId: UuidSchema.nullish(),
  })
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.instructions !== undefined ||
      patch.modelProfileId !== undefined ||
      patch.workspaceId !== undefined ||
      patch.toolPolicyId !== undefined ||
      patch.avatar !== undefined ||
      patch.groupId !== undefined,
    { message: "patch must change at least one field" },
  );

const RevisionRefSchema = z.object({
  id: UuidSchema,
  expectedRevision: UuidSchema,
});

/**
 * One member of a chat-driven batch creation (FR-12). Per-bot fields fall
 * back to the batch `defaults` when omitted; explicit avatars win over
 * auto-assignment. Every effective modelProfileId/workspaceId must exist
 * (same validation as bot.create).
 */
const BotBatchEntrySchema = z.object({
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  instructions: z.string().max(TEXT_LIMITS.instructions),
  modelProfileId: UuidSchema.optional(),
  workspaceId: UuidSchema.optional(),
  toolPolicyId: UuidSchema.optional(),
  avatar: AvatarSchema.optional(),
});

const RunIdRefSchema = z.object({ runId: UuidSchema });

export const ScheduleDraftSchema = ScheduleSchema
  // id is minted server-side when absent; nextRunAt is computed by the
  // scheduler on save (D10) and must never be supplied by the caller.
  .omit({ id: true, nextRunAt: true })
  .extend({
    id: UuidSchema.optional(),
  });

/**
 * Unknown workflow schemaVersion is rejected explicitly with
 * DATA_VERSION_UNSUPPORTED instead of being imported with dropped fields.
 */
export const METHOD_CONTRACTS = {
  "bot.list": {
    request: z.object({}),
    response: z.object({ bots: z.array(BotSchema) }),
  },
  "bot.create": {
    request: z.object({
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      instructions: z.string().max(TEXT_LIMITS.instructions),
      modelProfileId: UuidSchema,
      workspaceId: UuidSchema,
      toolPolicyId: UuidSchema,
      // Explicit avatar/group at creation time (v0.2): user-specified values
      // win; batch creation is the path that auto-assigns.
      avatar: AvatarSchema.optional(),
      groupId: UuidSchema.optional(),
    }),
    response: BotSchema,
  },
  "bot.update": {
    request: z.object({
      id: UuidSchema,
      expectedRevision: UuidSchema,
      patch: BotPatchSchema,
    }),
    response: BotSchema,
  },
  "bot.archive": {
    request: RevisionRefSchema,
    response: BotSchema,
  },
  /**
   * Chat-driven batch creation (D15 write layer, FR-12): atomically creates
   * one group (newGroup) or targets an existing one (groupId — mutually
   * exclusive) plus 1–20 bots. Avatars: explicit values win; the rest get
   * distinct shape×color combinations from the canonical pool, unique among
   * the group's non-archived members (batch-only bots: unique within the
   * batch); repeats only once every combination is taken. The response
   * batchId feeds creation.revoke, which archives exactly what this call
   * created. idempotencyKey makes duplicate submissions return the first
   * batch. Drafts are separate: bot creation previews stay in-memory
   * (BotCreationDraftSchema, 不落库) until a real creation method runs.
   */
  "bot.batchCreate": {
    request: z
      .object({
        groupId: UuidSchema.optional(),
        newGroup: z
          .object({ name: NonEmptyStringSchema(TEXT_LIMITS.name) })
          .optional(),
        defaults: z
          .object({
            modelProfileId: UuidSchema.optional(),
            workspaceId: UuidSchema.optional(),
            toolPolicyId: UuidSchema.optional(),
          })
          .optional(),
        bots: z.array(BotBatchEntrySchema).min(1).max(20),
        idempotencyKey: UuidSchema.optional(),
      })
      .refine(
        (request) =>
          !(request.groupId !== undefined && request.newGroup !== undefined),
        { message: "groupId and newGroup are mutually exclusive" },
      ),
    response: z.object({
      batchId: UuidSchema,
      group: BotGroupSchema.nullable(),
      bots: z.array(BotSchema),
    }),
  },
  "group.create": {
    request: z.object({ name: NonEmptyStringSchema(TEXT_LIMITS.name) }),
    response: BotGroupSchema,
  },
  "group.list": {
    request: z.object({}),
    response: z.object({ groups: z.array(BotGroupSchema) }),
  },
  /**
   * Revoke a whole creation batch (FR-12 整批撤销): archives every
   * non-archived bot the batch created and — when the batch created the
   * group — the group as well. Revoking twice fails with INVALID_INPUT.
   */
  "creation.revoke": {
    request: z.object({ batchId: UuidSchema }),
    response: z.object({
      revokedBotIds: z.array(UuidSchema),
      revokedGroupId: UuidSchema.nullable(),
    }),
  },
  "workflow.validate": {
    request: z.object({ workflow: WorkflowDraftSchema }),
    response: z.object({
      valid: z.boolean(),
      errors: z.array(WorkflowIssueSchema),
    }),
  },
  "workflow.save": {
    request: z.object({
      workflow: WorkflowDraftSchema,
      expectedRevision: UuidSchema.optional(),
    }),
    response: WorkflowSchema,
  },
  "workflow.export": {
    request: RevisionRefSchema,
    response: z.object({
      workflow: WorkflowSchema,
      exportedAt: IsoDateTimeUtcSchema,
    }),
  },
  "workflow.import": {
    request: z.object({
      template: z.object({
        schemaVersion: z.string(),
        workflow: ImportableWorkflowDraftSchema,
      }),
    }),
    response: z.object({
      accepted: z.boolean(),
      errors: z.array(WorkflowIssueSchema),
      errorCode: ErrorCodeSchema.optional(),
    }),
  },
  "run.start": {
    request: z.object({
      workflowId: UuidSchema,
      expectedRevision: UuidSchema,
      idempotencyKey: UuidSchema,
    }),
    response: RunSchema,
  },
  "run.get": {
    request: RunIdRefSchema,
    response: RunSchema,
  },
  "run.list": {
    request: z.object({
      status: z.enum(RUN_STATUSES).optional(),
      limit: z.int().min(1).max(100).default(50),
      cursor: z.string().max(512).optional(),
    }),
    response: z.object({
      runs: z.array(RunSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  "run.cancel": {
    request: RunIdRefSchema,
    response: RunSchema,
  },
  "run.retryNode": {
    request: z.object({ nodeRunId: UuidSchema }),
    response: NodeRunSchema,
  },
  /**
   * Resume a restart-interrupted run as a new run (CONTRACTS §5, D10
   * engine.resumeRun). Additive v0.1 extension: interrupted runs were
   * otherwise unreachable through the method surface, leaving the recovery
   * leg of QA-09 without a caller.
   */
  "run.resume": {
    request: z.object({
      runId: UuidSchema,
      idempotencyKey: UuidSchema.optional(),
    }),
    response: RunSchema,
  },
  "events.subscribe": {
    request: z.object({
      runId: UuidSchema,
      afterSequence: z.int().nonnegative(),
    }),
    response: z.object({
      events: z.array(EventEnvelopeSchema),
      snapshotRequired: z.boolean(),
    }),
  },
  "approval.decide": {
    request: z.object({
      approvalId: UuidSchema,
      decision: z.enum(["approved", "denied"]),
      expectedActionDigest: Sha256HexSchema,
    }),
    response: ApprovalSchema,
  },
  "schedule.save": {
    request: z.object({ schedule: ScheduleDraftSchema }),
    response: ScheduleSchema,
  },
  "schedule.enable": {
    request: RevisionRefSchema,
    response: ScheduleSchema,
  },
  "schedule.disable": {
    request: RevisionRefSchema,
    response: ScheduleSchema,
  },
  "chat.send": {
    request: z.object({
      botId: UuidSchema,
      text: z.string().min(1).max(4000),
    }),
    response: z.object({
      sessionId: z.string().min(1).max(128),
      messageId: UuidSchema,
      text: z.string(),
      at: IsoDateTimeUtcSchema,
    }),
  },
  "chat.history": {
    request: z.object({
      botId: UuidSchema,
      limit: z.int().min(1).max(200).default(100),
    }),
    response: z.object({
      messages: z.array(
        z.object({
          id: UuidSchema,
          botId: UuidSchema,
          sessionId: z.string().min(1).max(128),
          role: z.enum(["user", "assistant"]),
          text: z.string(),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "chat.cancel": {
    request: z.object({ sessionId: z.string().min(1).max(128) }),
    response: z.object({ cancelled: z.boolean() }),
  },
  "question.list": {
    request: z.object({ botId: UuidSchema }).strict(),
    response: z.object({
      questions: z.array(
        z.object({
          requestId: UuidSchema,
          question: z.string().min(1).max(2_000),
          options: z
            .array(
              z.object({
                id: z.enum(["A", "B", "C", "D"]),
                label: z.string().min(1).max(1_000),
              }),
            )
            .min(2)
            .max(4),
          allowOther: z.boolean(),
          expiresAt: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "question.answer": {
    request: z.union([
      z
        .object({
          botId: UuidSchema,
          requestId: UuidSchema,
          optionId: z.enum(["A", "B", "C", "D"]),
        })
        .strict(),
      z
        .object({
          botId: UuidSchema,
          requestId: UuidSchema,
          text: z.string().trim().min(1).max(4_000),
        })
        .strict(),
    ]),
    response: z.object({
      requestId: UuidSchema,
      optionId: z.enum(["A", "B", "C", "D"]).optional(),
      text: z.string().min(1).max(4_000),
      messageId: UuidSchema,
      at: IsoDateTimeUtcSchema,
    }),
  },
  "search.config.get": {
    request: z.object({}).strict(),
    response: z.object({ endpoint: z.string().nullable() }),
  },
  "search.config.set": {
    request: z
      .object({
        endpoint: z.string().trim().min(1).max(2_000).nullable(),
      })
      .strict(),
    response: z.object({ endpoint: z.string().nullable() }),
  },
  "search.results.list": {
    request: z.object({ botId: UuidSchema }).strict(),
    response: z.object({
      searches: z.array(
        z.object({
          query: z.string(),
          results: z.array(
            z.object({
              title: z.string(),
              url: z.string(),
              snippet: z.string(),
            }),
          ),
          warnings: z.array(z.string()),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "memory.list": {
    request: z
      .object({
        botId: UuidSchema,
        query: z.string().trim().max(4_000).optional(),
        limit: z.int().min(1).max(50).default(20),
      })
      .strict(),
    response: z.object({
      memories: z.array(
        z.object({
          id: UuidSchema,
          botId: UuidSchema,
          text: z.string().min(1).max(4_000),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "memory.write": {
    request: z
      .object({
        botId: UuidSchema,
        text: z.string().trim().min(1).max(4_000),
      })
      .strict(),
    response: z.object({
      id: UuidSchema,
      botId: UuidSchema,
      text: z.string().min(1).max(4_000),
      at: IsoDateTimeUtcSchema,
    }),
  },
  "memory.delete": {
    request: z
      .object({
        botId: UuidSchema,
        memoryId: UuidSchema,
      })
      .strict(),
    response: z.object({ deleted: z.literal(true) }),
  },
  "grant.create": {
    request: z.object({
      capability: z.string().min(1).max(64),
      botId: UuidSchema.nullable().optional(),
      scope: z.enum(["once", "session", "persistent"]),
      maxUses: z.int().min(0).max(1000).optional(),
      expiresInSeconds: z.int().min(60).max(604800).nullable().optional(),
    }),
    response: GrantSchema,
  },
  "grant.list": {
    request: z.object({ capability: z.string().min(1).max(64).optional() }),
    response: z.object({ grants: z.array(GrantSchema) }),
  },
  "grant.revoke": {
    request: z.object({ id: UuidSchema }),
    response: z.object({ revoked: z.boolean() }),
  },
  "policy.get": {
    request: z.object({}),
    response: z.object({
      policies: z.record(z.string(), z.enum(["always", "ask", "never"])),
    }),
  },
  "policy.set": {
    request: z.object({
      capability: z.string().min(1).max(64),
      policy: z.enum(["always", "ask", "never"]),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  "tool.invoke": {
    request: z.object({
      tool: z.string().min(1).max(64),
      params: z.record(z.string(), z.unknown()).optional(),
      callerBotId: UuidSchema.optional(),
    }),
    response: z.object({ result: z.unknown() }),
  },
  "settings.testConnection": {
    request: z.object({
      modelProfile: z.object({
        provider: z.literal("deepseek"),
        model: NonEmptyStringSchema(TEXT_LIMITS.label),
        endpoint: z.url().refine((value) => value.startsWith("https://"), {
          message: "endpoint must use https",
        }),
      }),
    }),
    response: z.object({
      ok: z.boolean(),
      latencyMs: z.int().nonnegative().optional(),
      errorCode: ErrorCodeSchema.optional(),
    }),
  },
  "settings.update": {
    request: z.object({
      patch: z.record(z.string(), z.unknown()),
    }),
    response: z.object({ configured: z.boolean() }),
  },
  "data.backup": {
    request: z.object({}),
    response: z.object({
      backupId: UuidSchema,
      createdAt: IsoDateTimeUtcSchema,
      sizeBytes: z.int().nonnegative(),
    }),
  },
  "data.restore": {
    request: z.object({ backupId: UuidSchema }),
    response: z.object({ restored: z.literal(true) }),
  },
  "data.describe": {
    request: z.object({}),
    response: z.object({
      schemaVersion: z.string(),
      counts: z.record(z.string(), z.int()),
    }),
  },
  ...PERMISSION_METHODS,
} as const satisfies Record<
  Method,
  { request: z.ZodType; response: z.ZodType }
>;

export type MethodRequest<M extends Method> = z.output<
  (typeof METHOD_CONTRACTS)[M]["request"]
>;

export type MethodResponse<M extends Method> = z.output<
  (typeof METHOD_CONTRACTS)[M]["response"]
>;

export function methodContract(method: Method): {
  request: z.ZodType;
  response: z.ZodType;
} {
  return METHOD_CONTRACTS[method];
}

/**
 * Validate a request envelope and its payload against the method contract.
 * Size and protocol-version checks run before payload parsing so oversized
 * or incompatible messages fail fast. Returns plain issue objects so both
 * parties can serialize failures without depending on zod internals.
 */
export type RequestParseIssue = {
  path: string[];
  message: string;
};

export type RequestParseResult<M extends Method> =
  | {
      success: true;
      requestId: string;
      method: M;
      payload: MethodRequest<M>;
    }
  | {
      success: false;
      issues: RequestParseIssue[];
    };

function issuesOf(result: {
  success: boolean;
  error?: z.ZodError<unknown>;
}): { success: false; issues: RequestParseIssue[] } {
  return {
    success: false,
    issues: (result.error?.issues ?? []).map((issue) => ({
      path: issue.path.map((segment) => String(segment)),
      message: issue.message,
    })),
  };
}

export function parseRequest<M extends Method>(
  envelope: unknown,
  expectedMethod: M,
): RequestParseResult<M> {
  const envelopeResult = RequestEnvelopeSchema.safeParse(envelope);
  if (!envelopeResult.success) {
    return issuesOf(envelopeResult);
  }
  const parsed = envelopeResult.data;
  if (parsed.method !== expectedMethod) {
    return {
      success: false,
      issues: [
        {
          path: ["method"],
          message: `expected method ${expectedMethod}, received ${parsed.method}`,
        },
      ],
    };
  }
  if (!isWithinMessageSizeLimit(parsed.payload)) {
    return {
      success: false,
      issues: [
        {
          path: ["payload"],
          message: `payload exceeds the ${MAX_MESSAGE_BYTES} byte message limit`,
        },
      ],
    };
  }
  const payloadResult = methodContract(expectedMethod).request.safeParse(
    parsed.payload,
  );
  if (!payloadResult.success) {
    return issuesOf(payloadResult);
  }
  return {
    success: true,
    requestId: parsed.requestId,
    method: expectedMethod,
    payload: payloadResult.data as MethodRequest<M>,
  };
}

