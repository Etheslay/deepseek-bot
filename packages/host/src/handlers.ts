/**
 * CONTRACTS §3 method handlers (D12).
 *
 * Handlers validate nothing themselves — the dispatcher already parsed the
 * payload against the method contract — and return a value matching the
 * response contract (the dispatcher re-validates it, so contract drift fails
 * in tests, not in production). Errors are thrown as EngineError (runtime)
 * or StorageError (storage) with stable codes; the desktop bridge maps them
 * to the wire error object.
 *
 * Unwired this slice: `settings.testConnection` needs the desktop credential
 * entry flow (safeStorage in the Electron main + settings.update storage),
 * so it fails with an explicit stable error instead of pretending. A data
 * restore replaces the database the engine holds, so the host tears down and
 * the caller restarts the process (CONTRACTS §3: restore stops everything).
 */
import { randomUUID } from "node:crypto";
import {
  WORKFLOW_SCHEMA_VERSION,
  validateWorkflowDraft,
  type Method,
  type MethodRequest,
  type MethodResponse,
  type WorkflowDraft,
} from "@deepseek-bot/contracts";
import { EngineError, type LocalScheduler, type WorkflowEngine } from "@deepseek-bot/runtime";
import {
  archiveBot,
  archiveBotUnchecked,
  archiveGroup,
  createBackup,
  createBot,
  createBotBatch,
  createGroup,
  getApproval,
  getBatch,
  getBot,
  getGroup,
  getRun,
  getWorkflow,
  listBots,
  listEvents,
  listGroups,
  listRuns,
  listSchedules,
  listWorkflows,
  getNodeRun,
  markBatchRevoked,
  restoreBackup,
  saveWorkflow,
  setSetting,
  getSettingRaw,
  appendChatMessage,
  listChatMessages,
  updateBot,
  type BotPatch,
  type DataLayout,
  type OpenedDatabase,
  listPermissionPolicies, setPermissionPolicy, listPermissionGrants,
  revokePermissionGrant, listPermissionApprovals, listPermissionAudit,
} from "@deepseek-bot/storage";
import type { AgentPermissionService } from "./agent-permissions.js";
import { DEFAULT_MODEL_PROFILE_ID, backupDirFor, newBackupId } from "./host.js";
import { chatSessionIdFor, type ChatManager } from "./chat.js";
import { KNOWN_CAPABILITIES, policyKey, readPolicy, type PolicyLevel } from "./permissions.js";
import {
  createGrant,
  listGrants,
  revokeGrant,
  type GrantRow,
} from "@deepseek-bot/storage";
import type { ToolGateway } from "@deepseek-bot/agent-tools";

export interface HostContext {
  readonly permissions: AgentPermissionService;
  readonly db: OpenedDatabase;
  readonly engine: WorkflowEngine;
  readonly scheduler: LocalScheduler;
  readonly layout: DataLayout;
  readonly now: () => Date;
  /** Desktop main decrypts credential blobs with safeStorage; Host never sees them. */
  readonly resolveApiKey: (credentialRef: string) => Promise<string>;
  /** Chat runtime (D30): one Harness session per bot. */
  readonly chat: ChatManager;
  /** D15 agent tool gateway; `tool.invoke` routes model calls through it. */
  readonly agentTools: ToolGateway;
}

