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
  createBackup,
  createBot,
  getApproval,
  getRun,
  getWorkflow,
  listBots,
  listEvents,
  listRuns,
  listSchedules,
  listWorkflows,
  getNodeRun,
  restoreBackup,
  saveWorkflow,
  setSetting,
  updateBot,
  type BotPatch,
  type DataLayout,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { backupDirFor, newBackupId } from "./host.js";

export interface HostContext {
  readonly db: OpenedDatabase;
  readonly engine: WorkflowEngine;
  readonly scheduler: LocalScheduler;
  readonly layout: DataLayout;
  readonly now: () => Date;
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

/**
 * The full CONTRACTS §3 surface. The mapped type keeps each handler bound to
 * its own request/response pair, so the compiler flags any drift from the
 * method whitelist at build time.
 */
export function buildHandlers(context: HostContext): { [M in Method]: Handler<M> } {
  const { db, engine, scheduler, layout, now } = context;
  return {
    "bot.list": () => ({ bots: listBots(db) }),

    "bot.create": (payload, call) => {
      const result = createBot(db, {
        bot: {
          id: randomUUID(),
          revision: randomUUID(),
          name: payload.name,
          instructions: payload.instructions,
          modelProfileId: payload.modelProfileId,
          workspaceId: payload.workspaceId,
          toolPolicyId: payload.toolPolicyId,
          archivedAt: null,
        },
        ...(call.requestId !== undefined ? { requestId: call.requestId } : {}),
      });
      return result.bot;
    },

    "bot.update": (payload) => {
      // Compact explicitly: the contract output carries optional-undefined
      // props that storage's BotPatch (exactOptionalPropertyTypes) rejects.
      const p = payload.patch;
      const patch: BotPatch = {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.instructions !== undefined ? { instructions: p.instructions } : {}),
        ...(p.modelProfileId !== undefined ? { modelProfileId: p.modelProfileId } : {}),
        ...(p.workspaceId !== undefined ? { workspaceId: p.workspaceId } : {}),
        ...(p.toolPolicyId !== undefined ? { toolPolicyId: p.toolPolicyId } : {}),
      };
      return updateBot(db, { id: payload.id, expectedRevision: payload.expectedRevision, patch });
    },

    "bot.archive": (payload) => archiveBot(db, payload),

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

    "settings.testConnection": () => {
      throw invalid(
        "settings.testConnection is not wired in this host slice: desktop credential flow pending (D12)",
      );
    },

    "settings.update": (payload) => {
      for (const [key, value] of Object.entries(payload.patch)) {
        setSetting(db, key, value);
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
