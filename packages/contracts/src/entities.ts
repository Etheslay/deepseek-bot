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

/**
 * Canonical Grok Ball avatar pool (SPRINTS §6 #7). The shape×color matrix is
 * a data contract: batch creation assigns members distinct combinations, so
 * every consumer must compare the same pool. Renderers map these ids to
 * their own visuals; ids are stable, palettes evolve only via a contract PR.
 *
 * The 2026-10 shape pass replaced the traced-outline set with a compiled
 * primitive family (blob / pebble / bean / … / leaf). Ids already handed out to
 * stored avatars are NOT deleted: they move to `AVATAR_SHAPE_IDS_RETIRED`, so
 * existing rows keep validating and keep rendering, while nothing new is ever
 * assigned a retired id. Same rule for retired colours in
 * `AVATAR_COLORS_RETIRED`.
 */
export const AVATAR_SHAPES = [
  "blob",
  "squircle",
  "cylinder",
  "hex",
  "gem",
  "crystal",
  "shield",
  "arch",
  "cloud",
  "leaf",
  "heart",
] as const;

/** Kept for compatibility: valid input, never assigned. */
export const AVATAR_SHAPE_IDS_RETIRED = [
  "circle",
  "star4",
  "star5",
  "flower6",
  "pentagon",
  "hexagon",
  "pumpkin",
  "triangle",
  "egg",
  "capsule",
] as const;

export const AVATAR_COLORS = [
  "#A27952",
  "#FF3E51",
  "#FF781C",
  "#FFAF38",
  "#00C972",
  "#1CC3B0",
  "#2A92FE",
  "#A97EFE",
  "#FF5EB1",
  "#959595",
] as const;

/** Kept for compatibility: valid input, never assigned. */
export const AVATAR_COLORS_RETIRED = [
  "#8b5e3c",
  "#e8483f",
  "#f08a24",
  "#f0b429",
  "#3ecf8e",
  "#2fbfa0",
  "#3b93f0",
  "#8b5cf6",
  "#e152b0",
  "#a3a3a3",
] as const;

export const AvatarSchema = z.object({
  shape: z.enum([...AVATAR_SHAPES, ...AVATAR_SHAPE_IDS_RETIRED]),
  color: z.enum([...AVATAR_COLORS, ...AVATAR_COLORS_RETIRED]),
});

export type Avatar = z.infer<typeof AvatarSchema>;

/** Stable identity of one pool combination (uniqueness scope key). */
export function avatarPoolKey(avatar: Avatar): string {
  return `${avatar.shape}:${avatar.color}`;
}

/** The full pool in canonical assignment order (shape-major). */
export function canonicalAvatarPool(): Avatar[] {
  return AVATAR_SHAPES.flatMap((shape) =>
    AVATAR_COLORS.map((color) => ({ shape, color })),
  );
}

/**
 * Avatar auto-assignment for one batch (SPRINTS §6 #7): explicit picks win
 * verbatim even when they collide (用户显式指定时以用户为准); automatic
 * picks take the first unused combination and stay distinct from each
 * other, the explicit picks and everything in `taken` (the scope's existing
 * members). Repeats only once the whole pool is exhausted in that scope.
 */
export function assignBatchAvatars(input: {
  readonly count: number;
  /** Length must equal `count`; `undefined` marks an auto slot. */
  readonly explicit: ReadonlyArray<Avatar | undefined>;
  /** Pool keys already used by the scope (e.g. the group's members). */
  readonly taken: ReadonlySet<string>;
}): Avatar[] {
  if (input.explicit.length !== input.count) {
    throw new Error("explicit avatar list must cover the whole batch");
  }
  const used = new Set(input.taken);
  for (const avatar of input.explicit) {
    if (avatar !== undefined) {
      used.add(avatarPoolKey(avatar));
    }
  }
  const pool = canonicalAvatarPool();
  const free = pool.filter((avatar) => !used.has(avatarPoolKey(avatar)));
  const assigned: Avatar[] = [];
  let cycle = 0;
  for (const avatar of input.explicit) {
    if (avatar !== undefined) {
      assigned.push(avatar);
      continue;
    }
    const next = free.shift();
    if (next !== undefined) {
      assigned.push(next);
      continue;
    }
    assigned.push(pool[cycle % pool.length]!);
    cycle += 1;
  }
  return assigned;
}

