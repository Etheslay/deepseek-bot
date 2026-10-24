/**
 * Core entity schemas (docs/CONTRACTS.md §2).
 *
 * Bots never store raw API keys (credentials are referenced via
 * `credentialRef`). Workflow/Run snapshots are immutable once created;
 * enforcement lives in the Host, the schemas fix the data shapes.
 */
import { z } from "zod";
import {
  AbsolutePathSchema,
  IanaTimeZoneSchema,
  IsoDateTimeUtcSchema,
  MediaTypeSchema,
  NonEmptyStringSchema,
  RelativeArtifactPathSchema,
  Sha256HexSchema,
  TEXT_LIMITS,
  UuidSchema,
} from "./primitives.js";
import { NODE_RUN_STATUSES, RUN_STATUSES } from "./status.js";
import { WORKFLOW_SCHEMA_VERSION } from "./version.js";

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

export const BotSchema = z.object({
  id: UuidSchema,
  revision: UuidSchema,
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  instructions: z.string().max(TEXT_LIMITS.instructions),
  modelProfileId: UuidSchema,
  workspaceId: UuidSchema,
  toolPolicyId: UuidSchema,
  archivedAt: IsoDateTimeUtcSchema.nullable(),
});

export type Bot = z.infer<typeof BotSchema>;

// ---------------------------------------------------------------------------
// ModelProfile
// ---------------------------------------------------------------------------

/** v0.1 only ships the DeepSeek provider; other targets need a schema bump. */
export const ModelProfileSchema = z.object({
  id: UuidSchema,
  provider: z.literal("deepseek"),
  model: NonEmptyStringSchema(TEXT_LIMITS.label),
  endpoint: z
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "endpoint must use https",
    }),
  /** Reference into the system credential store; never the key itself. */
  credentialRef: NonEmptyStringSchema(TEXT_LIMITS.label),
  limits: z.object({
    maxTokens: z.int().positive().max(1_000_000).optional(),
  }),
});

export type ModelProfile = z.infer<typeof ModelProfileSchema>;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const WORKSPACE_OPERATIONS = ["read", "write", "execute"] as const;
export type WorkspaceOperation = (typeof WORKSPACE_OPERATIONS)[number];

/**
 * Grants are expressed as canonical paths plus operation scopes. Path
 * containment checks (including symlinks/junctions) are enforced by the
 * backend; the grant is structured data, not a bare string prefix.
 */
export const WorkspaceGrantSchema = z.object({
  scopePath: AbsolutePathSchema,
  operations: z.array(z.enum(WORKSPACE_OPERATIONS)).min(1),
});