function grantResponse(row: GrantRow): {
  id: string;
  capability: string;
  botId: string | null;
  scope: "once" | "session" | "persistent";
  maxUses: number;
  used: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    capability: row.capability,
    botId: row.botId,
    scope: row.scope,
    maxUses: row.maxUses,
    used: row.used,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export interface HandlerCallContext {
  readonly requestId?: string;
}

type Handler<M extends Method> = (
  payload: MethodRequest<M>,
  call: HandlerCallContext,
) => Promise<MethodResponse<M>> | MethodResponse<M>;

function invalid(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "INVALID_INPUT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

/** bot.create/bot.update accept a groupId; it must reference a live group. */
function requireGroup(db: OpenedDatabase, groupId: string): void {
  const group = getGroup(db, groupId);
  if (group === undefined) {
    throw invalid("group does not exist", { groupId });
  }
  if (group.archivedAt !== null) {
    throw invalid("group is archived", { groupId });
  }
}

/**
 * The full CONTRACTS §3 surface. The mapped type keeps each handler bound to
 * its own request/response pair, so the compiler flags any drift from the
 * method whitelist at build time.
 */
export function buildHandlers(context: HostContext): { [M in Method]: Handler<M> } {
  const { db, engine, scheduler, layout, now, resolveApiKey, chat } = context;
  return {
    "permission.policy.list": () => ({ policies: listPermissionPolicies(db) }),
    "permission.policy.set": (payload) => {
      const policy = setPermissionPolicy(db, payload);
      if (policy.mode === "deny") context.permissions.denyCapability(policy.capability);
      return policy;
    },
    "permission.grant.list": (payload) => ({ grants: listPermissionGrants(db, { ...(payload.botId !== undefined ? { botId: payload.botId } : {}), includeInactive: payload.includeInactive, limit: payload.limit, generation: context.permissions.generation }) }),
    "permission.grant.revoke": (payload) => ({ grant: revokePermissionGrant(db, payload.grantId) }),
    "permission.approval.list": (payload) => ({ approvals: listPermissionApprovals(db, { ...(payload.botId !== undefined ? { botId: payload.botId } : {}), status: payload.status, limit: payload.limit }) }),
    "permission.approval.decide": (payload) => context.permissions.decide(payload),
    "permission.audit.list": (payload) => ({ records: listPermissionAudit(db, { ...(payload.botId !== undefined ? { botId: payload.botId } : {}), afterSequence: payload.afterSequence, limit: payload.limit }) }),
    "bot.list": () => ({ bots: listBots(db) }),

    "bot.create": (payload, call) => {
      if (payload.groupId !== undefined) {
        requireGroup(db, payload.groupId);
      }
      const result = createBot(db, {
        bot: {
          id: randomUUID(),
          revision: randomUUID(),
          name: payload.name,
          instructions: payload.instructions,
          modelProfileId: payload.modelProfileId,
          workspaceId: payload.workspaceId,
          toolPolicyId: payload.toolPolicyId,
          ...(payload.avatar !== undefined ? { avatar: payload.avatar } : {}),
          ...(payload.groupId !== undefined ? { groupId: payload.groupId } : {}),
          archivedAt: null,
        },
        ...(call.requestId !== undefined ? { requestId: call.requestId } : {}),
      });
      return result.bot;
    },

    "bot.update": (payload) => {
      if (payload.patch.groupId !== undefined && payload.patch.groupId !== null) {
        requireGroup(db, payload.patch.groupId);
      }
      // Compact explicitly: the contract output carries optional-undefined
      // props that storage's BotPatch (exactOptionalPropertyTypes) rejects.
      const p = payload.patch;
      const patch: BotPatch = {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.instructions !== undefined ? { instructions: p.instructions } : {}),
        ...(p.modelProfileId !== undefined ? { modelProfileId: p.modelProfileId } : {}),
        ...(p.workspaceId !== undefined ? { workspaceId: p.workspaceId } : {}),
        ...(p.toolPolicyId !== undefined ? { toolPolicyId: p.toolPolicyId } : {}),
        ...(p.avatar !== undefined ? { avatar: p.avatar } : {}),
        ...(p.groupId !== undefined ? { groupId: p.groupId } : {}),
      };
      return updateBot(db, { id: payload.id, expectedRevision: payload.expectedRevision, patch });
    },

    "bot.archive": (payload) => archiveBot(db, payload),

    /**
     * D15 write layer (FR-12): one atomic batch — mint the group when the
     * request carries newGroup, auto-assign pool-distinct avatars (explicit
     * values win), record the ledger row that backs creation.revoke.
     */
    "bot.batchCreate": (payload) => {
      const defaults = payload.defaults;
      const resolve = (value: string | undefined, fallback: string | undefined, field: string): string => {
        const effective = value ?? fallback;
        if (effective === undefined) {
          throw invalid(`batch bot is missing ${field} (no explicit value and no batch default)`);
        }
        return effective;
      };
      const result = createBotBatch(db, {
        batchId: randomUUID(),
        ...(payload.idempotencyKey !== undefined
          ? { requestId: payload.idempotencyKey }
          : {}),
        ...(payload.newGroup !== undefined
          ? {
              newGroup: {
                id: randomUUID(),
                revision: randomUUID(),
                name: payload.newGroup.name,
                archivedAt: null,
              },
            }
          : {}),
        ...(payload.groupId !== undefined ? { groupId: payload.groupId } : {}),
        bots: payload.bots.map((entry) => ({
          bot: {
            id: randomUUID(),
            revision: randomUUID(),
            name: entry.name,
            instructions: entry.instructions,
            modelProfileId: resolve(entry.modelProfileId, defaults?.modelProfileId, "modelProfileId"),
            workspaceId: resolve(entry.workspaceId, defaults?.workspaceId, "workspaceId"),
            toolPolicyId: resolve(entry.toolPolicyId, defaults?.toolPolicyId, "toolPolicyId"),
            archivedAt: null,
          },
          ...(entry.avatar !== undefined ? { avatar: entry.avatar } : {}),
        })),
      });
      return { batchId: result.batchId, group: result.group, bots: result.bots };
    },

    "group.create": (payload) =>
      createGroup(db, {
        group: {
          id: randomUUID(),
          revision: randomUUID(),
          name: payload.name,
          archivedAt: null,
        },
      }),

    "group.list": () => ({ groups: listGroups(db) }),

    /** FR-12 整批撤销: archive what the batch created, then close the ledger row. */
    "creation.revoke": (payload) => {
      const batch = getBatch(db, payload.batchId);
      if (batch === undefined) {
        throw invalid("creation batch not found", { batchId: payload.batchId });
      }
      const revokedBotIds: string[] = [];
      for (const botId of batch.botIds) {
        const before = getBot(db, botId);
        if (before === undefined) {
          throw invalid("batch member no longer exists", { botId });
        }
        archiveBotUnchecked(db, { id: botId });
        if (before.archivedAt === null) {
          revokedBotIds.push(botId);
        }
      }
      let revokedGroupId: string | null = null;
      if (batch.createdGroupId !== null) {
        const group = getGroup(db, batch.createdGroupId);
        if (group !== undefined && group.archivedAt === null) {
          archiveGroup(db, { id: group.id, expectedRevision: group.revision });
          revokedGroupId = group.id;
        }
      }
      markBatchRevoked(db, payload.batchId);
      return { revokedBotIds, revokedGroupId };
    },

    "workflow.validate": (payload) => {
      const issues = validateWorkflowDraft(payload.workflow);
      return { valid: issues.length === 0, errors: issues };
    },

    "workflow.save": (payload) => {
      const result = saveWorkflow(db, payload.workflow, {
        ...(payload.expectedRevision !== undefined
          ? { expectedRevision: payload.expectedRevision }
          : {}),
      });
      return result.workflow;
    },

    "workflow.export": (payload) => {
      const workflow = getWorkflow(db, payload.id);
      if (workflow === undefined) {
        throw invalid("workflow not found", { workflowId: payload.id });
      }
      if (workflow.revision !== payload.expectedRevision) {
        throw new EngineError({
          code: "REVISION_CONFLICT",
          message: "workflow revision does not match the export request",
          details: { workflowId: payload.id },
          retryable: false,
        });
      }
      return { workflow, exportedAt: now().toISOString() };
    },

    "workflow.import": (payload) => {
      if (payload.template.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
        return { accepted: false, errors: [], errorCode: "DATA_VERSION_UNSUPPORTED" };
      }
      // Rebuild with the literal schemaVersion so the draft is a WorkflowDraft
      // after the guard above proved the versions equal.
      const draft: WorkflowDraft = {
        ...payload.template.workflow,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
      };
      const issues = validateWorkflowDraft(draft);
      if (issues.length > 0) {
        return { accepted: false, errors: issues };
      }
      saveWorkflow(db, draft);
      return { accepted: true, errors: [] };
    },

    "run.start": (payload) => {
      const workflow = getWorkflow(db, payload.workflowId);
      if (workflow === undefined) {
        throw invalid("workflow not found", { workflowId: payload.workflowId });
      }
      if (workflow.revision !== payload.expectedRevision) {
        throw new EngineError({
          code: "REVISION_CONFLICT",
          message: "workflow revision changed before the run started",
          details: { workflowId: payload.workflowId },
          retryable: false,
        });
      }
      const { run } = engine.startRun({
        workflowId: payload.workflowId,
        trigger: { kind: "manual", idempotencyKey: payload.idempotencyKey },
      });
      return run;
    },

    "run.get": (payload) => {
      const run = getRun(db, payload.runId);
      if (run === undefined) {
        throw invalid("run not found", { runId: payload.runId });
      }
      return run;
    },

    "run.list": (payload) => {
      const runs = listRuns(db, {
        ...(payload.status !== undefined ? { statuses: [payload.status] } : {}),
      }).slice(0, payload.limit);
      return { runs, nextCursor: null };
    },

    "run.cancel": async (payload) => engine.cancelRun(payload.runId),

    "run.resume": (payload) => {
      const { run } = engine.resumeRun({
        runId: payload.runId,
        ...(payload.idempotencyKey !== undefined
          ? { idempotencyKey: payload.idempotencyKey }
          : {}),
      });
      return run;
    },

    "run.retryNode": (payload) => {
      const nodeRun = getNodeRun(db, payload.nodeRunId);
      if (nodeRun === undefined) {
        throw invalid("node run not found", { nodeRunId: payload.nodeRunId });
      }
      engine.retryNode(nodeRun.runId, payload.nodeRunId);
      const retried = getNodeRun(db, payload.nodeRunId);
      if (retried === undefined) {
        throw new EngineError({
          code: "RUNTIME_UNAVAILABLE",
          message: "node run vanished after retry",
          retryable: false,
        });
      }
      return retried;
    },

    "events.subscribe": (payload) => {
      // Persisted events replay completely (storage owns the log), so a gap
      // never forces a snapshot in this host build.
      return {
        events: listEvents(db, payload.runId, { afterSequence: payload.afterSequence }),
        snapshotRequired: false,
      };
    },

    "approval.decide": (payload) => {
      engine.decideApproval(payload.approvalId, payload.decision, payload.expectedActionDigest);
      const approval = getApproval(db, payload.approvalId);
      if (approval === undefined) {
        throw invalid("approval not found", { approvalId: payload.approvalId });
      }
      return approval;
    },

    "schedule.save": (payload) =>
      scheduler.upsertSchedule({
        ...(payload.schedule.id !== undefined ? { id: payload.schedule.id } : {}),
        workflowId: payload.schedule.workflowId,
        timezone: payload.schedule.timezone,
        recurrence: payload.schedule.recurrence,
        ...(payload.schedule.enabled !== undefined
          ? { enabled: payload.schedule.enabled }
          : {}),
      }),

    "schedule.enable": (payload) => scheduler.setEnabled({ id: payload.id, enabled: true }),

    "schedule.disable": (payload) => scheduler.setEnabled({ id: payload.id, enabled: false }),

    "grant.create": (payload) =>
      grantResponse(
        createGrant(db, {
          capability: payload.capability,
          ...(payload.botId !== undefined ? { botId: payload.botId } : {}),
          scope: payload.scope,
          ...(payload.maxUses !== undefined ? { maxUses: payload.maxUses } : {}),
          ...(payload.expiresInSeconds !== undefined && payload.expiresInSeconds !== null
            ? { expiresInSeconds: payload.expiresInSeconds }
            : {}),
        }),
      ),

    "grant.list": (payload) => ({
      grants: listGrants(db, payload.capability).map(grantResponse),
    }),

    "grant.revoke": (payload) => ({ revoked: revokeGrant(db, payload.id) }),

    "policy.get": () => ({
      policies: Object.fromEntries(
        KNOWN_CAPABILITIES.map((capability) => [capability, readPolicy(db, capability)]),
      ) as Record<string, PolicyLevel>,
    }),

    "policy.set": (payload) => {
      setSetting(db, policyKey(payload.capability), payload.policy);
      return { ok: true as const };
    },

    "tool.invoke": async (payload) => ({
      result: await context.agentTools.call(
        { id: `agent:${payload.callerBotId ?? "unknown"}` },
        payload.tool,
        payload.params ?? {},
      ),
    }),

    "chat.send": async (payload) => {
      const bot = getBot(db, payload.botId);
      if (bot === undefined) {
        throw invalid(`bot '${payload.botId}' was not found`);
      }
      if (bot.archivedAt !== null) {
        throw invalid("archived bots cannot chat");
      }
      const sessionId = chatSessionIdFor(bot.id);
      const history = listChatMessages(db, bot.id, 20).map((row) => ({
        role: row.role,
        text: row.text,
      }));
      appendChatMessage(db, {
        botId: bot.id,
        sessionId,
        role: "user",
        text: payload.text,
      });
      const outcome = await chat.send(bot, payload.text, history);
      const assistant = appendChatMessage(db, {
        botId: bot.id,
        sessionId,
        role: "assistant",
        text: outcome.finalResponse,
      });
      return {
        sessionId: outcome.sessionId,
        messageId: assistant.id,
        text: outcome.finalResponse,
        at: assistant.createdAt,
      };
    },

    "chat.history": (payload) => ({
      messages: listChatMessages(db, payload.botId, payload.limit).map((row) => ({
        id: row.id,
        botId: row.botId,
        sessionId: row.sessionId,
        role: row.role,
        text: row.text,
        at: row.createdAt,
      })),
    }),

    "chat.cancel": (payload) => ({ cancelled: chat.cancel(payload.sessionId) }),

    "settings.testConnection": async (payload) => {
      const credentialRef = getSettingRaw(db, "apiKeyRef");
      if (typeof credentialRef !== "string" || !credentialRef.startsWith("cred:")) {
        throw invalid("还没有保存 API Key，请先在设置中保存后再测试连接");
      }
      const started = Date.now();
      try {
        const apiKey = await resolveApiKey(credentialRef);
        const endpoint = payload.modelProfile.endpoint.replace(/\/+$/, "");
        const response = await fetch(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: payload.modelProfile.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          return { ok: true, latencyMs: Date.now() - started };
        }
        const errorCode =
          response.status === 401 || response.status === 403
            ? "AUTH_FAILED"
            : response.status === 429
              ? "RATE_LIMITED"
              : "MODEL_UNAVAILABLE";
        return { ok: false, latencyMs: Date.now() - started, errorCode };
      } catch {
        return { ok: false, errorCode: "RUNTIME_UNAVAILABLE" };
      }
    },

    "settings.update": (payload) => {
      for (const [key, value] of Object.entries(payload.patch)) {
        setSetting(db, key, value);
      }
      // Keep the default model profile pointed at the freshly saved key.
      const credentialRef = payload.patch["apiKeyRef"];
      if (typeof credentialRef === "string" && credentialRef.startsWith("cred:")) {
        const at = now().toISOString();
        // The blob itself lives in the desktop main (safeStorage); the Host
        // only registers the reference so the FK from model_profiles holds.
        db.raw
          .prepare(
            "INSERT OR IGNORE INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'default', ?, ?);",
          )
          .run(credentialRef, at, at);
        db.raw
          .prepare("UPDATE model_profiles SET credential_ref = ?, updated_at = ? WHERE id = ?;")
          .run(credentialRef, at, DEFAULT_MODEL_PROFILE_ID);
      }
      return { configured: true };
    },

    "data.backup": () => {
      const backupId = newBackupId();
      const manifest = createBackup({
        db,
        layout,
        destinationDir: backupDirFor(layout, backupId),
      });
      const sizeBytes = manifest.files.reduce((total, file) => total + file.bytes, 0);
      return { backupId, createdAt: manifest.createdAt, sizeBytes };
    },

    "data.restore": (payload) => {
      // restoreBackup refuses active runs and stashes the old database. The
      // engine holds the replaced handle, so this host is dead afterwards:
      // shutdown() is the caller's next move and the process restarts.
      const result = restoreBackup({ layout, sourceDir: backupDirFor(layout, payload.backupId) });
      result.db.close();
      return { restored: true };
    },

    "data.describe": () => ({
      schemaVersion: String(db.schemaVersion),
      counts: {
        bots: listBots(db).length,
        workflows: listWorkflows(db).length,
        runs: listRuns(db).length,
        schedules: listSchedules(db).length,
      },
    }),
  };
}