/**
 * `avatar`/`groupId` are nullish (not merely nullable) because Bot embeds
 * into run botSnapshots recorded before D15: absent keys must keep parsing.
 * Null means "not assigned" — UIs fall back to their own derivation.
 */
export const BotSchema = z.object({
  id: UuidSchema,
  revision: UuidSchema,
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  instructions: z.string().max(TEXT_LIMITS.instructions),
  modelProfileId: UuidSchema,
  workspaceId: UuidSchema,
  toolPolicyId: UuidSchema,
  avatar: AvatarSchema.nullish(),
  groupId: UuidSchema.nullish(),
  archivedAt: IsoDateTimeUtcSchema.nullable(),
});

export type Bot = z.infer<typeof BotSchema>;

// ---------------------------------------------------------------------------
// Bot group (D15 write layer, FR-12)
// ---------------------------------------------------------------------------

export const BotGroupSchema = z.object({
  id: UuidSchema,
  revision: UuidSchema,
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  archivedAt: IsoDateTimeUtcSchema.nullable(),
});

export type BotGroup = z.infer<typeof BotGroupSchema>;

/**
 * A bot creation draft (M5: 聊天可生成创建草案，编辑器可见但未落库). Every
 * field is optional: the chat fills what it knows, the editor resolves the
 * rest. Drafts are message-level data — nothing persists them; reference
 * fields are validated only when a real creation method consumes them.
 */
export const BotCreationDraftSchema = z.object({
  name: NonEmptyStringSchema(TEXT_LIMITS.name).optional(),
  instructions: z.string().max(TEXT_LIMITS.instructions).optional(),
  modelProfileId: UuidSchema.optional(),
  workspaceId: UuidSchema.optional(),
  toolPolicyId: UuidSchema.optional(),
  groupId: UuidSchema.nullish(),
  avatar: AvatarSchema.optional(),
});

export type BotCreationDraft = z.infer<typeof BotCreationDraftSchema>;

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
// Tool policy (D08: FR-06 backend enforcement data)
// ---------------------------------------------------------------------------

/**
 * Shell execution has no unattended allow mode in v0.1 (SECURITY_DATA §3:
 * a verifiable OS-level constraint or the capability stays off), so every
 * shell invocation is user-approved with the exact command line.
 */
export const TOOL_SHELL_MODES = ["disabled", "approval-required"] as const;
export type ToolShellMode = (typeof TOOL_SHELL_MODES)[number];

export const TOOL_NETWORK_MODES = ["disabled", "allowed", "approval-required"] as const;
export type ToolNetworkMode = (typeof TOOL_NETWORK_MODES)[number];

/**
 * MCP authorization is an explicit per-server tool allowlist. Wildcards are
 * not representable: project files or model output cannot enlarge the grant
 * (SECURITY_DATA §3), only a policy record change can.
 */
export const ConnectorKindSchema = z.enum(["sd-webui", "mcp-http"]);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

