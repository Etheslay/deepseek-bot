/**
 * Local Host assembly (D12, ARCHITECTURE §1/§2).
 *
 * One Host process owns one storage database, one workflow engine, one local
 * scheduler and one pinned Harness adapter, and serves the frozen CONTRACTS
 * §3 method surface through {@link DeepSeekBotHost.handleMethod}. The desktop
 * main process spawns this process (Node ≥ 24: node:sqlite) and bridges the
 * renderer to it over private IPC; the Host itself has no UI and no sockets
 * beyond the approval bridge's authenticated loopback server.
 *
 * Credential decryption stays outside: the desktop main owns safeStorage and
 * supplies `resolveApiKey`, so the Host never sees encrypted blobs' keys.
 *
 * Lifecycle: createHost recovers interrupted runs (QA-09) and the caller
 * starts the scheduler; shutdown stops the scheduler and the approval bridge
 * and closes the database. A data restore tears the host down (the engine
 * holds the replaced database); the caller restarts the process.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { methodContract, type Method } from "@deepseek-bot/contracts";
import {
  DshSdkExecutor,
  SessionRegistry,
  startApprovalBridgeServer,
  writeProfilePatches,
  type RunningApprovalBridge,
} from "@deepseek-bot/harness-adapter";
import { EngineError, WorkflowEngine, LocalScheduler, type ScheduleMissNotice } from "@deepseek-bot/runtime";
import {
  ensureDataLayout,
  getModelProfile,
  getWorkspace,
  incrementBootGeneration,
  openDatabase,
  type DataLayout,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { buildHandlers, type HostContext } from "./handlers.js";
import { AskUserCoordinator, JsonlAuditSink, ToolGateway, ToolRegistry, bindAskUserTool, bindReadTools, bindWriteTools, type UserQuestionControls } from "@deepseek-bot/agent-tools";

export interface HostOptions {
  /** Data root (storage layout: database, harness home, artifacts, backups). */
  readonly dataRoot: string;
  /**
   * Decrypt a credential reference to the model API key. The desktop main
   * implements this over safeStorage; the Host never touches encrypted blobs.
   */
  readonly resolveApiKey: (credentialRef: string) => Promise<string>;
  /** dsh CLI path override (tests inject the fake harness script). */
  readonly dshBin?: string;
  /** Extra child environment for harness attempts (test scenarios). */
  readonly childEnv?: (parentEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  /** Provider route for SDK-created agents. */
  readonly provider?: string;
  readonly now?: () => Date;
  readonly scheduler?: {
    readonly tickIntervalMs?: number;
    readonly misfireGraceMs?: number;
  };
  /** Skip-and-notify hook (FR-08): surfaced to the UI by the caller. */
  readonly onMissed?: (notices: ReadonlyArray<ScheduleMissNotice>) => void;
}

export interface DeepSeekBotHost {
  readonly layout: DataLayout;
  readonly db: OpenedDatabase;
  readonly engine: WorkflowEngine;
  readonly scheduler: LocalScheduler;
  readonly bridge: RunningApprovalBridge;
  readonly bootGeneration: number;
  /** Runs still recovered at startup (host restart before run completion). */
  readonly recoveredRuns: ReadonlyArray<{ runId: string; interruptedNodeRuns: number; expiredApprovals: number }>;
  /**
   * Execute one CONTRACTS §3 method. The payload is validated against the
   * method contract; the response is validated before returning. Errors are
   * EngineError/StorageError with stable codes — the desktop bridge maps them
   * to the wire error object.
   */
  handleMethod(method: Method, payload: unknown, requestId?: string): Promise<unknown>;
  /** D15 agent tool gateway (read + write layers; every call audited). */
  readonly agentTools: ToolGateway;
  /** Trusted in-process human controls. Never registered as model capabilities. */
  readonly userQuestions: UserQuestionControls;
  /** Start the scheduler tick loop (FR-08). */
  start(): void;
  /** Stop the scheduler, close the approval bridge and the database. */
  shutdown(): Promise<void>;
}

/**
 * Default rows the desktop UI references by fixed ids until the contract grows
 * profile/workspace/policy methods. Seeding keeps a fresh install usable:
 * bot.create needs a model profile, a workspace and a tool policy.
 */
export const DEFAULT_MODEL_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const DEFAULT_WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const DEFAULT_TOOL_POLICY_ID = "66666666-6666-4666-8666-666666666666";
const DEFAULT_CREDENTIAL_REF = "cred:00000000-0000-4000-8000-000000000001";

