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
  UuidSchema,
  type Method,
  type MethodRequest,
  type MethodResponse,
  type WorkflowDraft,
} from "@deepseek-bot/contracts";
import {
  approveEventRuleReview,
  denyEventRuleReview,
  EngineError,
  type LocalScheduler,
  type WorkflowEngine,
} from "@deepseek-bot/runtime";
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
  deleteMemory,
  listMemories,
  writeMemory,
  deleteKnowledgeDoc,
  listKnowledgeDocs,
  searchKnowledge,
  writeKnowledgeDoc,
  readRetentionPolicy,
  writeRetentionPolicy,
  sweepRetention,
  deleteTriggerRule,
  decideTriggerFiring,
  getTriggerFiring,
  listTriggerFirings,
  listTriggerRules,
  saveTriggerRule,
  setTriggerEnabled,
  getEventRule,
  listEventRules,
  listEventRuleRecords,
  listEventRuleStates,
  listDeviceActionRecords,
  listPendingEventRuleReviews,
  saveEventRule,
  setEventRuleEnabled,
  setEventRuleReview,
  listConnectors,
  registerConnector,
  setConnectorEnabled,
  setConnectorEndpoint,
  setConnectorCommand,
  getBotMcpGrants,
  setBotMcpGrant,
  updateBot,
  type BotPatch,
  type ConnectorRow,
  type DataLayout,
  type OpenedDatabase,
  listPermissionPolicies,
  setPermissionPolicy,
  listPermissionGrants,
  issuePermissionGrant,
  revokePermissionGrant,
  listPermissionApprovals,
  listPermissionAudit,
  countTasks,
  listTaskEvents,
} from "@deepseek-bot/storage";
import type { AgentPermissionService } from "./agent-permissions.js";
import type { McpService } from "./mcp.js";
import type { ScreenService } from "./screen.js";
import type { DeviceActionService } from "./device.js";
import type { DeviceInputService } from "./device-input.js";
import type { WorkspaceArtifacts } from "./artifacts.js";
import {
  DEFAULT_MODEL_PROFILE_ID,
  SEARXNG_ENDPOINT_SETTING,
  UI_LOCALE_SETTING,
  asUiLocale,
  backupDirFor,
  newBackupId,
  type UiLocale,
} from "./host.js";
import { chatSessionIdFor, type ChatManager } from "./chat.js";
import { KNOWN_CAPABILITIES, policyKey, readPolicy, type PolicyLevel } from "./permissions.js";
import { type TaskDispatcher } from "./task-dispatcher.js";
import { createGrant, listGrants, revokeGrant, type GrantRow } from "@deepseek-bot/storage";
import {
  ToolRejectionError,
  type AskUserRequest,
  type ToolGateway,
  type UserQuestionControls,
} from "@deepseek-bot/agent-tools";

export interface ChatSearchRecord {
  readonly query: string;
  readonly results: Array<{ title: string; url: string; snippet: string }>;
  readonly warnings: string[];
  readonly at: string;
}

export interface HostContext {
  readonly permissions: AgentPermissionService;
  readonly mcp: McpService;
  readonly screen: ScreenService;
  readonly device: DeviceActionService;
  readonly deviceInput: DeviceInputService;
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
  /** D28 co-edit sidecar over bot workspace files. */
  readonly artifacts: WorkspaceArtifacts;
  /** Trusted ask_user controls. The desktop answers; the model never sees these methods. */
  readonly userQuestions: UserQuestionControls;
  /** Trusted SearXNG endpoint. The model cannot set or read this through a tool. */
  readonly webSearch: {
    currentEndpoint(): string | undefined;
    setEndpoint(endpoint: string | undefined): void;
  };
  /** In-memory chat search cards for one bot. Restart clears them. */
  readonly searchResults: {
    list(botId: string): ChatSearchRecord[];
  };
  /** v0.5 manager orchestration: dispatched-task queue + executor. */
  readonly tasks: TaskDispatcher;
  /**
   * Live UI language holder (settings.update { ui.locale }). Delivery notices,
   * handoff framing and the ask_user fallback label come out in this language.
   */
  readonly locale: { current: UiLocale };
}

/** The Host never renders or persists the model's own label for the fallback option. */
const ASK_USER_OTHER_ID = "D";
const ASK_USER_OTHER_LABELS: Readonly<Record<UiLocale, string>> = {
  zh: "以上都不是",
  en: "None of the above",
};