/** Exact remote tool names; no glob expansion or normalization. */
export const McpToolNameSchema = z.string().min(1).max(200).refine(
  (name) => !/[?*]/u.test(name),
  "MCP tool names must be exact names without wildcards",
);
export const McpAllowedToolsSchema = z.array(McpToolNameSchema).max(200).refine(
  (names) => new Set(names).size === names.length,
  "MCP tool names must be unique",
);
export const McpToolSchema = z.object({
  name: McpToolNameSchema,
  description: z.string().max(4000).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type McpTool = z.infer<typeof McpToolSchema>;

export const McpServerGrantSchema = z.object({
  serverId: NonEmptyStringSchema(TEXT_LIMITS.label),
  allowedTools: McpAllowedToolsSchema,
});
export type McpServerGrant = z.infer<typeof McpServerGrantSchema>;

/**
 * Tool authorization for one bot. Least privilege by default: an empty
 * policy disables every capability. Filesystem tools operate inside the
 * workspace grant scopes (WorkspaceGrantSchema); the run artifact directory
 * is granted separately by the Host when filesystem access is enabled.
 */
export const ToolPolicySchema = z.object({
  id: UuidSchema,
  revision: UuidSchema,
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  filesystem: z.object({
    enabled: z.boolean(),
    /** Subset of read/write; process execution belongs to the shell capability. */
    operations: z.array(z.enum(["read", "write"])).max(2),
  }),
  shell: z.object({ mode: z.enum(TOOL_SHELL_MODES) }),
  network: z.object({ mode: z.enum(TOOL_NETWORK_MODES) }),
  mcp: z.object({
    enabled: z.boolean(),
    /** When true every authorized MCP tool call still requires user approval. */
    requireApproval: z.boolean(),
    servers: z.array(McpServerGrantSchema).max(50),
  }),
});
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

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

// ---------------------------------------------------------------------------
// Bot workspace artifact (D28 co-edit sidecar)
// ---------------------------------------------------------------------------

/**
 * One editable file in a bot's workspace directory. Unlike the run-scoped
 * {@link ArtifactSchema}, a workspace artifact has no run identity: it is
 * addressed by (botId, relativePath) and co-edited by the user and the bot.
 */
export const BotArtifactSchema = z.object({
  relativePath: RelativeArtifactPathSchema,
  mediaType: MediaTypeSchema,
  size: z.int().nonnegative(),
  updatedAt: IsoDateTimeUtcSchema,
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: Sha256HexSchema,
  }),
});

export type BotArtifact = z.infer<typeof BotArtifactSchema>;

/**
 * One immutable version of a workspace artifact. `author` records who produced
 * the content: "user" for sidecar saves and reverts, "bot" for content the
 * Host observed in the workspace that no version recorded yet (lazy capture —
 * the Harness writes workspace files directly, outside any method call).
 */
export const ArtifactVersionSchema = z.object({
  id: UuidSchema,
  botId: UuidSchema,
  relativePath: RelativeArtifactPathSchema,
  revision: z.int().min(1),
  author: z.enum(["user", "bot"]),
  mediaType: MediaTypeSchema,
  size: z.int().nonnegative(),
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: Sha256HexSchema,
  }),
  createdAt: IsoDateTimeUtcSchema,
});

export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

/** Extensions the Host maps to inline-editable text media types (D28). */
const TEXT_MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".xml": "text/xml",
};

const IMAGE_MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Media type for a workspace file path. Unknown extensions are binary
 * (application/octet-stream); HTML keeps its type but is never editable
 * (QA-14: no inline script execution).
 */
export function artifactMediaTypeForPath(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  const dot = lower.lastIndexOf(".");
  if (dot < 0) {
    return "application/octet-stream";
  }
  const extension = lower.slice(dot);
  return (
    TEXT_MEDIA_EXTENSIONS[extension] ??
    IMAGE_MEDIA_EXTENSIONS[extension] ??
    "application/octet-stream"
  );
}

/**
 * Whether a media type can be opened in the co-edit editor. text/html is
 * deliberately excluded: rendering user-editable HTML would let a document
 * execute scripts inside the renderer (QA-14).
 */
export function isTextEditableMediaType(mediaType: string): boolean {
  return (
    mediaType === "text/markdown" ||
    mediaType === "text/plain" ||
    mediaType === "application/json" ||
    mediaType === "text/csv" ||
    mediaType === "text/yaml" ||
    mediaType === "text/xml"
  );
}
