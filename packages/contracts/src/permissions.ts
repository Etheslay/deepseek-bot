/** D16 application authorization. Human control methods are not model tools. */
import { z } from "zod";
import { IsoDateTimeUtcSchema, Sha256HexSchema, UuidSchema } from "./primitives.js";

export const CAPABILITY_IDS = [
  "app.read",
  "app.create_group",
  "app.create_bot",
  "app.update_bot",
  "app.create_workflow",
  "app.start_run",
  "app.cancel_run",
  "app.dispatch_task",
  "app.revoke_creation",
  "interaction.ask_user",
  "network.search",
  "memory.read",
  "memory.write",
  "fs.read",
  "fs.write",
  "exec.shell",
  "screen.capture",
  "device.action",
  "connector.invoke",
  "mcp.call",
] as const;
export const CapabilityIdSchema = z.enum(CAPABILITY_IDS);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export const PermissionModeSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export const GrantScopeSchema = z.enum(["policy", "once", "session", "permanent"]);
export type GrantScope = z.infer<typeof GrantScopeSchema>;

export function defaultPermissionMode(capability: CapabilityId): PermissionMode {
  if (
    capability === "app.read" ||
    capability === "interaction.ask_user" ||
    capability === "memory.read"
  )
    return "allow";
  return capability === "screen.capture" || capability === "device.action" ? "deny" : "ask";
}

/**
 * Per-action approval locks. `app.start_run` stays locked to "ask" (v1
 * decision, TASK_MANAGER_ORCHESTRATION.md Q1); `app.dispatch_task` is
 * deliberately NOT on this list: one dispatch costs one chat turn — far
 * below one workflow run — the executor's own high-risk tools still carry
 * their own policy, so once/session/permanent grants stay meaningful.
 */
export function requiresPerActionApproval(capability: CapabilityId): boolean {
  return (
    capability === "app.start_run" ||
    capability === "exec.shell" ||
    capability === "screen.capture" ||
    capability === "device.action" ||
    capability === "mcp.call"
  );
}

export function isPermissionModeAllowed(capability: CapabilityId, mode: PermissionMode): boolean {
  if (capability === "app.start_run") return mode === "ask";
  return !requiresPerActionApproval(capability) || mode !== "allow";
}

export const CapabilityPolicySchema = z
  .object({ capability: CapabilityIdSchema, mode: PermissionModeSchema })
  .strict()
  .refine(
    ({ capability, mode }) => isPermissionModeAllowed(capability, mode),
    "policy mode is not allowed for this capability",
  );
export type CapabilityPolicy = z.infer<typeof CapabilityPolicySchema>;

export const PermissionGrantSchema = z
  .object({
    id: UuidSchema,
    capability: CapabilityIdSchema,
    botId: UuidSchema.nullable(),
    mode: PermissionModeSchema,
    scope: GrantScopeSchema,
    sessionId: z.string().min(1).max(200).nullable(),
    generation: z.int().nonnegative().nullable(),
    approvalId: UuidSchema.nullable(),
    maxUses: z.int().min(1).max(100).nullable(),
    uses: z.int().nonnegative(),
    expiresAt: IsoDateTimeUtcSchema.nullable(),
    createdAt: IsoDateTimeUtcSchema,
    revokedAt: IsoDateTimeUtcSchema.nullable(),
  })
  .strict()
  .superRefine((grant, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    if (grant.maxUses !== null && grant.uses > grant.maxUses) issue("uses exceeds maxUses");
    if (grant.scope === "policy") {
      if (
        grant.botId !== null ||
        grant.sessionId !== null ||
        grant.generation !== null ||
        grant.approvalId !== null ||
        grant.expiresAt !== null ||
        grant.maxUses !== null ||
        grant.uses !== 0 ||
        grant.revokedAt !== null
      )
        issue("policy records must be global defaults");
      if (!isPermissionModeAllowed(grant.capability, grant.mode)) issue("forbidden policy mode");
    } else {
      if (grant.botId === null || grant.mode !== "allow")
        issue("issued grants require a bot and allow mode");
      if (grant.scope !== "once" && requiresPerActionApproval(grant.capability))
        issue("capability requires per-action approval");
      if (
        grant.scope === "once" &&
        (grant.approvalId === null ||
          grant.generation === null ||
          grant.maxUses !== 1 ||
          grant.expiresAt === null ||
          grant.sessionId !== null)
      )
        issue("once grants must bind one approval and generation");
      if (
        grant.scope === "session" &&
        (grant.sessionId === null ||
          grant.generation === null ||
          grant.expiresAt === null ||
          grant.maxUses === null ||
          grant.approvalId !== null)
      )
        issue("session grant requires a session, generation, expiry and use limit");
      if (
        grant.scope === "permanent" &&
        (grant.sessionId !== null ||
          grant.generation !== null ||
          grant.expiresAt !== null ||
          grant.maxUses !== null ||
          grant.approvalId !== null)
      )
        issue("permanent grants cannot carry temporary restrictions");
    }
  });
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

