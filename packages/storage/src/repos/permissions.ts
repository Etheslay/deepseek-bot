/** Capability policy/grant state. All multi-capability decisions are one SQLite transaction. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CAPABILITY_IDS,
  CapabilityPolicySchema,
  PermissionGrantSchema,
  AppApprovalSchema,
  PermissionAuditSchema,
  PermissionDecisionRequestSchema,
  PermissionGrantIssueRequestSchema,
  defaultPermissionMode,
  requiresPerActionApproval,
  type CapabilityId,
  type CapabilityPolicy,
  type PermissionGrant,
  type AppApproval,
  type PermissionAudit,
  type PermissionDecisionRequest,
  type ErrorCode,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput, StorageError } from "../errors.js";
import { parseJsonColumn, runInTransaction } from "./shared.js";

export interface PermissionCall {
  invocationId: string;
  callerId: string;
  botId: string | null;
  sessionId: string | null;
  tool: string;
  capabilities: CapabilityId[];
  params: Record<string, unknown>;
  actionDigest: string;
  generation: number;
}
export interface PermissionAuthorization {
  allowed: boolean;
  code?: ErrorCode;
  reason?: string;
  capabilities: CapabilityId[];
  grantIds: string[];
  approvalId?: string;
  missing?: CapabilityId[];
}
type JsonRow = { payload_json: string };
const now = (db: OpenedDatabase) => db.now().toISOString();
function denied(message = "permission authorization is no longer valid"): StorageError {
  return new StorageError({ code: "UNAUTHORIZED_PATH", message, retryable: false });
}
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidInput("invalid permission data");
  return parsed.data;
}
function validateCall(call: PermissionCall): void {
  // Approval schema also defines the exact trusted invocation shape.
  validate(AppApprovalSchema, {
    ...call,
    id: randomUUID(),
    botId: call.botId ?? randomUUID(),
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:10:00.000Z",
    status: "pending",
    decidedAt: null,
  });
  if (new Set(call.capabilities).size !== call.capabilities.length)
    throw invalidInput("duplicate permission capability");
}
function activeBot(db: OpenedDatabase, id: string | null): boolean {
  return (
    id !== null &&
    db.raw.prepare("SELECT id FROM bots WHERE id = ? AND archived_at IS NULL").get(id) !== undefined
  );
}
function allGrants(db: OpenedDatabase): PermissionGrant[] {
  return (
    db.raw.prepare("SELECT payload_json FROM permission_grants ORDER BY rowid").all() as JsonRow[]
  ).map((row) => parseJsonColumn(PermissionGrantSchema, row.payload_json, "permission grant"));
}
function writeGrant(db: OpenedDatabase, input: PermissionGrant): PermissionGrant {
  const grant = validate(PermissionGrantSchema, input);
  db.raw
    .prepare(
      "INSERT INTO permission_grants(id, capability, scope, bot_id, payload_json) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json",
    )
    .run(grant.id, grant.capability, grant.scope, grant.botId, JSON.stringify(grant));
  return grant;
}
function writeApproval(db: OpenedDatabase, input: AppApproval): AppApproval {
  const approval = validate(AppApprovalSchema, input);
  db.raw
    .prepare(
      "INSERT INTO app_approvals(id, invocation_id, payload_json) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json",
    )
    .run(approval.id, approval.invocationId, JSON.stringify(approval));
  return approval;
}
function audit(
  db: OpenedDatabase,
  decision: PermissionAudit["decision"],
  actor: PermissionAudit["actor"],
  call?: PermissionCall,
  grants: string[] = [],
  approvalId: string | null = null,
  capabilities: CapabilityId[] = [],
  botId: string | null = null,
): void {
  const record = validate(PermissionAuditSchema, {
    id: randomUUID(),
    sequence: 0,
    at: now(db),
    actor,
    callerId: call?.callerId ?? null,
    botId: call?.botId ?? botId,
    tool: call?.tool ?? null,
    capabilities: call?.capabilities ?? capabilities,
    actionDigest: call?.actionDigest ?? null,
    grantIds: grants,
    approvalId,
    decision,
  });
  const { sequence: _sequence, ...payload } = record;
  db.raw
    .prepare("INSERT INTO permission_audit(id, payload_json) VALUES(?, ?)")
    .run(record.id, JSON.stringify(payload));
}
export function listPermissionPolicies(db: OpenedDatabase): CapabilityPolicy[] {
  const rows = allGrants(db).filter((grant) => grant.scope === "policy");
  return CAPABILITY_IDS.map((capability) => ({
    capability,
    mode:
      rows.find((row) => row.capability === capability)?.mode ?? defaultPermissionMode(capability),
  }));
}
export function setPermissionPolicy(db: OpenedDatabase, input: CapabilityPolicy): CapabilityPolicy {
  const policy = validate(CapabilityPolicySchema, input);
  return runInTransaction(db.raw, () => {
    const existing = allGrants(db).find(
      (grant) => grant.scope === "policy" && grant.capability === policy.capability,
    );
    writeGrant(db, {
      id: existing?.id ?? randomUUID(),
      ...policy,
      scope: "policy",
      botId: null,
      sessionId: null,
      generation: null,
      approvalId: null,
      maxUses: null,
      uses: 0,
      expiresAt: null,
      createdAt: existing?.createdAt ?? now(db),
      revokedAt: null,
    });
    audit(db, "policy.updated", "human", undefined, [], null, [policy.capability]);
    return policy;
  });
}
function usable(
  db: OpenedDatabase,
  grant: PermissionGrant,
  generation: number,
  ignoreCount = false,
): boolean {
  return (
    grant.scope !== "policy" &&
    grant.revokedAt === null &&
    activeBot(db, grant.botId) &&
    (grant.generation === null || grant.generation === generation) &&
    (grant.expiresAt === null || grant.expiresAt > now(db)) &&
    (ignoreCount || grant.maxUses === null || grant.uses < grant.maxUses)
  );
}
function limit(value: number | undefined): number {
  return validate(z.int().min(1).max(100), value ?? 50);
}
export function listPermissionGrants(
  db: OpenedDatabase,
  options: { botId?: string; includeInactive?: boolean; limit?: number; generation: number },
): PermissionGrant[] {
  return allGrants(db)
    .filter(
      (grant) =>
        grant.scope !== "policy" &&
        (options.botId === undefined || grant.botId === options.botId) &&
        (options.includeInactive === true || usable(db, grant, options.generation)),
    )
    .slice(0, limit(options.limit));
}
export function revokePermissionGrant(db: OpenedDatabase, id: string): PermissionGrant {
  return runInTransaction(db.raw, () => {
    const grant = allGrants(db).find((row) => row.id === id);
    if (grant === undefined || grant.scope === "policy")
      throw invalidInput("issued permission grant not found");
    if (grant.revokedAt !== null) return grant;
    const result = writeGrant(db, { ...grant, revokedAt: now(db) });
    audit(
      db,
      "grant.revoked",
      "human",
      undefined,
      [id],
      grant.approvalId,
      [grant.capability],
      grant.botId,
    );
    return result;
  });
}

const CHAT_GRANT_USES = 5;
const CHAT_GRANT_MINUTES = 120;

/**
 * Issue one session or permanent grant for one bot. Session identity, use
 * count and TTL follow the existing approval-card defaults. A still-usable
 * grant for the same bot, capability, scope and session is returned as-is.
 */
