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
  "workflow.validate",
  "workflow.save",
  "workflow.export",
  "workflow.import",
  "run.start",
  "run.get",
  "run.list",
  "run.cancel",
  "run.retryNode",
  "events.subscribe",
  "approval.decide",
  "schedule.save",
  "schedule.enable",
  "schedule.disable",
  "settings.testConnection",
  "settings.update",
  "data.backup",
  "data.restore",
  "data.describe",
] as const;

export type Method = (typeof METHODS)[number];

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
  })
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.instructions !== undefined ||
      patch.modelProfileId !== undefined ||
      patch.workspaceId !== undefined ||
      patch.toolPolicyId !== undefined,
    { message: "patch must change at least one field" },
  );

const RevisionRefSchema = z.object({
  id: UuidSchema,
  expectedRevision: UuidSchema,
});

const RunIdRefSchema = z.object({ runId: UuidSchema });

export const ScheduleDraftSchema = ScheduleSchema.omit({ id: true }).extend({
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