function displayAskUserOption(
  option: AskUserRequest["options"][number],
  locale: UiLocale,
): {
  id: AskUserRequest["options"][number]["id"];
  label: string;
} {
  return option.id === ASK_USER_OTHER_ID
    ? { id: option.id, label: ASK_USER_OTHER_LABELS[locale] }
    : option;
}

/**
 * Assistant-side chat row for one ask_user round trip: the question as the
 * user saw it (D forced), persisted when the answer arrives so a restart
 * replays a coherent "bot asked / user answered" context for the model.
 */
const ASKED_QUESTION_FRAMING: Readonly<
  Record<UiLocale, (question: string, lines: string) => string>
> = {
  zh: (question, lines) => `【向用户提问】${question}\n${lines}`,
  en: (question, lines) => `[Asked the user] ${question}\n${lines}`,
};

function formatAskedQuestion(request: AskUserRequest, locale: UiLocale): string {
  const lines = request.options.map(
    (option) =>
      `${displayAskUserOption(option, locale).id}. ${displayAskUserOption(option, locale).label}`,
  );
  return ASKED_QUESTION_FRAMING[locale](request.question, lines.join("\n"));
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

/** Storage rows carry createdAt; the wire shape calls it `at`. */
function toEventRuleResponse(row: {
  id: string;
  botId: string;
  name: string;
  workflowId: string;
  eventType: "run.failed" | "run.completed";
  enabled: boolean;
  review: boolean;
  createdAt: string;
  updatedAt: string;
}): {
  id: string;
  botId: string;
  name: string;
  workflowId: string;
  eventType: "run.failed" | "run.completed";
  enabled: boolean;
  review: boolean;
  at: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    botId: row.botId,
    name: row.name,
    workflowId: row.workflowId,
    eventType: row.eventType,
    enabled: row.enabled,
    review: row.review,
    at: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRuleResponse(row: {
  id: string;
  name: string;
  workflowId: string;
  eventType: "run.failed" | "run.completed";
  filterWorkflowId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}): {
  id: string;
  name: string;
  workflowId: string;
  eventType: "run.failed" | "run.completed";
  filterWorkflowId: string | null;
  enabled: boolean;
  at: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflowId,
    eventType: row.eventType,
    filterWorkflowId: row.filterWorkflowId,
    enabled: row.enabled,
    at: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** bot.create/bot.update accept a groupId; it must reference a live group. */
function requireLiveBot(db: OpenedDatabase, botId: string) {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots cannot chat");
  return bot;
}

function requireGroup(db: OpenedDatabase, groupId: string): void {
  const group = getGroup(db, groupId);
  if (group === undefined) {
    throw invalid("group does not exist", { groupId });
  }
  if (group.archivedAt !== null) {
    throw invalid("group is archived", { groupId });
  }
}

function connectorPayload<E extends boolean>(row: ConnectorRow, enabled?: E) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: (enabled ?? row.enabled) as E,
    credentialRef: row.credentialRef,
    endpoint: row.endpoint,
    command: row.command,
    args: [...row.args],
    credentialEnv: row.credentialEnv,
    at: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
      if (policy.mode === "deny" && policy.capability === "mcp.call") context.mcp.invalidate({});
      if (policy.capability === "screen.capture") context.screen.invalidate();
      if (policy.capability === "device.action") {
        context.device.invalidate();
        context.deviceInput.invalidate();
      }
      return policy;
    },
    "permission.grant.list": (payload) => ({
      grants: listPermissionGrants(db, {
        ...(payload.botId !== undefined ? { botId: payload.botId } : {}),
        includeInactive: payload.includeInactive,
        limit: payload.limit,
        generation: context.permissions.generation,
      }),
    }),
    "permission.grant.revoke": (payload) => {
      const grant = revokePermissionGrant(db, payload.grantId);
      if (grant.capability === "mcp.call" && grant.botId !== null) {
        context.mcp.invalidate({ botId: grant.botId });
        context.permissions.cancelMcp({ botId: grant.botId });
      }
      return { grant };
    },
    "permission.grant.issue": (payload) => {
      requireLiveBot(db, payload.botId);
      return {
        grant: issuePermissionGrant(
          db,
          {
            botId: payload.botId,
            capability: payload.capability,
            scope: payload.scope,
            sessionId: payload.scope === "session" ? chatSessionIdFor(payload.botId) : null,
          },
          context.permissions.generation,
        ),
      };
    },
    "permission.approval.list": (payload) => ({
      approvals: listPermissionApprovals(db, {
        ...(payload.botId !== undefined ? { botId: payload.botId } : {}),
        status: payload.status,
        limit: payload.limit,
      }),
    }),
    "permission.approval.decide": (payload) => context.permissions.decide(payload),
    "permission.audit.list": (payload) => ({
      records: listPermissionAudit(db, {
        ...(payload.botId !== undefined ? { botId: payload.botId } : {}),
        afterSequence: payload.afterSequence,
        limit: payload.limit,
      }),
    }),
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
          // v0.5: the human editor may mint a coordinator directly; the
          // model-facing batch path never carries a role.
          role: payload.role ?? "standard",
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
        // v0.5 coordinator role: human editor surface only.
        ...(p.role !== undefined ? { role: p.role } : {}),
        ...(p.avatar !== undefined ? { avatar: p.avatar } : {}),
        ...(p.groupId !== undefined ? { groupId: p.groupId } : {}),
      };
      const bot = updateBot(db, {
        id: payload.id,
        expectedRevision: payload.expectedRevision,
        patch,
      });
      if (p.toolPolicyId !== undefined) {
        context.mcp.invalidate({ botId: bot.id });
        context.permissions.cancelMcp({ botId: bot.id });
      }
      return bot;
    },

    "bot.archive": (payload) => {
      const bot = archiveBot(db, payload);
      context.mcp.invalidate({ botId: payload.id });
      context.permissions.cancelMcp({ botId: payload.id });
      context.screen.release(payload.id);
      return bot;
    },

    /**
     * D15 write layer (FR-12): one atomic batch — mint the group when the
     * request carries newGroup, auto-assign pool-distinct avatars (explicit
     * values win), record the ledger row that backs creation.revoke.
     */
    "bot.batchCreate": (payload) => {
      const defaults = payload.defaults;
      const resolve = (
        value: string | undefined,
        fallback: string | undefined,
        field: string,
      ): string => {
        const effective = value ?? fallback;
        if (effective === undefined) {
          throw invalid(`batch bot is missing ${field} (no explicit value and no batch default)`);
        }
        return effective;
      };
      const result = createBotBatch(db, {
        batchId: randomUUID(),
        ...(payload.idempotencyKey !== undefined ? { requestId: payload.idempotencyKey } : {}),
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
            modelProfileId: resolve(
              entry.modelProfileId,
              defaults?.modelProfileId,
              "modelProfileId",
            ),
            workspaceId: resolve(entry.workspaceId, defaults?.workspaceId, "workspaceId"),
            toolPolicyId: resolve(entry.toolPolicyId, defaults?.toolPolicyId, "toolPolicyId"),
            // Batch creation (the model-facing path) never carries a role.
            role: "standard" as const,
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
        context.mcp.invalidate({ botId });
        context.permissions.cancelMcp({ botId });
        context.screen.release(botId);
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

    "workflow.list": () => ({
      workflows: listWorkflows(db).map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        revision: workflow.revision,
      })),
    }),

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
        ...(payload.idempotencyKey !== undefined ? { idempotencyKey: payload.idempotencyKey } : {}),
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
      // never forces a snapshot in this host build. v0.5 adds the task log:
      // exactly one of runId/taskId arrives (contract refine), and task
      // replays return taskEvents instead of run events.
      if (payload.runId !== undefined) {
        return {
          events: listEvents(db, payload.runId, { afterSequence: payload.afterSequence }),
          snapshotRequired: false,
        };
      }
      return {
        events: [],
        taskEvents: listTaskEvents(db, payload.taskId ?? "", {
          afterSequence: payload.afterSequence,
        }),
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
        ...(payload.schedule.enabled !== undefined ? { enabled: payload.schedule.enabled } : {}),
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
        ...(row.meta !== undefined ? { meta: row.meta } : {}),
        at: row.createdAt,
      })),
    }),

    "chat.cancel": (payload) => {
      const cancelled = chat.cancel(payload.sessionId);
      const botId = payload.sessionId.startsWith("chat:")
        ? payload.sessionId.slice("chat:".length)
        : payload.sessionId;
      if (UuidSchema.safeParse(botId).success) context.screen.cancel(botId);
      return { cancelled };
    },

    // Polled by the renderer's pending status line; stages are real harness
    // events only (see ChatManager.status).
    "chat.status": (payload) => chat.status(payload.botId),

    /**
     * v0.5 manager orchestration. task.dispatch is the gateway-internal
     * surface for the dispatch_task tool: the dispatcher re-checks the
     * coordinator rules authoritatively (the tool layer already rejected
     * with explanations) and persists the queue entry. task.list is the
     * human + read-tool query; task.cancel is human-only (Q2).
     */
    "task.dispatch": (payload) =>
      context.tasks.dispatch({
        fromBotId: payload.fromBotId,
        toBotId: payload.toBotId,
        task: payload.task,
        ...(payload.context !== undefined ? { context: payload.context } : {}),
        ...(payload.chain !== undefined ? { chain: payload.chain } : {}),
      }),

    "task.list": (payload) => ({
      tasks: context.tasks.list({
        ...(payload.fromBotId !== undefined ? { fromBotId: payload.fromBotId } : {}),
        ...(payload.toBotId !== undefined ? { toBotId: payload.toBotId } : {}),
        ...(payload.rootTaskId !== undefined ? { rootTaskId: payload.rootTaskId } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        limit: payload.limit,
      }),
    }),

    "task.cancel": (payload) => context.tasks.cancel(payload.taskId),

    "question.list": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      return {
        questions: context.userQuestions.listPending(chatSessionIdFor(bot.id)).map((request) => ({
          requestId: request.requestId,
          question: request.question,
          options: request.options.map((option) =>
            displayAskUserOption(option, context.locale.current),
          ),
          allowOther: request.allowOther,
          expiresAt: request.expiresAt,
        })),
      };
    },

    "question.answer": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      const callerId = chatSessionIdFor(bot.id);
      // Snapshot the pending question before answering so the assistant-side
      // question row lands right before the answer row (FR-6 persistence).
      const pending = context.userQuestions
        .listPending(callerId)
        .find((request) => request.requestId === payload.requestId);
      let result;
      try {
        result = context.userQuestions.answer(
          payload.requestId,
          callerId,
          "optionId" in payload ? { optionId: payload.optionId } : { text: payload.text },
        );
      } catch (error) {
        if (error instanceof ToolRejectionError) {
          throw new EngineError({
            code: error.code,
            message: error.message,
            retryable: false,
          });
        }
        throw error;
      }
      if (pending !== undefined) {
        appendChatMessage(db, {
          botId: bot.id,
          sessionId: callerId,
          role: "assistant",
          text: formatAskedQuestion(pending, context.locale.current),
        });
      }
      const message = appendChatMessage(db, {
        botId: bot.id,
        sessionId: callerId,
        role: "user",
        text: result.text,
      });
      return {
        requestId: result.requestId,
        ...(result.optionId !== undefined ? { optionId: result.optionId } : {}),
        text: result.text,
        messageId: message.id,
        at: message.createdAt,
      };
    },

    "search.config.get": () => ({ endpoint: context.webSearch.currentEndpoint() ?? null }),

    "search.config.set": (payload) => {
      try {
        context.webSearch.setEndpoint(payload.endpoint ?? undefined);
      } catch (error) {
        if (error instanceof ToolRejectionError) {
          throw new EngineError({ code: error.code, message: error.message, retryable: false });
        }
        throw error;
      }
      setSetting(db, SEARXNG_ENDPOINT_SETTING, payload.endpoint);
      return { endpoint: payload.endpoint };
    },

    "search.results.list": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      return { searches: context.searchResults.list(bot.id) };
    },

    "memory.list": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      return {
        memories: listMemories(db, {
          botId: bot.id,
          ...(payload.query !== undefined ? { query: payload.query } : {}),
          limit: payload.limit,
        }).map((row) => ({
          id: row.id,
          botId: row.botId,
          text: row.text,
          at: row.createdAt,
        })),
      };
    },

    "memory.write": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      const row = writeMemory(db, { botId: bot.id, text: payload.text });
      // Retention limits apply right after a write, so the configured cap
      // holds without waiting for the next host restart.
      sweepRetention(db, readRetentionPolicy(db), now());
      return { id: row.id, botId: row.botId, text: row.text, at: row.createdAt };
    },

    "memory.delete": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      deleteMemory(db, { botId: bot.id, memoryId: payload.memoryId });
      return { deleted: true as const };
    },

    // D20 event automation: rules and the review queue. Nothing auto-starts;
    // trigger.firing.decide "start" reuses the run.start path (same policy
    // pinning, revision guard and idempotency semantics).
    "trigger.list": () => ({
      rules: listTriggerRules(db).map(toRuleResponse),
    }),

    "trigger.save": (payload) => {
      const rule = payload.rule;
      return toRuleResponse(
        saveTriggerRule(db, {
          ...(rule.id !== undefined ? { id: rule.id } : {}),
          name: rule.name,
          workflowId: rule.workflowId,
          eventType: rule.eventType,
          ...(rule.filterWorkflowId !== undefined
            ? { filterWorkflowId: rule.filterWorkflowId }
            : {}),
        }),
      );
    },

    "trigger.enable": (payload) => ({
      ...toRuleResponse(setTriggerEnabled(db, { id: payload.id, enabled: true })),
      enabled: true as const,
    }),

    "trigger.disable": (payload) => ({
      ...toRuleResponse(setTriggerEnabled(db, { id: payload.id, enabled: false })),
      enabled: false as const,
    }),

    "trigger.delete": (payload) => {
      deleteTriggerRule(db, payload.id);
      return { deleted: true as const };
    },

    "trigger.firing.list": (payload) => ({
      firings: listTriggerFirings(db, {
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        limit: payload.limit,
      }).map((firing) => ({
        id: firing.id,
        ruleId: firing.ruleId,
        ruleName: firing.ruleName,
        workflowId: firing.workflowId,
        eventType: firing.eventType,
        sourceRunId: firing.sourceRunId,
        reason: firing.reason,
        status: firing.status,
        at: firing.createdAt,
        decidedAt: firing.decidedAt,
      })),
    }),

    "trigger.firing.decide": (payload) => {
      const firing = getTriggerFiring(db, payload.firingId);
      if (firing === undefined) {
        throw invalid("trigger firing was not found", { firingId: payload.firingId });
      }
      if (payload.decision === "dismiss") {
        const decided = decideTriggerFiring(db, { firingId: firing.id, decision: "dismiss" });
        return {
          firing: { id: decided.id, status: decided.status, decidedAt: decided.decidedAt },
          runId: null,
        };
      }
      const workflow = getWorkflow(db, firing.workflowId);
      if (workflow === undefined) {
        throw invalid("target workflow no longer exists", { workflowId: firing.workflowId });
      }
      const { run } = engine.startRun({
        workflowId: firing.workflowId,
        trigger: { kind: "manual", idempotencyKey: randomUUID() },
      });
      const decided = decideTriggerFiring(db, {
        firingId: firing.id,
        decision: "start",
        startedRunId: run.id,
      });
      return {
        firing: { id: decided.id, status: decided.status, decidedAt: decided.decidedAt },
        runId: run.id,
      };
    },

    // Local event rules for one bot. The timer calls evaluateEventRules.
    // These methods save, list, switch, and decide a local review. Enabling,
    // disabling, or switching review on records that change. Default is off,
    // and review is off until eventRule.review. No network.
    "eventRule.list": (payload) => {
      requireLiveBot(db, payload.botId);
      return { rules: listEventRules(db, payload.botId).map(toEventRuleResponse) };
    },

    "eventRule.save": (payload) => {
      requireLiveBot(db, payload.botId);
      const rule = payload.rule;
      return toEventRuleResponse(
        saveEventRule(db, {
          ...(rule.id !== undefined ? { id: rule.id } : {}),
          botId: payload.botId,
          name: rule.name,
          workflowId: rule.workflowId,
          eventType: rule.eventType,
        }),
      );
    },

    "eventRule.enable": (payload) => ({
      ...toEventRuleResponse(
        setEventRuleEnabled(db, { id: payload.id, botId: payload.botId, enabled: true }),
      ),
      enabled: true as const,
    }),

    "eventRule.disable": (payload) => ({
      ...toEventRuleResponse(
        setEventRuleEnabled(db, { id: payload.id, botId: payload.botId, enabled: false }),
      ),
      enabled: false as const,
    }),

    "eventRule.record.list": (payload) => {
      requireLiveBot(db, payload.botId);
      if (payload.ruleId !== undefined) {
        const rule = getEventRule(db, payload.ruleId);
        if (rule === undefined || rule.botId !== payload.botId) {
          throw invalid("event rule was not found", { id: payload.ruleId });
        }
      }
      return {
        records: listEventRuleRecords(db, {
          botId: payload.botId,
          ...(payload.ruleId !== undefined ? { ruleId: payload.ruleId } : {}),
          ...(payload.outcome !== undefined ? { outcome: payload.outcome } : {}),
          limit: payload.limit,
        }).map((record) => ({
          id: record.id,
          ruleId: record.ruleId,
          eventId: record.eventId,
          outcome: record.outcome,
          runId: record.runId,
          reason: record.reason,
          at: record.createdAt,
        })),
      };
    },

    "eventRule.review": (payload) => ({
      ...toEventRuleResponse(setEventRuleReview(db, { id: payload.id, botId: payload.botId })),
      review: true as const,
    }),

    "eventRule.review.list": (payload) => {
      requireLiveBot(db, payload.botId);
      if (payload.ruleId !== undefined) {
        const rule = getEventRule(db, payload.ruleId);
        if (rule === undefined || rule.botId !== payload.botId) {
          throw invalid("event rule was not found", { id: payload.ruleId });
        }
      }
      return {
        items: listPendingEventRuleReviews(db, {
          botId: payload.botId,
          ...(payload.ruleId !== undefined ? { ruleId: payload.ruleId } : {}),
          limit: payload.limit,
        }).map((item) => ({
          id: item.id,
          ruleId: item.ruleId,
          eventId: item.eventId,
          status: "pending" as const,
          at: item.createdAt,
        })),
      };
    },

    "eventRule.review.approve": (payload) => {
      const review = approveEventRuleReview(db, engine, {
        botId: payload.botId,
        reviewId: payload.id,
      });
      return {
        id: review.id,
        ruleId: review.ruleId,
        eventId: review.eventId,
        status: "approved" as const,
        runId: review.runId,
        at: review.createdAt,
        decidedAt: review.decidedAt,
      };
    },

    "eventRule.review.deny": (payload) => {
      const review = denyEventRuleReview(db, { botId: payload.botId, reviewId: payload.id });
      return {
        id: review.id,
        ruleId: review.ruleId,
        eventId: review.eventId,
        status: "denied" as const,
        runId: null,
        at: review.createdAt,
        decidedAt: review.decidedAt,
      };
    },

    "eventRule.state.list": (payload) => {
      requireLiveBot(db, payload.botId);
      return {
        states: listEventRuleStates(db, {
          botId: payload.botId,
          limit: payload.limit,
        }).map((row) => ({
          id: row.id,
          ruleId: row.ruleId,
          botId: row.botId,
          state: row.state,
          at: row.createdAt,
        })),
      };
    },

    "memory.retention.get": () => ({ policy: readRetentionPolicy(db) }),

    "memory.retention.set": (payload) => ({
      policy: writeRetentionPolicy(db, payload.policy),
    }),

    // D18 独立知识表: long-form per-bot documents, separate from the 4k
    // memory notes. list stays summary-only; search ranks local windows.
    "knowledge.list": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      return {
        docs: listKnowledgeDocs(db, { botId: bot.id }).map((doc) => ({
          id: doc.id,
          botId: doc.botId,
          title: doc.title,
          size: doc.size,
          at: doc.createdAt,
        })),
      };
    },

    "knowledge.write": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      const doc = writeKnowledgeDoc(db, {
        botId: bot.id,
        title: payload.title,
        text: payload.text,
      });
      sweepRetention(db, readRetentionPolicy(db), now());
      return {
        id: doc.id,
        botId: doc.botId,
        title: doc.title,
        size: doc.size,
        at: doc.createdAt,
      };
    },

    "knowledge.delete": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      deleteKnowledgeDoc(db, { botId: bot.id, docId: payload.docId });
      return { deleted: true as const };
    },

    "knowledge.search": (payload) => {
      const bot = requireLiveBot(db, payload.botId);
      return {
        hits: searchKnowledge(db, {
          botId: bot.id,
          query: payload.query,
          limit: payload.limit,
        }),
      };
    },

    "connector.mcp.discover": async (payload) => ({
      tools: await context.mcp.discover(payload.id),
      at: now().toISOString(),
    }),
    "connector.mcp.grants.get": (payload) => ({ servers: getBotMcpGrants(db, payload.botId) }),
    "connector.mcp.grants.set": (payload) => {
      const servers = setBotMcpGrant(db, {
        botId: payload.botId,
        connectorId: payload.id,
        allowedTools: payload.allowedTools,
      });
      context.mcp.invalidate({ botId: payload.botId });
      context.permissions.cancelMcp({ botId: payload.botId });
      return { servers };
    },

    "screen.status": (payload) => context.screen.status(payload.botId),
    "screen.windows.list": () => context.screen.listWindows(AbortSignal.timeout(10_000)),
    "screen.target.set": (payload) => context.screen.select(payload.botId, payload.id),
    "screen.request": (payload) => context.screen.request(payload.botId, payload.mode),
    "screen.cancel": (payload) => context.screen.cancel(payload.botId),
    "screen.results.list": (payload) => context.screen.listResults(payload.botId),
    "screen.result.read": (payload) => context.screen.readResult(payload.botId, payload.id),
    "screen.result.delete": (payload) => context.screen.deleteResult(payload.botId, payload.id),
    "device.action.request": (payload) => context.device.request(payload.botId, payload.kind),
    "device.action.list": (payload) => {
      requireLiveBot(db, payload.botId);
      return {
        records: listDeviceActionRecords(db, {
          botId: payload.botId,
          limit: payload.limit,
        }).map((row) => ({
          id: row.id,
          botId: row.botId,
          action: row.action,
          at: row.createdAt,
        })),
      };
    },
    "device.action.input": (payload) => context.deviceInput.input(payload.botId, payload.input),
    "device.action.input.list": (payload) => context.deviceInput.list(payload.botId, payload.limit),

    "connector.list": () => ({
      connectors: listConnectors(db).map((row) => connectorPayload(row)),
    }),

    "connector.register": (payload) => {
      const row = registerConnector(db, {
        name: payload.name,
        kind: payload.kind,
        ...(payload.credentialRef !== undefined ? { credentialRef: payload.credentialRef } : {}),
        ...(payload.endpoint !== undefined ? { endpoint: payload.endpoint } : {}),
        ...(payload.command !== undefined ? { command: payload.command } : {}),
        ...(payload.args !== undefined ? { args: payload.args } : {}),
        ...(payload.credentialEnv !== undefined ? { credentialEnv: payload.credentialEnv } : {}),
      });
      return connectorPayload(row, false);
    },

    "connector.enable": (payload) => {
      const row = setConnectorEnabled(db, { id: payload.id, enabled: true });
      return connectorPayload(row, true);
    },

    "connector.disable": (payload) => {
      const row = setConnectorEnabled(db, { id: payload.id, enabled: false });
      context.mcp.invalidate({ connectorId: payload.id });
      context.permissions.cancelMcp({ connectorId: payload.id });
      return connectorPayload(row, false);
    },

    "connector.setEndpoint": (payload) => {
      const row = setConnectorEndpoint(db, { id: payload.id, endpoint: payload.endpoint });
      context.mcp.invalidate({ connectorId: payload.id });
      context.permissions.cancelMcp({ connectorId: payload.id });
      return connectorPayload(row);
    },

    "connector.setCommand": (payload) => {
      const row = setConnectorCommand(db, {
        id: payload.id,
        command: payload.command,
        args: payload.args,
      });
      context.mcp.invalidate({ connectorId: payload.id });
      context.permissions.cancelMcp({ connectorId: payload.id });
      return connectorPayload(row);
    },

    "artifacts.list": (payload) => context.artifacts.list(payload.botId),

    "artifacts.read": (payload) => context.artifacts.read(payload.botId, payload.path),

    "artifacts.save": (payload) =>
      context.artifacts.save(
        payload.botId,
        payload.path,
        payload.content,
        payload.expectedChecksum,
      ),

    "artifacts.versions": (payload) => context.artifacts.versions(payload.botId, payload.path),

    "artifacts.versionContent": (payload) =>
      context.artifacts.versionContent(payload.botId, payload.path, payload.versionId),

    "artifacts.revert": (payload) =>
      context.artifacts.revert(payload.botId, payload.path, payload.versionId),

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
      // The resolved UI language rides the same patch: apply it live so task
      // notices, handoff framing and ask_user labels follow the desktop
      // language without a Host restart. Non-string values are ignored here
      // and fall back to zh at the next boot seed.
      if (typeof payload.patch[UI_LOCALE_SETTING] === "string") {
        context.locale.current = asUiLocale(payload.patch[UI_LOCALE_SETTING]);
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
        tasks: countTasks(db),
      },
    }),
  };
}