export function issuePermissionGrant(
  db: OpenedDatabase,
  input: {
    botId: string;
    capability: CapabilityId;
    scope: "session" | "permanent";
    sessionId: string | null;
  },
  generation: number,
): PermissionGrant {
  const request = validate(PermissionGrantIssueRequestSchema, {
    botId: input.botId,
    capability: input.capability,
    scope: input.scope,
  });
  const boundGeneration = validate(z.int().nonnegative(), generation);
  if (request.scope === "session") validate(z.string().min(1).max(200), input.sessionId);
  else if (input.sessionId !== null) throw invalidInput("permanent grants cannot carry a session");
  return runInTransaction(db.raw, () => {
    if (!activeBot(db, request.botId)) throw invalidInput("permission actor is not active");
    const mode = listPermissionPolicies(db).find(
      (policy) => policy.capability === request.capability,
    )!.mode;
    if (mode === "deny") throw invalidInput("capability policy denies this action");
    if (mode !== "ask") throw invalidInput("capability policy does not ask for a grant");
    const sessionId = request.scope === "session" ? input.sessionId : null;
    const existing = allGrants(db).find(
      (grant) =>
        grant.capability === request.capability &&
        grant.botId === request.botId &&
        grant.scope === request.scope &&
        grant.sessionId === sessionId &&
        usable(db, grant, boundGeneration),
    );
    if (existing !== undefined) return existing;
    const grant = writeGrant(db, {
      id: randomUUID(),
      capability: request.capability,
      botId: request.botId,
      mode: "allow",
      scope: request.scope,
      sessionId,
      generation: request.scope === "permanent" ? null : boundGeneration,
      approvalId: null,
      maxUses: request.scope === "permanent" ? null : CHAT_GRANT_USES,
      uses: 0,
      expiresAt:
        request.scope === "permanent"
          ? null
          : new Date(db.now().getTime() + CHAT_GRANT_MINUTES * 60_000).toISOString(),
      createdAt: now(db),
      revokedAt: null,
    });
    audit(
      db,
      "grant.issued",
      "human",
      undefined,
      [grant.id],
      null,
      [grant.capability],
      grant.botId,
    );
    return grant;
  });
}
export function getPermissionApproval(db: OpenedDatabase, id: string): AppApproval | undefined {
  const row = db.raw.prepare("SELECT payload_json FROM app_approvals WHERE id = ?").get(id) as
    | JsonRow
    | undefined;
  return row === undefined
    ? undefined
    : parseJsonColumn(AppApprovalSchema, row.payload_json, "app approval");
}
export function listPermissionApprovals(
  db: OpenedDatabase,
  options: { botId?: string; status?: AppApproval["status"]; limit?: number },
): AppApproval[] {
  return (
    db.raw.prepare("SELECT payload_json FROM app_approvals ORDER BY rowid").all() as JsonRow[]
  )
    .map((row) => parseJsonColumn(AppApprovalSchema, row.payload_json, "app approval"))
    .filter(
      (row) =>
        (options.botId === undefined || row.botId === options.botId) &&
        (options.status === undefined || row.status === options.status),
    )
    .slice(0, limit(options.limit));
}
export function listPermissionAudit(
  db: OpenedDatabase,
  options: { botId?: string; afterSequence?: number; limit?: number },
): PermissionAudit[] {
  const after = validate(z.int().nonnegative(), options.afterSequence ?? 0);
  return (
    db.raw
      .prepare(
        "SELECT sequence, payload_json FROM permission_audit WHERE sequence > ? ORDER BY sequence",
      )
      .all(after) as (JsonRow & { sequence: number })[]
  )
    .map((row) =>
      validate(PermissionAuditSchema, {
        ...(JSON.parse(row.payload_json) as Record<string, unknown>),
        sequence: row.sequence,
      }),
    )
    .filter((row) => options.botId === undefined || row.botId === options.botId)
    .slice(0, limit(options.limit));
}
function plan(
  db: OpenedDatabase,
  call: PermissionCall,
  approvalId?: string,
): { authorization: PermissionAuthorization; selected: PermissionGrant[] } {
  const policies = listPermissionPolicies(db);
  const grants = allGrants(db);
  const selected: PermissionGrant[] = [];
  const missing: CapabilityId[] = [];
  const reject = (reason: string) => ({
    authorization: {
      allowed: false,
      code: "UNAUTHORIZED_PATH" as const,
      reason,
      capabilities: call.capabilities,
      grantIds: [],
    },
    selected: [],
  });
  if (call.botId !== null && !activeBot(db, call.botId))
    return reject("permission actor is not active");
  for (const capability of call.capabilities) {
    // Bot-to-bot messaging is not a human permission. A stored ask or deny
    // row from an older default does not block the call.
    if (capability === "app.dispatch_task") continue;
    const mode = policies.find((policy) => policy.capability === capability)!.mode;
    if (mode === "deny") return reject("capability policy denies this action");
    if (
      (mode === "ask" || (capability !== "app.read" && capability !== "interaction.ask_user")) &&
      !activeBot(db, call.botId)
    )
      return reject("permission actor is required");
    if (mode === "allow") continue;
    const grant = grants.find(
      (grant) =>
        grant.capability === capability &&
        grant.botId === call.botId &&
        usable(db, grant, call.generation) &&
        (grant.scope === "permanent" ||
          (grant.scope === "session" && grant.sessionId === call.sessionId) ||
          (grant.scope === "once" && approvalId !== undefined && grant.approvalId === approvalId)),
    );
    if (grant === undefined) missing.push(capability);
    else selected.push(grant);
  }
  return {
    authorization: {
      allowed: missing.length === 0,
      ...(missing.length > 0 ? { code: "APPROVAL_REQUIRED" as const, missing } : {}),
      capabilities: call.capabilities,
      grantIds: missing.length > 0 ? [] : selected.map((grant) => grant.id),
      ...(approvalId === undefined ? {} : { approvalId }),
    },
    selected,
  };
}
function callKey(call: PermissionCall): string {
  // Trusted validated params are bound by actionDigest; keep raw params only in approval preview.
  return JSON.stringify([
    call.invocationId,
    call.callerId,
    call.botId,
    call.sessionId,
    call.tool,
    [...call.capabilities].sort(),
    call.actionDigest,
    call.generation,
  ]);
}
function consume(
  db: OpenedDatabase,
  call: PermissionCall,
  authorization: PermissionAuthorization,
  selected: PermissionGrant[],
): void {
  if (
    db.raw
      .prepare("SELECT invocation_id FROM permission_authorizations WHERE invocation_id = ?")
      .get(call.invocationId) !== undefined
  )
    throw denied("permission invocation was already authorized");
  for (const grant of selected) writeGrant(db, { ...grant, uses: grant.uses + 1 });
  db.raw
    .prepare(
      "INSERT INTO permission_authorizations(invocation_id, call_json, authorization_json) VALUES(?, ?, ?)",
    )
    .run(call.invocationId, callKey(call), JSON.stringify(authorization));
  audit(db, "allowed", "agent", call, authorization.grantIds, authorization.approvalId ?? null);
}
export function authorizePermissionCall(
  db: OpenedDatabase,
  call: PermissionCall,
): PermissionAuthorization {
  validateCall(call);
  return runInTransaction(db.raw, () => {
    const { authorization, selected } = plan(db, call);
    if (authorization.allowed) consume(db, call, authorization, selected);
    else audit(db, "denied", "agent", call);
    return authorization;
  });
}
/**
 * A policy just became allow. Pending asks whose every capability is now
 * covered by policy are authorized and closed, so the chat card goes away
 * and the waiting call continues. An ask that still needs another capability
 * stays pending.
 */