function seedDefaults(db: OpenedDatabase, layout: DataLayout): void {
  const now = db.now().toISOString();
  const workspacePath = join(layout.root, "workspace");
  mkdirSync(workspacePath, { recursive: true });
  db.raw
    .prepare(
      "INSERT OR IGNORE INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'default', ?, ?);",
    )
    .run(DEFAULT_CREDENTIAL_REF, now, now);
  db.raw
    .prepare(
      "INSERT OR IGNORE INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(DEFAULT_MODEL_PROFILE_ID, DEFAULT_CREDENTIAL_REF, now, now);
  db.raw
    .prepare(
      "INSERT OR IGNORE INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(DEFAULT_WORKSPACE_ID, workspacePath, now, now);
  db.raw
    .prepare(
      "INSERT OR IGNORE INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 'default', ?, ?, ?);",
    )
    .run(
      DEFAULT_TOOL_POLICY_ID,
      randomUUID(),
      JSON.stringify({
        filesystem: { enabled: true, operations: ["read", "write"] },
        shell: { mode: "approval" },
        network: { mode: "allow" },
        mcp: { enabled: false, requireApproval: true, servers: [] },
      }),
      now,
      now,
    );
}
export async function createHost(options: HostOptions): Promise<DeepSeekBotHost> {
  const layout = ensureDataLayout(options.dataRoot);
  const db = openDatabase(layout.dbFile);
  seedDefaults(db, layout);
  const bootGeneration = incrementBootGeneration(db);
  const patches = writeProfilePatches(layout.harnessHome);
  const now = options.now ?? (() => new Date());

  // The executor and the bridge reference each other (child env ← bridge
  // address; bridge asks → executor session registry), so the bridge handle
  // goes through a holder filled right after the bridge binds.
  const bridgeRef: { current?: RunningApprovalBridge } = {};
  const sessionRegistry = new SessionRegistry();
  const executor = new DshSdkExecutor(
    {
      ...(options.dshBin !== undefined ? { dshBin: options.dshBin } : {}),
      dshHome: layout.harnessHome,
      patches: [patches.telemetryPatchPath, patches.bridgePatchPath],
      childEnv: (parent) => ({
        ...parent,
        ...(options.childEnv !== undefined ? options.childEnv(parent) : {}),
        ...(bridgeRef.current !== undefined
          ? {
              DSB_BRIDGE_URL: bridgeRef.current.url,
              DSB_BRIDGE_TOKEN: bridgeRef.current.token,
            }
          : {}),
      }),
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      resolveBotInputs: async (bot) => {
        const profile = getModelProfile(db, bot.modelProfileId);
        if (profile === undefined) {
          throw new Error(`model profile '${bot.modelProfileId}' not found`);
        }
        const workspace = getWorkspace(db, bot.workspaceId);
        if (workspace === undefined) {
          throw new Error(`workspace '${bot.workspaceId}' not found`);
        }
        return {
          profile,
          workspacePath: workspace.canonicalPath,
          apiKey: await options.resolveApiKey(profile.credentialRef),
        };
      },
    },
    { sessionRegistry },
  );
  const bridge = await startApprovalBridgeServer({
    sessions: (sessionId) => sessionRegistry.resolve(sessionId),
  });
  bridgeRef.current = bridge;

  const engine = new WorkflowEngine({
    db,
    executor,
    bootGeneration,
    artifactsRoot: layout.artifacts,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const scheduler = new LocalScheduler({
    db,
    engine,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.scheduler?.tickIntervalMs !== undefined
      ? { tickIntervalMs: options.scheduler.tickIntervalMs }
      : {}),
    ...(options.scheduler?.misfireGraceMs !== undefined
      ? { misfireGraceMs: options.scheduler.misfireGraceMs }
      : {}),
    ...(options.onMissed !== undefined ? { onMissed: options.onMissed } : {}),
  });
  const recoveredRuns = engine.recoverInterruptedRuns();

  let closed = false;
  const context: HostContext = { db, engine, scheduler, layout, now, resolveApiKey: options.resolveApiKey };
  const handlers = buildHandlers(context);

  // D15: the agent tool gateway is the only sanctioned side-effect path for
  // agents (AGENT_PLATFORM §2); the read layer forwards to this host's own
  // contract surface and audits every call under the data-root logs.
  const dispatch = async (
    method: Method,
    payload: unknown,
    requestId?: string,
  ): Promise<unknown> => {
    if (closed) {
      throw new EngineError({
        code: "RUNTIME_UNAVAILABLE",
        message: "host is shut down (data restore requires a host restart)",
        retryable: false,
      });
    }
    const contract = methodContract(method);
      const parsed = contract.request.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: `request payload for '${method}' is invalid`,
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          retryable: false,
        });
      }
      // The mapped handler table is precise per method; the dynamic dispatch
      // goes through the contract-validated payload, and the response is
      // re-validated below before returning.
      const handler = handlers[method] as (
        payload: unknown,
        call: { readonly requestId?: string },
      ) => unknown;
      const result = await handler(parsed.data, {
        ...(requestId !== undefined ? { requestId } : {}),
      });
      const validated = contract.response.safeParse(result);
      if (!validated.success) {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: `response for '${method}' violated its contract (internal error)`,
          details: {
            issues: validated.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          retryable: false,
        });
      }
      return validated.data;
  };

  const agentRegistry = new ToolRegistry();
  const questions = new AskUserCoordinator();
  // D15: read layer (default-allow) plus the write layer (draft / group /
  // batch create / revoke). D16 replaces AllowAllGrants with the three-layer
  // grant/审批 checkpoint — until then write calls ride the same stub.
  for (const capability of [
    ...bindReadTools((method, payload) => dispatch(method as Method, payload)),
    ...bindWriteTools((method, payload) => dispatch(method as Method, payload)),
    bindAskUserTool(questions),
  ]) {
    agentRegistry.register(capability);
  }
  const agentTools = new ToolGateway({
    registry: agentRegistry,
    audit: new JsonlAuditSink(join(layout.logs, "agent-tools-audit.jsonl")),
  });

  return {
    layout,
    db,
    engine,
    scheduler,
    bridge,
    bootGeneration,
    recoveredRuns,
    agentTools,
    userQuestions: {
      listPending: (callerId) => questions.listPending(callerId),
      answer: (requestId, callerId, answer) => questions.answer(requestId, callerId, answer),
      cancel: (requestId, callerId) => questions.cancel(requestId, callerId),
    },
    handleMethod: dispatch,
    start(): void {
      scheduler.start();
    },
    async shutdown(): Promise<void> {
      closed = true;
      questions.close();
      scheduler.stop();
      await bridge.close();
      db.close();
    },
  };
}

/** Backup directory name for a backup id (backups live under layout.backups). */
export function backupDirFor(layout: DataLayout, backupId: string): string {
  return join(layout.backups, backupId);
}

/** Mint a backup id — the destination directory name doubles as the id. */
export function newBackupId(): string {
  return randomUUID();
}