export const APP_APPROVAL_STATUSES = [
  "pending",
  "consumed",
  "denied",
  "expired",
  "cancelled",
] as const;
export const AppApprovalStatusSchema = z.enum(APP_APPROVAL_STATUSES);
export const AppApprovalSchema = z
  .object({
    id: UuidSchema,
    invocationId: UuidSchema,
    callerId: z.string().min(1).max(200),
    botId: UuidSchema,
    sessionId: z.string().min(1).max(200).nullable(),
    tool: z.string().min(1).max(100),
    capabilities: z.array(CapabilityIdSchema).min(1).max(16),
    params: z.record(z.string(), z.unknown()),
    actionDigest: Sha256HexSchema,
    generation: z.int().nonnegative(),
    status: AppApprovalStatusSchema,
    createdAt: IsoDateTimeUtcSchema,
    expiresAt: IsoDateTimeUtcSchema,
    decidedAt: IsoDateTimeUtcSchema.nullable(),
  })
  .strict();
export type AppApproval = z.infer<typeof AppApprovalSchema>;

export const PermissionDecisionRequestSchema = z
  .object({
    approvalId: UuidSchema,
    expectedActionDigest: Sha256HexSchema,
    decision: z.enum(["approved", "denied"]),
    scope: z.enum(["once", "session", "permanent"]).default("once"),
    maxUses: z.int().min(1).max(100).optional(),
    ttlMinutes: z.int().min(1).max(1_440).optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.scope === "session" ||
      (request.maxUses === undefined && request.ttlMinutes === undefined),
    "use count and TTL only apply to session grants",
  );
export type PermissionDecisionRequest = z.output<typeof PermissionDecisionRequestSchema>;

/**
 * Human chat grant for one capability on one bot. Session and permanent only:
 * once grants stay bound to an exact approval. Per-action capabilities cannot
 * take a longer grant. The Host binds the chat session; callers cannot.
 */
export const PermissionGrantIssueRequestSchema = z
  .object({
    botId: UuidSchema,
    capability: CapabilityIdSchema,
    scope: z.enum(["session", "permanent"]),
  })
  .strict()
  .refine(
    (request) => !requiresPerActionApproval(request.capability),
    "capability requires per-action approval",
  );
export type PermissionGrantIssueRequest = z.infer<typeof PermissionGrantIssueRequestSchema>;

export const PermissionAuditSchema = z
  .object({
    id: UuidSchema,
    sequence: z.int().nonnegative(),
    at: IsoDateTimeUtcSchema,
    actor: z.enum(["human", "agent", "host"]),
    callerId: z.string().max(200).nullable(),
    botId: UuidSchema.nullable(),
    tool: z.string().max(100).nullable(),
    capabilities: z.array(CapabilityIdSchema).max(16),
    actionDigest: Sha256HexSchema.nullable(),
    grantIds: z.array(UuidSchema).max(16),
    approvalId: UuidSchema.nullable(),
    decision: z.enum([
      "allowed",
      "denied",
      "policy.updated",
      "grant.issued",
      "grant.revoked",
      "approval.requested",
      "approval.approved",
      "approval.denied",
      "approval.expired",
      "cancelled",
    ]),
  })
  .strict();
export type PermissionAudit = z.infer<typeof PermissionAuditSchema>;

const listLimit = z.int().min(1).max(100).default(50);
export const PERMISSION_METHODS = {
  "permission.policy.list": {
    request: z.object({}).strict(),
    response: z.object({ policies: z.array(CapabilityPolicySchema) }),
  },
  "permission.policy.set": { request: CapabilityPolicySchema, response: CapabilityPolicySchema },
  "permission.grant.list": {
    request: z
      .object({
        botId: UuidSchema.optional(),
        includeInactive: z.boolean().default(false),
        limit: listLimit,
      })
      .strict(),
    response: z.object({ grants: z.array(PermissionGrantSchema) }),
  },
  "permission.grant.revoke": {
    request: z.object({ grantId: UuidSchema }).strict(),
    response: z.object({ grant: PermissionGrantSchema }),
  },
  "permission.grant.issue": {
    request: PermissionGrantIssueRequestSchema,
    response: z.object({ grant: PermissionGrantSchema }),
  },
  "permission.approval.list": {
    request: z
      .object({
        botId: UuidSchema.optional(),
        status: AppApprovalStatusSchema.default("pending"),
        limit: listLimit,
      })
      .strict(),
    response: z.object({ approvals: z.array(AppApprovalSchema) }),
  },
  "permission.approval.decide": {
    request: PermissionDecisionRequestSchema,
    response: z.object({ approval: AppApprovalSchema, grants: z.array(PermissionGrantSchema) }),
  },
  "permission.audit.list": {
    request: z
      .object({
        botId: UuidSchema.optional(),
        afterSequence: z.int().nonnegative().default(0),
        limit: listLimit,
      })
      .strict(),
    response: z.object({ records: z.array(PermissionAuditSchema) }),
  },
} as const;