export const WorkspaceSchema = z.object({
  id: UuidSchema,
  canonicalPath: AbsolutePathSchema,
  grants: z.array(WorkspaceGrantSchema),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

// ---------------------------------------------------------------------------
// Workflow, Node, Edge
// ---------------------------------------------------------------------------

export const NODE_TYPES = ["bot", "approval"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NodeInputBindingSchema = z.object({
  inputKey: NonEmptyStringSchema(TEXT_LIMITS.label),
  required: z.boolean().default(true),
});

export type NodeInputBinding = z.infer<typeof NodeInputBindingSchema>;

/** Automatic retries are for confirmed side-effect-free transient errors only. */
export const RetryPolicySchema = z.object({
  maxRetries: z.int().min(0).max(2).default(0),
});

export const WorkflowNodeSchema = z
  .object({
    id: NonEmptyStringSchema(TEXT_LIMITS.label),
    type: z.enum(NODE_TYPES),
    /** Required for `bot` nodes, forbidden for `approval` nodes. */
    botId: UuidSchema.optional(),
    instructionTemplate: z.string().max(TEXT_LIMITS.template),
    inputBindings: z.array(NodeInputBindingSchema).default([]),
    timeoutSeconds: z.int().positive().max(86_400).optional(),
    retryPolicy: RetryPolicySchema.default({ maxRetries: 0 }),
  })
  .refine((node) => node.type !== "bot" || node.botId !== undefined, {
    message: "bot nodes require botId",
  })
  .refine((node) => node.type !== "approval" || node.botId === undefined, {
    message: "approval nodes must not carry botId",
  });

export const WorkflowEdgeSchema = z.object({
  fromNodeId: NonEmptyStringSchema(TEXT_LIMITS.label),
  outputKey: NonEmptyStringSchema(TEXT_LIMITS.label),
  toNodeId: NonEmptyStringSchema(TEXT_LIMITS.label),
  inputKey: NonEmptyStringSchema(TEXT_LIMITS.label),
});

export const WorkflowLimitsSchema = z.object({
  /** ARCHITECTURE.md §6: default concurrency 2; configurable after stress tests. */
  maxConcurrentNodes: z.int().min(1).max(8).default(2),
});

export const WorkflowSchema = z.object({
  id: UuidSchema,
  revision: UuidSchema,
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  nodes: z.array(WorkflowNodeSchema).min(1).max(500),
  edges: z.array(WorkflowEdgeSchema).max(2_000),
  limits: WorkflowLimitsSchema.default({ maxConcurrentNodes: 2 }),
});

/** A draft being validated/saved/imported may not have an id/revision yet. */
export const WorkflowDraftSchema = z.object({
  id: UuidSchema.optional(),
  revision: UuidSchema.optional(),
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  nodes: z.array(WorkflowNodeSchema).min(1).max(500),
  edges: z.array(WorkflowEdgeSchema).max(2_000),
  limits: WorkflowLimitsSchema.default({ maxConcurrentNodes: 2 }),
});

export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

/**
 * Import templates carry their own schemaVersion; the importer must be able
 * to receive an unknown (e.g. higher) version and reject it explicitly with
 * DATA_VERSION_UNSUPPORTED instead of failing schema parsing first.
 */
export const ImportableWorkflowDraftSchema = WorkflowDraftSchema
  .omit({ schemaVersion: true })
  .extend({ schemaVersion: z.string() });

export type ImportableWorkflowDraft = z.infer<
  typeof ImportableWorkflowDraftSchema
>;

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** v0.1 misfire policy is fixed to skip-and-notify (CONTRACTS.md §2). */
export const MISFIRE_POLICY = "skip-and-notify" as const;

export const ScheduleSchema = z.object({
  id: UuidSchema,
  workflowId: UuidSchema,
  timezone: IanaTimeZoneSchema,
  /** v0.1 recurrence grammar: 5-field cron expression. */
  recurrence: z
    .string()
    .min(9)
    .max(100)
    .refine(
      (value) => value.trim().split(/\s+/).length === 5,
      "expected a 5-field cron expression",
    ),
  nextRunAt: IsoDateTimeUtcSchema.nullable(),
  enabled: z.boolean(),
  misfirePolicy: z.literal(MISFIRE_POLICY),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

// ---------------------------------------------------------------------------
// Run and NodeRun
// ---------------------------------------------------------------------------

export const RunTriggerSchema = z
  .object({
    kind: z.enum(["manual", "schedule"]),
    /** Unique per trigger; duplicate submissions return the existing Run. */
    idempotencyKey: UuidSchema,
    scheduleId: UuidSchema.optional(),
    occurrenceUtc: IsoDateTimeUtcSchema.optional(),
  })
  .refine(
    (trigger) =>
      trigger.kind !== "schedule" ||
      (trigger.scheduleId !== undefined && trigger.occurrenceUtc !== undefined),
    { message: "schedule triggers require scheduleId and occurrenceUtc" },
  );

export const RunSchema = z.object({
  id: UuidSchema,
  workflowSnapshot: WorkflowSchema,
  botSnapshots: z.array(BotSchema),
  status: z.enum(RUN_STATUSES),
  trigger: RunTriggerSchema,
  createdAt: IsoDateTimeUtcSchema,
  finishedAt: IsoDateTimeUtcSchema.nullable(),
  /** Set on the new Run that recovers an interrupted predecessor. */
  resumedFromRunId: UuidSchema.optional(),
});

export const ArtifactRefSchema = z.object({
  artifactId: UuidSchema,
});

export const NodeRunSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  nodeId: NonEmptyStringSchema(TEXT_LIMITS.label),
  attempt: z.int().positive(),
  status: z.enum(NODE_RUN_STATUSES),
  inputRefs: z.array(ArtifactRefSchema),
  outputRefs: z.array(ArtifactRefSchema),
  /** Harness session this node attempt maps to, when one exists. */
  sessionId: z.string().max(TEXT_LIMITS.label).nullable(),
});

export type Run = z.infer<typeof RunSchema>;
export type NodeRun = z.infer<typeof NodeRunSchema>;
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "denied",
  "expired",
  "consumed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_STATUSES_TERMINAL: readonly ApprovalStatus[] = [
  "denied",
  "expired",
  "consumed",
];

/** Default validity window (CONTRACTS.md §2: 10 minutes). */
export const APPROVAL_DEFAULT_TTL_MS = 10 * 60 * 1_000;

export const ApprovalSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  nodeRunId: UuidSchema,
  /** Digest of the action summary + full parameter hash; validated on decide. */
  actionDigest: Sha256HexSchema,
  resource: NonEmptyStringSchema(TEXT_LIMITS.path),
  expiresAt: IsoDateTimeUtcSchema,
  status: z.enum(APPROVAL_STATUSES),
});

export type Approval = z.infer<typeof ApprovalSchema>;

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export const ArtifactSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  nodeRunId: UuidSchema,
  relativePath: RelativeArtifactPathSchema,
  mediaType: MediaTypeSchema,
  size: z.int().nonnegative(),
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: Sha256HexSchema,
  }),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
