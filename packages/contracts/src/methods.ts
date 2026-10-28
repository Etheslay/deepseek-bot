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
  ArtifactVersionSchema,
  AvatarSchema,
  BotArtifactSchema,
  BotGroupSchema,
  BotRoleSchema,
  BotSchema,
    ChatMessageMetaSchema,
    ConnectorKindSchema,
    McpAllowedToolsSchema,
    McpServerGrantSchema,
    McpToolSchema,
  ImportableWorkflowDraftSchema,
  NodeRunSchema,
  RunSchema,
  ScheduleSchema,
  TASK_CHAIN_MAX,
  TaskSchema,
  WorkflowDraftSchema,
  WorkflowSchema,
} from "./entities.js";
import {
  ErrorCodeSchema,
} from "./errors.js";
import {
  IsoDateTimeUtcSchema,
  MediaTypeSchema,
  NonEmptyStringSchema,
  RelativeArtifactPathSchema,
  Sha256HexSchema,
  TEXT_LIMITS,
  UuidSchema,
} from "./primitives.js";
import { RUN_STATUSES, TASK_STATUSES } from "./status.js";
import {
  isProtocolVersionSupported,
  PROTOCOL_VERSION,
} from "./version.js";
import {
  EventEnvelopeSchema,
  TaskEventEnvelopeSchema,
} from "./events.js";
import { WorkflowIssueSchema } from "./workflow.js";
import { CapabilityIdSchema, PERMISSION_METHODS } from "./permissions.js";
import { SCREEN_METHODS } from "./screen.js";
import { DEVICE_METHODS } from "./device.js";
import { VOICE_METHODS } from "./voice.js";
import { USAGE_METHODS } from "./usage.js";

export const MAX_MESSAGE_BYTES = 1_048_576;

/**
 * Largest artifact content one `artifacts.save`/`artifacts.read` payload may
 * carry, in UTF-8 bytes (D28). The method-boundary envelope caps a single
 * message at 1 MiB of JSON, and JSON escaping can roughly double the wire
 * size of text with many newlines/quotes, so the content budget stays well
 * under the envelope to keep save calls deliverable. Larger workspace files
 * stay listable and versionable but refuse inline reads/saves with an
 * explicit error — never a silent truncation.
 */
export const MAX_ARTIFACT_CONTENT_BYTES = 768 * 1024;
/** Chat attachment bytes. One gateway import, staged in chunks under the 1 MiB envelope. */
export const MAX_CHAT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_CHUNK_RAW_BYTES = 192 * 1024;

/**
 * One chat attachment may carry at most 2 MiB of file bytes (D26). Bytes ride
 * chunked `attachment.*` calls because a single envelope stays capped at 1 MiB.
 */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
/** One `attachment.append` chunk carries at most 512 KiB of decoded bytes. */
export const MAX_ATTACHMENT_CHUNK_BYTES = 512 * 1024;

/**
 * Skills injected on one `chat.send` (D17). Optional inside protocol 0.8:
 * older senders omit the field. The export-file schema stays free-form;
 * only these capability ids are enforced on a turn.
 */
export const MAX_CHAT_SKILLS = 30;
export const MAX_CHAT_SKILL_INSTRUCTIONS = 4_000;
export const MAX_CHAT_SKILL_CAPABILITIES = 16;

export const ChatSkillInjectionSchema = z
  .object({
    name: NonEmptyStringSchema(TEXT_LIMITS.name),
    version: z.number().int().min(1).max(1_000_000),
    instructions: NonEmptyStringSchema(MAX_CHAT_SKILL_INSTRUCTIONS),
    capabilities: z.array(CapabilityIdSchema).max(MAX_CHAT_SKILL_CAPABILITIES),
  })
  .strict()
  .refine(
    (skill) => new Set(skill.capabilities).size === skill.capabilities.length,
    "capabilities must be unique",
  );