export function releaseApprovalsCoveredByPolicy(
  db: OpenedDatabase,
  capability: CapabilityId,
  generation: number,
): { approval: AppApproval; authorization: PermissionAuthorization; call: PermissionCall }[] {
  return runInTransaction(db.raw, () => {
    const released: {
      approval: AppApproval;
      authorization: PermissionAuthorization;
      call: PermissionCall;
    }[] = [];
    for (const approval of listPermissionApprovals(db, { status: "pending" })) {
      if (approval.generation !== generation || !approval.capabilities.includes(capability))
        continue;
      const call = approvalCall(approval);
      const { authorization, selected } = plan(db, call);
      if (!authorization.allowed) continue;
      consume(db, call, authorization, selected);
      released.push({
        approval: finishApproval(db, approval, "consumed", "host"),
        authorization,
        call,
      });
    }
    return released;
  });
}
export function revalidatePermissionAuthorization(
  db: OpenedDatabase,
  call: PermissionCall,
  authorization: PermissionAuthorization,
): void {
  validateCall(call);
  try {
    revalidateUnchecked(db, call, authorization);
  } catch (error) {
    audit(db, "denied", "agent", call, authorization.grantIds, authorization.approvalId ?? null);
    throw error;
  }
}
function revalidateUnchecked(
  db: OpenedDatabase,
  call: PermissionCall,
  authorization: PermissionAuthorization,
): void {
  const receipt = db.raw
    .prepare(
      "SELECT call_json, authorization_json FROM permission_authorizations WHERE invocation_id = ?",
    )
    .get(call.invocationId) as { call_json: string; authorization_json: string } | undefined;
  if (
    !authorization.allowed ||
    receipt === undefined ||
    receipt.call_json !== callKey(call) ||
    receipt.authorization_json !== JSON.stringify(authorization)
  )
    throw denied();
  if (call.botId !== null && !activeBot(db, call.botId)) throw denied();
  const policies = listPermissionPolicies(db);
  const grants = allGrants(db);
  // Every grant consumed for this invocation must remain valid, even when
  // its policy changed to allow after the original authorization.
  for (const id of authorization.grantIds) {
    const grant = grants.find((row) => row.id === id);
    if (
      grant === undefined ||
      grant.botId !== call.botId ||
      !usable(db, grant, call.generation, true) ||
      (grant.scope === "session" && grant.sessionId !== call.sessionId) ||
      (grant.scope === "once" && grant.approvalId !== authorization.approvalId)
    )
      throw denied();
  }
  for (const capability of call.capabilities) {
    if (capability === "app.dispatch_task") continue;
    const mode = policies.find((policy) => policy.capability === capability)!.mode;
    if (mode === "deny") throw denied();
    if (mode === "allow") continue;
    const grant = grants.find(
      (grant) => grant.capability === capability && authorization.grantIds.includes(grant.id),
    );
    if (
      grant === undefined ||
      grant.botId !== call.botId ||
      !usable(db, grant, call.generation, true) ||
      (grant.scope === "session" && grant.sessionId !== call.sessionId) ||
      (grant.scope === "once" && grant.approvalId !== authorization.approvalId)
    )
      throw denied();
  }
}
export function requestPermissionApproval(
  db: OpenedDatabase,
  call: PermissionCall,
  expiresAt: string,
): AppApproval {
  validateCall(call);
  if (!activeBot(db, call.botId)) throw denied("permission actor is required");
  const approval = validate(AppApprovalSchema, {
    ...call,
    id: randomUUID(),
    status: "pending",
    createdAt: now(db),
    expiresAt,
    decidedAt: null,
  });
  if (approval.expiresAt <= now(db))
    throw invalidInput("permission approval expiry must be in the future");
  return runInTransaction(db.raw, () => {
    if (
      db.raw
        .prepare("SELECT id FROM app_approvals WHERE invocation_id = ?")
        .get(call.invocationId) !== undefined
    )
      throw invalidInput("permission invocation already has an approval");
    writeApproval(db, approval);
    audit(db, "approval.requested", "agent", call, [], approval.id);
    return approval;
  });
}
function approvalCall(approval: AppApproval): PermissionCall {
  return {
    invocationId: approval.invocationId,
    callerId: approval.callerId,
    botId: approval.botId,
    sessionId: approval.sessionId,
    tool: approval.tool,
    capabilities: approval.capabilities,
    params: approval.params,
    actionDigest: approval.actionDigest,
    generation: approval.generation,
  };
}
function finishApproval(
  db: OpenedDatabase,
  approval: AppApproval,
  status: AppApproval["status"],
  actor: PermissionAudit["actor"],
): AppApproval {
  const updated = writeApproval(db, { ...approval, status, decidedAt: now(db) });
  const decision =
    status === "expired"
      ? "approval.expired"
      : status === "denied"
        ? "approval.denied"
        : status === "consumed"
          ? "approval.approved"
          : "cancelled";
  audit(db, decision, actor, approvalCall(approval), [], approval.id);
  return updated;
}
export function decidePermissionApproval(
  db: OpenedDatabase,
  input: PermissionDecisionRequest,
  generation: number,
): {
  approval: AppApproval;
  grants: PermissionGrant[];
  authorization?: PermissionAuthorization;
  call?: PermissionCall;
} {
  const request = validate(PermissionDecisionRequestSchema, input);
  // Return expiration from the transaction; throw only after COMMIT so stale decisions durably expire.
  const result = runInTransaction(db.raw, () => {
    const approval = getPermissionApproval(db, request.approvalId);
    if (approval === undefined || approval.status !== "pending")
      throw invalidInput("permission approval is not pending");
    if (approval.generation !== generation || approval.expiresAt <= now(db)) {
      finishApproval(db, approval, "expired", "host");
      return undefined;
    }
    if (approval.actionDigest !== request.expectedActionDigest)
      throw invalidInput("permission approval digest mismatch");
    const call = approvalCall(approval);
    if (request.decision === "denied")
      return { approval: finishApproval(db, approval, "denied", "human"), grants: [] };
    if (!activeBot(db, call.botId)) throw denied("permission actor is not active");
    if (request.scope !== "once" && call.capabilities.some(requiresPerActionApproval))
      throw invalidInput("capability requires per-action approval");
    if (request.scope === "session" && call.sessionId === null)
      throw invalidInput("session grant requires a session");
    const before = plan(db, call);
    if (before.authorization.code === "UNAUTHORIZED_PATH") throw denied();
    const issued: PermissionGrant[] = [];
    for (const capability of before.authorization.missing ?? []) {
      const grant = writeGrant(db, {
        id: randomUUID(),
        capability,
        botId: call.botId,
        mode: "allow",
        scope: request.scope,
        sessionId: request.scope === "session" ? call.sessionId : null,
        generation: request.scope === "permanent" ? null : generation,
        approvalId: request.scope === "once" ? approval.id : null,
        maxUses:
          request.scope === "permanent"
            ? null
            : request.scope === "once"
              ? 1
              : (request.maxUses ?? 5),
        uses: 0,
        expiresAt:
          request.scope === "permanent"
            ? null
            : request.scope === "once"
              ? approval.expiresAt
              : new Date(db.now().getTime() + (request.ttlMinutes ?? 120) * 60_000).toISOString(),
        createdAt: now(db),
        revokedAt: null,
      });
      issued.push(grant);
      audit(db, "grant.issued", "human", call, [grant.id], approval.id);
    }
    const { authorization, selected } = plan(db, call, approval.id);
    if (!authorization.allowed) throw denied();
    consume(db, call, authorization, selected);
    const updated = finishApproval(db, approval, "consumed", "human");
    return {
      approval: updated,
      grants: issued.map((grant) => allGrants(db).find((row) => row.id === grant.id)!),
      authorization,
      call,
    };
  });
  if (result === undefined)
    throw new StorageError({
      code: "APPROVAL_EXPIRED",
      message: "permission approval expired",
      retryable: false,
    });
  return result;
}
/**
 * Bot-to-bot messaging is not a human permission. A pending ask that only
 * covers dispatch is cancelled so the chat does not keep a card or an
 * "已始终允许 … 派发任务给其他 bot" line for a capability this request did not
 * need. An ask that also needs a real capability stays pending.
 */