export type ChatSkillInjection = z.infer<typeof ChatSkillInjectionSchema>;

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
  "workflow.list",
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
  "chat.attach",
  "chat.history",
  "chat.cancel",
  "chat.status",
  "task.dispatch",
  "task.list",
  "task.cancel",
  "question.list",
  "question.answer",
  "search.config.get",
  "search.config.set",
  "search.results.list",
  "search.global",
  "attachment.begin",
  "attachment.append",
  "attachment.commit",
  "memory.list",
  "memory.write",
  "memory.delete",
  "memory.retention.get",
  "memory.retention.set",
  "knowledge.list",
  "knowledge.write",
  "knowledge.delete",
  "knowledge.search",
  "connector.list",
  "connector.register",
  "connector.enable",
  "connector.disable",
  "connector.setEndpoint",
  "connector.setCommand",
  "connector.mcp.discover",
  "connector.mcp.grants.get",
  "connector.mcp.grants.set",
  "artifacts.list",
  "artifacts.read",
  "artifacts.save",
  "artifacts.versions",
  "artifacts.versionContent",
  "artifacts.revert",
  "trigger.list",
  "trigger.save",
  "trigger.enable",
  "trigger.disable",
  "trigger.delete",
  "trigger.firing.list",
  "trigger.firing.decide",
  "eventRule.list",
  "eventRule.save",
  "eventRule.enable",
  "eventRule.disable",
  "eventRule.record.list",
  "eventRule.review",
  "eventRule.review.list",
  "eventRule.review.approve",
  "eventRule.review.deny",
  "eventRule.state.list",
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
  "permission.grant.issue",
  "permission.approval.list",
  "permission.approval.decide",
  "permission.audit.list",
  "screen.status",
  "screen.windows.list",
  "screen.target.set",
  "screen.request",
  "screen.cancel",
  "screen.results.list",
  "screen.result.read",
  "screen.result.delete",
  "device.action.request",
  "device.action.list",
  "device.action.input",
  "device.action.input.list",
  "voice.status",
  "voice.transcribe",
  "voice.speak",
  "voice.config.get",
  "voice.config.set",
  "usage.summary",
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
    // v0.5 coordinator role: written only through the human editor surface
    // (bot.create/bot.update); no model tool binds a role field (FR-9).
    role: BotRoleSchema.optional(),
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
      patch.role !== undefined ||
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
 * (same validation as bot.create). Strict on purpose: a model must never be
 * able to smuggle privileged fields (e.g. the v0.5 coordinator `role`) into
 * a batch entry — unknown keys reject instead of being stripped (U2).
 */
const BotBatchEntrySchema = z
  .object({
    name: NonEmptyStringSchema(TEXT_LIMITS.name),
    instructions: z.string().max(TEXT_LIMITS.instructions),
    modelProfileId: UuidSchema.optional(),
    workspaceId: UuidSchema.optional(),
    toolPolicyId: UuidSchema.optional(),
    avatar: AvatarSchema.optional(),
  })
  .strict();

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
const connectorTransportFields = {
  kind: ConnectorKindSchema.optional(),
  credentialRef: z.string().nullable(),
  endpoint: z.string().nullable(),
  /** Bare name or absolute path. Null unless the connector is mcp-stdio. */
  command: z.string().nullable().optional(),
  args: z.array(z.string().max(1024)).max(32).nullable().optional(),
  /** Env var that receives the resolved secret. Never the secret itself. */
  credentialEnv: z.string().nullable().optional(),
  at: IsoDateTimeUtcSchema,
  updatedAt: IsoDateTimeUtcSchema,
};

function connectorResponse<T extends z.ZodType>(enabled: T) {
  return z.object({
    id: UuidSchema,
    name: NonEmptyStringSchema(TEXT_LIMITS.name),
    enabled,
    ...connectorTransportFields,
  });
}

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
      // v0.5: human editor may mint a coordinator directly; the model-facing
      // batch path (bot.batchCreate) never carries a role field.
      role: BotRoleSchema.optional(),
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
  /**
   * Workflow summaries for pickers (D20 automation panel). Metadata only —
   * full documents stay behind workflow.get-style editor flows; summaries
   * keep any library size under the 1 MiB message cap.
   */
  "workflow.list": {
    request: z.object({}).strict(),
    response: z.object({
      workflows: z.array(
        z.object({
          id: UuidSchema,
          name: NonEmptyStringSchema(TEXT_LIMITS.name),
          revision: UuidSchema,
        }),
      ),
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
  /**
   * v0.5 extends the pull subscription to dispatched tasks: exactly one of
   * runId/taskId must be supplied. Run events replay the persistent events
   * log; task events replay the task_events log with the same at-least-once
   * dedup semantics (eventId + per-subject sequence).
   */
  "events.subscribe": {
    request: z
      .object({
        runId: UuidSchema.optional(),
        taskId: UuidSchema.optional(),
        afterSequence: z.int().nonnegative(),
      })
      .refine(
        (request) =>
          (request.runId !== undefined) !== (request.taskId !== undefined),
        { message: "exactly one of runId or taskId is required" },
      ),
    response: z.object({
      events: z.array(EventEnvelopeSchema),
      taskEvents: z.array(TaskEventEnvelopeSchema).optional(),
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
  /**
   * `skills` is the saved skill snapshot for this turn. The Host injects the
   * instructions into the prompt and, when any capability id is present, the
   * tool gateway allows only tools those ids cover. Omitted or empty means
   * no skill constraint. This does not grant capabilities.
   */
  "chat.send": {
    request: z.object({
      botId: UuidSchema,
      text: z.string().min(1).max(4000),
      skills: z.array(ChatSkillInjectionSchema).max(MAX_CHAT_SKILLS).optional(),
    }),
    response: z.object({
      sessionId: z.string().min(1).max(128),
      messageId: UuidSchema,
      text: z.string(),
      at: IsoDateTimeUtcSchema,
    }),
  },
  /**
   * Stage one chunk of a chat attachment, then import it through the tool
   * gateway once every chunk is present. The gateway call is `import_attachment`
   * (`fs.write`): default ask, so a grant or an approval is required before
   * any workspace write. `data` is the chunk only; the approval preview stores
   * the name, media type, size and checksum.
   */
  "chat.attach": {
    request: z
      .object({
        botId: UuidSchema,
        uploadId: UuidSchema,
        name: z.string().min(1).max(200),
        mediaType: MediaTypeSchema,
        size: z.int().min(1).max(MAX_CHAT_ATTACHMENT_BYTES),
        checksum: Sha256HexSchema,
        index: z.int().min(0).max(15),
        count: z.int().min(1).max(16),
        data: z.string().min(4).max(270_000),
      })
      .strict()
      .refine((chunk) => chunk.index < chunk.count, "chunk index is outside the file"),
    response: z.discriminatedUnion("status", [
      z.object({ status: z.literal("staged"), received: z.int().min(1).max(16) }).strict(),
      z
        .object({
          status: z.literal("imported"),
          relativePath: RelativeArtifactPathSchema,
          mediaType: MediaTypeSchema,
          size: z.int().min(1).max(MAX_CHAT_ATTACHMENT_BYTES),
          checksum: Sha256HexSchema,
        })
        .strict(),
    ]),
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
          // v0.5: dispatch markers and task delivery notices (optional so
          // pre-0.5 rows and callers keep parsing unchanged).
          meta: ChatMessageMetaSchema.optional(),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "chat.cancel": {
    request: z.object({ sessionId: z.string().min(1).max(128) }),
    response: z.object({ cancelled: z.boolean() }),
  },
  /**
   * Live progress of a bot's chat turn, polled by the renderer while a reply
   * is pending. Stages come from real harness session events only — the
   * receipt means the model is generating ("thinking"), a tool/call names the
   * tool now executing — so the UI never invents activity it did not see.
   */
  "chat.status": {
    request: z.object({ botId: UuidSchema }),
    response: z.object({
      active: z.boolean(),
      stage: z.enum(["idle", "preparing", "thinking", "tool"]),
      toolName: z.string().min(1).max(64).optional(),
      startedAt: IsoDateTimeUtcSchema.optional(),
    }),
  },
  /**
   * v0.5 manager orchestration (TASK_MANAGER_ORCHESTRATION.md §3.3).
   * task.dispatch is gateway-internal: only the model tool `dispatch_task`
   * reaches it, and the Host re-checks the coordinator rules (role, same
   * group, not self) before enqueueing — the gateway layer check explains
   * the rejection to the model, this one is authoritative. task.list is the
   * human + read-only-tool query surface; task.cancel is human-only (queued
   * tasks cancel directly, running tasks ride the chat cancel path; queued
   * hops of the same relay chain are cascaded, T7 R-13.5).
   *
   * T7 relay chain: `chain` pre-declares the downstream hops. The chain is
   * validated as a simple path (no repeated botId, no self-reference) of
   * same-group live bots; total hops including this dispatch are capped at
   * TASK_CHAIN_MAX. One approval on this call covers the whole chain
   * (R-13.1), and every hop is revalidated before execution (R-13.6).
   */
  "task.dispatch": {
    request: z
      .object({
        fromBotId: UuidSchema,
        toBotId: UuidSchema,
        task: z.string().trim().min(1).max(8_000),
        context: z.string().min(1).max(4_000).optional(),
        chain: z
          .array(
            z.object({
              botId: UuidSchema,
              instruction: z.string().trim().min(1).max(8_000),
            }),
          )
          .max(TASK_CHAIN_MAX - 1)
          .optional(),
      })
      .strict()
      .refine((request) => request.fromBotId !== request.toBotId, {
        message: "a coordinator cannot dispatch a task to itself",
      })
      .refine(
        (request) => {
          const ids = [request.fromBotId, request.toBotId].concat(
            (request.chain ?? []).map((hop) => hop.botId),
          );
          return new Set(ids).size === ids.length;
        },
        { message: "relay chain botIds must form a simple path (no repeats)" },
      ),
    response: TaskSchema,
  },
  "task.list": {
    request: z
      .object({
        fromBotId: UuidSchema.optional(),
        toBotId: UuidSchema.optional(),
        rootTaskId: UuidSchema.optional(),
        status: z.enum(TASK_STATUSES).optional(),
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z.object({ tasks: z.array(TaskSchema) }),
  },
  "task.cancel": {
    request: z.object({ taskId: UuidSchema }).strict(),
    response: TaskSchema,
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
  /**
   * D25 host-side global search (trusted desktop). One literal-substring
   * query fans out over bot names, workflow names, persisted chat messages
   * and artifact paths across all bots. Results carry no file paths, no
   * message bodies beyond the bounded snippet, and no grant or approval
   * records; opening a hit routes through the existing per-bot methods.
   */
  "search.global": {
    request: z
      .object({
        query: NonEmptyStringSchema(200),
        limit: z.int().min(1).max(50).default(20),
      })
      .strict(),
    response: z.object({
      results: z
        .array(
          z
            .object({
              kind: z.enum(["bot", "workflow", "message", "artifact"]),
              id: UuidSchema,
              botId: UuidSchema.nullable(),
              title: NonEmptyStringSchema(200),
              snippet: z.string().max(400).nullable(),
              at: IsoDateTimeUtcSchema.nullable(),
            })
            .strict(),
        )
        .max(200),
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
  /**
   * D18 retention policy for memory notes and knowledge docs. Zero means
   * "keep everything" (the default) — a broken stored value reads as zero
   * so a corrupt setting can never widen deletion. Applied at host start
   * and after every write.
   */
  "memory.retention.get": {
    request: z.object({}).strict(),
    response: z.object({
      policy: z.object({
        /** Days a memory note stays; 0 keeps it until deleted by hand. */
        retentionDays: z.int().min(0),
        /** Newest N memory notes kept per bot; 0 is unlimited. */
        memoryMaxPerBot: z.int().min(0),
        /** Newest N knowledge docs kept per bot; 0 is unlimited. */
        knowledgeMaxPerBot: z.int().min(0),
      }),
    }),
  },
  "memory.retention.set": {
    request: z.object({
      policy: z.object({
        retentionDays: z.int().min(0).max(36_500),
        memoryMaxPerBot: z.int().min(0).max(100_000),
        knowledgeMaxPerBot: z.int().min(0).max(10_000),
      }),
    }),
    response: z.object({
      policy: z.object({
        retentionDays: z.int().min(0),
        memoryMaxPerBot: z.int().min(0),
        knowledgeMaxPerBot: z.int().min(0),
      }),
    }),
  },
  /**
   * D18 knowledge documents (独立知识表): per-bot long-form text, separate
   * from the 4k memory notes. list returns summaries (no text) so a full
   * library stays under the 1 MiB message cap; search ranks windows by
   * local TF-IDF cosine with an exact-phrase bonus and returns bounded
   * snippets. Deletion and visibility are bot-scoped like memory.
   */
  "knowledge.list": {
    request: z.object({ botId: UuidSchema }).strict(),
    response: z.object({
      docs: z.array(
        z.object({
          id: UuidSchema,
          botId: UuidSchema,
          title: NonEmptyStringSchema(TEXT_LIMITS.name),
          size: z.int().min(1),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "attachment.begin": {
    request: z
      .object({
        botId: UuidSchema,
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine(
            // eslint-disable-next-line no-control-regex -- attachment names must not carry control characters
            (value) => !/[\\/]/.test(value) && !/[\u0000-\u001f\u007f]/.test(value),
            {
              message: "attachment name must be a single path segment",
            },
          )
          .refine((value) => !value.startsWith("."), {
            message: "attachment name must not start with a dot",
          }),
        size: z.int().min(1).max(MAX_ATTACHMENT_BYTES),
        sha256: Sha256HexSchema,
      })
      .strict(),
    response: z.object({ uploadId: UuidSchema }).strict(),
  },
  "attachment.append": {
    request: z
      .object({
        uploadId: UuidSchema,
        chunkBase64: z
          .string()
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, "expected standard base64")
          .min(4)
          .max(700_000),
      })
      .strict(),
    response: z.object({ received: z.int().nonnegative() }).strict(),
  },
  "attachment.commit": {
    request: z.object({ uploadId: UuidSchema }).strict(),
    response: z
      .object({
        botId: UuidSchema,
        path: z.string().min(1).max(1024),
        size: z.int().min(1),
        checksum: Sha256HexSchema,
      })
      .strict(),
  },
  "knowledge.write": {
    request: z.object({
      botId: UuidSchema,
      title: z.string().trim().min(1).max(TEXT_LIMITS.name),
      text: z.string().trim().min(1).max(TEXT_LIMITS.knowledgeText),
    }).strict(),
    response: z.object({
      id: UuidSchema,
      botId: UuidSchema,
      title: NonEmptyStringSchema(TEXT_LIMITS.name),
      size: z.int().min(1),
      at: IsoDateTimeUtcSchema,
    }),
  },
  "knowledge.delete": {
    request: z
      .object({
        botId: UuidSchema,
        docId: UuidSchema,
      })
      .strict(),
    response: z.object({ deleted: z.literal(true) }),
  },
  "knowledge.search": {
    request: z
      .object({
        botId: UuidSchema,
        query: z.string().trim().min(1).max(2_000),
        limit: z.int().min(1).max(10).default(5),
      })
      .strict(),
    response: z.object({
      hits: z.array(
        z.object({
          docId: UuidSchema,
          title: NonEmptyStringSchema(TEXT_LIMITS.name),
          /** Ranked similarity, capped at 1. Unranked (score 0) never returns. */
          score: z.number().min(0).max(1),
          snippet: z.string().min(1).max(400),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  /**
   * Trusted desktop catalog. Registration always starts disabled.
   * credentialRef is an opaque cred:<uuid> reference. These methods store it
   * and do not resolve or contact the connector. Resolution happens only when
   * a later MCP discover or call injects the secret. ToolPolicy.mcp is a
   * separate gate.
   */
  "connector.list": {
    request: z.object({}).strict(),
    response: z.object({
      connectors: z.array(connectorResponse(z.boolean())),
    }),
  },
  "connector.register": {
    request: z
      .object({
        name: z.string().trim().min(1).max(TEXT_LIMITS.name),
        kind: ConnectorKindSchema.default("sd-webui"),
        credentialRef: z.string().trim().min(1).max(TEXT_LIMITS.label).nullable().optional(),
        // Loopback http(s) URL of the local service (D19); validated by the
        // Host before storage, never contacted at registration time.
        endpoint: z.string().trim().max(2048).nullable().optional(),
        command: z.string().trim().min(1).max(1024).nullable().optional(),
        args: z.array(z.string().max(1024)).max(32).optional(),
        credentialEnv: z.string().trim().min(1).max(64).nullable().optional(),
      })
      .strict(),
    response: connectorResponse(z.literal(false)),
  },
  "connector.enable": {
    request: z.object({ id: UuidSchema }).strict(),
    response: connectorResponse(z.literal(true)),
  },
  "connector.disable": {
    request: z.object({ id: UuidSchema }).strict(),
    response: connectorResponse(z.literal(false)),
  },
  /**
   * D19: set or clear the loopback http(s) endpoint of a local connector.
   * The Host validates the URL shape (http/https, loopback host only)
   * before storage and never contacts the endpoint here.
   */
  "connector.setEndpoint": {
    request: z.object({
      id: UuidSchema,
      endpoint: z.string().trim().max(2048).nullable(),
    }).strict(),
    response: connectorResponse(z.boolean()),
  },
  /**
   * Replace the local stdio command. The Host checks the executable shape
   * and does not spawn it here. Arguments are a list, never a shell string.
   */
  "connector.setCommand": {
    request: z
      .object({
        id: UuidSchema,
        command: z.string().trim().min(1).max(1024),
        args: z.array(z.string().max(1024)).max(32).default([]),
      })
      .strict(),
    response: connectorResponse(z.boolean()),
  },
  /** Trusted control plane only; Host implementation follows this contract. */
  "connector.mcp.discover": {
    request: z.object({ id: UuidSchema }).strict(),
    response: z.object({ tools: z.array(McpToolSchema).max(200), at: IsoDateTimeUtcSchema }),
  },
  "connector.mcp.grants.get": {
    request: z.object({ botId: UuidSchema }).strict(),
    response: z.object({ servers: z.array(McpServerGrantSchema).max(50) }),
  },
  "connector.mcp.grants.set": {
    request: z.object({ botId: UuidSchema, id: UuidSchema, allowedTools: McpAllowedToolsSchema }).strict(),
    response: z.object({ servers: z.array(McpServerGrantSchema).max(50) }),
  },
  /**
   * D28 co-edit sidecar: artifacts are the editable files of one bot's
   * workspace directory, addressed by (botId, relativePath). list/read
   * reconcile unrecorded workspace changes as "bot" versions, so the version
   * trail covers bot writes that bypass every method call. text/html and
   * binary media stay listed but refuse inline content (kind "blocked") —
   * QA-14: user-facing surfaces never execute embedded scripts. Saves and
   * reverts always append a version (author "user"); reverts never rewrite
   * history. expectedChecksum on save is optimistic concurrency against a
   * concurrent bot write (REVISION_CONFLICT).
   */
  "artifacts.list": {
    request: z.object({ botId: UuidSchema }).strict(),
    response: z.object({ artifacts: z.array(BotArtifactSchema) }),
  },
  "artifacts.read": {
    request: z
      .object({ botId: UuidSchema, path: RelativeArtifactPathSchema })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        mediaType: MediaTypeSchema,
        checksum: BotArtifactSchema.shape.checksum,
        content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES),
      }),
      z.object({ kind: z.literal("blocked"), mediaType: MediaTypeSchema, reason: z.string().min(1).max(2_000) }),
    ]),
  },
  "artifacts.save": {
    request: z
      .object({
        botId: UuidSchema,
        path: RelativeArtifactPathSchema,
        content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES),
        /** sha256 of the version the edit started from; omit for blind saves. */
        expectedChecksum: Sha256HexSchema.optional(),
      })
      .strict(),
    response: z.object({ artifact: BotArtifactSchema, version: ArtifactVersionSchema }),
  },
  "artifacts.versions": {
    request: z
      .object({ botId: UuidSchema, path: RelativeArtifactPathSchema })
      .strict(),
    response: z.object({ versions: z.array(ArtifactVersionSchema) }),
  },
  "artifacts.versionContent": {
    request: z
      .object({ botId: UuidSchema, path: RelativeArtifactPathSchema, versionId: UuidSchema })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        mediaType: MediaTypeSchema,
        content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES),
      }),
      z.object({ kind: z.literal("blocked"), mediaType: MediaTypeSchema, reason: z.string().min(1).max(2_000) }),
    ]),
  },
  "artifacts.revert": {
    request: z
      .object({ botId: UuidSchema, path: RelativeArtifactPathSchema, versionId: UuidSchema })
      .strict(),
    response: z.object({ artifact: BotArtifactSchema, version: ArtifactVersionSchema }),
  },
  /**
   * D20 event automation (FR-17). A rule watches the persisted event stream
   * for one event type (optionally scoped to a source workflow) and enqueues
   * a FIRING for human review — nothing auto-starts. Protections: firings
   * are unique per (rule, source event) so one event fires once; runs the
   * review queue itself started never enqueue new firings (loop guard);
   * events that accumulated before the host could evaluate them are
   * enqueued with reason "missed" — visible, never silently replayed.
   */
  "trigger.list": {
    request: z.object({}).strict(),
    response: z.object({
      rules: z.array(
        z.object({
          id: UuidSchema,
          name: NonEmptyStringSchema(TEXT_LIMITS.name),
          workflowId: UuidSchema,
          eventType: z.enum(["run.failed", "run.completed"]),
          filterWorkflowId: UuidSchema.nullable(),
          enabled: z.boolean(),
          at: IsoDateTimeUtcSchema,
          updatedAt: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "trigger.save": {
    request: z.object({
      rule: z.object({
        id: UuidSchema.optional(),
        name: z.string().trim().min(1).max(TEXT_LIMITS.name),
        workflowId: UuidSchema,
        eventType: z.enum(["run.failed", "run.completed"]),
        filterWorkflowId: UuidSchema.nullable().optional(),
      }),
    }),
    response: z.object({
      id: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      filterWorkflowId: UuidSchema.nullable(),
      enabled: z.boolean(),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "trigger.enable": {
    request: z.object({ id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      filterWorkflowId: UuidSchema.nullable(),
      enabled: z.literal(true),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "trigger.disable": {
    request: z.object({ id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      filterWorkflowId: UuidSchema.nullable(),
      enabled: z.literal(false),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "trigger.delete": {
    request: z.object({ id: UuidSchema }).strict(),
    response: z.object({ deleted: z.literal(true) }),
  },
  "trigger.firing.list": {
    request: z
      .object({
        status: z.enum(["pending", "approved", "dismissed"]).optional(),
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z.object({
      firings: z.array(
        z.object({
          id: UuidSchema,
          ruleId: UuidSchema,
          ruleName: NonEmptyStringSchema(TEXT_LIMITS.name),
          workflowId: UuidSchema,
          eventType: z.enum(["run.failed", "run.completed"]),
          sourceRunId: UuidSchema.nullable(),
          reason: z.enum(["event", "missed"]),
          status: z.enum(["pending", "approved", "dismissed"]),
          at: IsoDateTimeUtcSchema,
          decidedAt: IsoDateTimeUtcSchema.nullable(),
        }),
      ),
    }),
  },
  "trigger.firing.decide": {
    request: z.object({
      firingId: UuidSchema,
      decision: z.enum(["start", "dismiss"]),
    }).strict(),
    response: z.object({
      firing: z.object({
        id: UuidSchema,
        status: z.enum(["pending", "approved", "dismissed"]),
        decidedAt: IsoDateTimeUtcSchema.nullable(),
      }),
      runId: UuidSchema.nullable(),
    }),
  },
  /**
   * Local event rules for one bot (D20). Trusted desktop methods, not model
   * tools. A new rule is off and does not require review. An enabled rule
   * starts one run for one matching local event, unless `eventRule.review`
   * was called: then the event becomes one pending item and no run starts
   * until `eventRule.review.approve`. Deny records a skip and starts
   * nothing. The same event cannot enqueue or start twice. A disabled rule
   * records a skip and does not enter the queue. Enabling, disabling, or
   * switching a rule to review appends one local state row when that flag
   * changes; a repeat call that leaves the flag as it is appends nothing.
   * `eventRule.state.list` returns those rows for one bot, newest first.
   * Nothing in this group opens a network connection or a remote relay.
   * `trigger.*` is unchanged.
   */
  "eventRule.list": {
    request: z.object({ botId: UuidSchema }).strict(),
    response: z.object({
      rules: z.array(
        z.object({
          id: UuidSchema,
          botId: UuidSchema,
          name: NonEmptyStringSchema(TEXT_LIMITS.name),
          workflowId: UuidSchema,
          eventType: z.enum(["run.failed", "run.completed"]),
          enabled: z.boolean(),
          review: z.boolean(),
          at: IsoDateTimeUtcSchema,
          updatedAt: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "eventRule.save": {
    request: z
      .object({
        botId: UuidSchema,
        rule: z
          .object({
            id: UuidSchema.optional(),
            name: z.string().trim().min(1).max(TEXT_LIMITS.name),
            workflowId: UuidSchema,
            eventType: z.enum(["run.failed", "run.completed"]),
          })
          .strict(),
      })
      .strict(),
    response: z.object({
      id: UuidSchema,
      botId: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      enabled: z.boolean(),
      review: z.boolean(),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "eventRule.enable": {
    request: z.object({ botId: UuidSchema, id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      botId: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      enabled: z.literal(true),
      review: z.boolean(),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "eventRule.disable": {
    request: z.object({ botId: UuidSchema, id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      botId: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      enabled: z.literal(false),
      review: z.boolean(),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "eventRule.record.list": {
    request: z
      .object({
        botId: UuidSchema,
        ruleId: UuidSchema.optional(),
        outcome: z.enum(["started", "duplicate", "skipped"]).optional(),
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z.object({
      records: z.array(
        z.object({
          id: UuidSchema,
          ruleId: UuidSchema,
          eventId: UuidSchema,
          outcome: z.enum(["started", "duplicate", "skipped"]),
          runId: UuidSchema.nullable(),
          reason: z.string().min(1).max(500),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "eventRule.review": {
    request: z.object({ botId: UuidSchema, id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      botId: UuidSchema,
      name: NonEmptyStringSchema(TEXT_LIMITS.name),
      workflowId: UuidSchema,
      eventType: z.enum(["run.failed", "run.completed"]),
      enabled: z.boolean(),
      review: z.literal(true),
      at: IsoDateTimeUtcSchema,
      updatedAt: IsoDateTimeUtcSchema,
    }),
  },
  "eventRule.review.list": {
    request: z
      .object({
        botId: UuidSchema,
        ruleId: UuidSchema.optional(),
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z.object({
      items: z.array(
        z.object({
          id: UuidSchema,
          ruleId: UuidSchema,
          eventId: UuidSchema,
          status: z.literal("pending"),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
  },
  "eventRule.review.approve": {
    request: z.object({ botId: UuidSchema, id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      ruleId: UuidSchema,
      eventId: UuidSchema,
      status: z.literal("approved"),
      runId: UuidSchema,
      at: IsoDateTimeUtcSchema,
      decidedAt: IsoDateTimeUtcSchema,
    }),
  },
  "eventRule.review.deny": {
    request: z.object({ botId: UuidSchema, id: UuidSchema }).strict(),
    response: z.object({
      id: UuidSchema,
      ruleId: UuidSchema,
      eventId: UuidSchema,
      status: z.literal("denied"),
      runId: z.null(),
      at: IsoDateTimeUtcSchema,
      decidedAt: IsoDateTimeUtcSchema,
    }),
  },
  "eventRule.state.list": {
    request: z
      .object({
        botId: UuidSchema,
        limit: z.int().min(1).max(100).default(50),
      })
      .strict(),
    response: z.object({
      states: z.array(
        z.object({
          id: UuidSchema,
          ruleId: UuidSchema,
          botId: UuidSchema,
          state: z.enum(["enabled", "disabled", "review"]),
          at: IsoDateTimeUtcSchema,
        }),
      ),
    }),
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
  ...SCREEN_METHODS,
  ...DEVICE_METHODS,
  ...VOICE_METHODS,
  ...USAGE_METHODS,
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