export function cancelUnaskedDispatchApprovals(
  db: OpenedDatabase,
  generation: number,
): AppApproval[] {
  return runInTransaction(db.raw, () => {
    const cancelled: AppApproval[] = [];
    for (const approval of listPermissionApprovals(db, { status: "pending" })) {
      if (approval.generation !== generation) continue;
      if (
        approval.capabilities.length === 0 ||
        approval.capabilities.some((capability) => capability !== "app.dispatch_task")
      ) {
        continue;
      }
      cancelled.push(finishApproval(db, approval, "cancelled", "host"));
    }
    return cancelled;
  });
}
export function cancelPermissionApproval(
  db: OpenedDatabase,
  id: string,
  status: "cancelled" | "expired",
  generation: number,
): AppApproval | undefined {
  return runInTransaction(db.raw, () => {
    const approval = getPermissionApproval(db, id);
    if (
      approval === undefined ||
      approval.status !== "pending" ||
      approval.generation !== generation
    )
      return approval;
    return finishApproval(db, approval, status, "host");
  });
}
export function expirePermissionState(db: OpenedDatabase, generation: number): void {
  runInTransaction(db.raw, () => {
    const rows = db.raw.prepare("SELECT payload_json FROM app_approvals").all() as JsonRow[];
    for (const row of rows) {
      const approval = parseJsonColumn(AppApprovalSchema, row.payload_json, "app approval");
      if (
        approval.status === "pending" &&
        (approval.generation !== generation || approval.expiresAt <= now(db))
      )
        finishApproval(db, approval, "expired", "host");
    }
    for (const grant of allGrants(db)) {
      if (
        (grant.scope === "once" || grant.scope === "session") &&
        grant.generation !== generation &&
        grant.revokedAt === null
      ) {
        writeGrant(db, { ...grant, revokedAt: now(db) });
        audit(
          db,
          "grant.revoked",
          "host",
          undefined,
          [grant.id],
          grant.approvalId,
          [grant.capability],
          grant.botId,
        );
      }
    }
  });
}
