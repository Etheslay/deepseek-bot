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
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { methodContract, type Method, type ToolPolicy } from "@deepseek-bot/contracts";
import {
  DshSdkExecutor,
  SessionRegistry,
  startApprovalBridgeServer,
  writeProfilePatches,
  prepareAppToolProfile,
  type DshSdkExecutorOptions,
  type RunningApprovalBridge,
} from "@deepseek-bot/harness-adapter";
import { ChatManager } from "./chat.js";
import { EngineError, NodeExecutionError, WorkflowEngine, LocalScheduler, evaluateToolAction, type ScheduleMissNotice } from "@deepseek-bot/runtime";
import {
  appendChatMessage,
  ensureDataLayout,
  getBot,
  getModelProfile,
  getSettingRaw,
  getToolPolicy,
  getWorkspace,
  listMemories,
  writeMemory,
  searchKnowledge,
  readRetentionPolicy,
  sweepRetention,
  incrementBootGeneration,
  openDatabase,
  type DataLayout,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { buildHandlers, type ChatSearchRecord, type HostContext } from "./handlers.js";
import { AgentPermissionService } from "./agent-permissions.js";
import { AskUserCoordinator, JsonlAuditSink, ToolGateway, ToolRegistry, bindAskUserTool, bindReadTools, bindWriteTools, type UserQuestionControls } from "@deepseek-bot/agent-tools";
import {
  ToolRejectionError,
  WebSearchService,
  bindConnectorTools,
  bindKnowledgeTools,
  bindMemoryTools,
  bindWebSearchTool,
  type ToolCaller,
  type ToolNetworkPermissions,
  type WebSearchOptions,
  type WebSearchResult,
} from "@deepseek-bot/agent-tools";
import { startApplicationToolServer } from "./app-tool-channel.js";
import { invokeConnector } from "./connectors.js";

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
  /** Trusted SearXNG configuration. No key, default public endpoint or automatic requests. */
  readonly webSearch?: WebSearchOptions;
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
  /**
   * Chat-only D08 network handle. `allowed` proceeds, `disabled` denies, and
   * `approval-required` fails closed because a chat turn has no workflow run.
   */
  chatNetworkPermissions(caller: ToolCaller): ToolNetworkPermissions;
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
export const SEARXNG_ENDPOINT_SETTING = "searxng.endpoint";
const MAX_CHAT_SEARCHES = 20;
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
        shell: { mode: "approval-required" },
        network: { mode: "allowed" },
        mcp: { enabled: false, requireApproval: true, servers: [] },
      } satisfies Pick<ToolPolicy, "filesystem" | "shell" | "network" | "mcp">),
      now,
      now,
    );
  // D12 seeded two invalid legacy literals. Repair only this known default
  // record and those exact values; valid user settings and custom policies stay intact.
  for (const [path, legacy, current] of [
    ["$.network.mode", "allow", "allowed"],
    ["$.shell.mode", "approval", "approval-required"],
  ] as const) {
    db.raw.prepare(
      "UPDATE tool_policies SET policy_json = json_set(policy_json, ?, ?), revision = ?, updated_at = ? " +
      "WHERE id = ? AND CASE WHEN json_valid(policy_json) THEN json_extract(policy_json, ?) END = ?;",
    ).run(path, current, randomUUID(), now, DEFAULT_TOOL_POLICY_ID, path, legacy);
  }
}
export async function createHost(options: HostOptions): Promise<DeepSeekBotHost> {
  // Validate configuration before allocating the database or approval server.
  const webSearch = new WebSearchService(options.webSearch);
  const chatSearches = new Map<string, ChatSearchRecord[]>();
  const layout = ensureDataLayout(options.dataRoot);
  const db = openDatabase(layout.dbFile, options.now !== undefined ? { now: options.now } : {});
  seedDefaults(db, layout);
  restoreSearchEndpoint(webSearch, getSettingRaw(db, SEARXNG_ENDPOINT_SETTING));
  webSearch.observe((caller, result) => {
    try {
      recordChatSearch(db, chatSearches, caller, result);
    } catch {
      // A display write must not turn a completed search into a tool failure.
    }
  });
  const bootGeneration = incrementBootGeneration(db);
  const permissions = new AgentPermissionService(db, bootGeneration);
  const patches = writeProfilePatches(layout.harnessHome);
  const now = options.now ?? (() => new Date());

  // The executor and the bridge reference each other (child env ← bridge
  // address; bridge asks → executor session registry), so the bridge handle
  // goes through a holder filled right after the bridge binds.
  const bridgeRef: { current?: RunningApprovalBridge } = {};
  const sessionRegistry = new SessionRegistry();
  const executorOptions: DshSdkExecutorOptions = {
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
  };
  const executor = new DshSdkExecutor(executorOptions, { sessionRegistry });
  const packagedBridge = fileURLToPath(new URL("./harness-bridge/", import.meta.url));
  const bridgePackageDir = existsSync(join(packagedBridge, "package.json"))
    ? packagedBridge : fileURLToPath(new URL("../../harness-bridge/", import.meta.url));
  const chat = new ChatManager(executorOptions, {
    prepareProfile: () => prepareAppToolProfile({ dshHome: layout.harnessHome, bridgePackageDir }),
    openTurn: (sessionId, caller, signal) => {
      return applicationTools.openTurn({ sessionId, caller, signal });
    },
  });
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
  // D18 保留策略: apply configured limits once at startup so expiry and
  // caps hold even when nothing writes for a while.
  sweepRetention(db, readRetentionPolicy(db), now());

  let closed = false;
  const agentToolsHolder: { current?: ToolGateway } = {};
  const questions = new AskUserCoordinator();
  const context: HostContext = {
    db,
    engine,
    scheduler,
    layout,
    now,
    resolveApiKey: options.resolveApiKey,
    permissions,
    chat,
    userQuestions: questions,
    webSearch: {
      currentEndpoint: () => webSearch.currentEndpoint(),
      setEndpoint: (endpoint) => webSearch.setEndpoint(endpoint),
    },
    searchResults: {
      list: (botId) =>
        (chatSearches.get(botId) ?? []).map((item) => ({
          query: item.query,
          results: item.results.map((result) => ({ ...result })),
          warnings: [...item.warnings],
          at: item.at,
        })),
    },
    get agentTools(): ToolGateway {
      if (agentToolsHolder.current === undefined) {
        throw new Error("agent tools gateway is not ready yet");
      }
      return agentToolsHolder.current;
    },
  };
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
      if (method === "data.restore") permissions.close();
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
  // D16: every registered tool crosses the Host authorization checkpoint.
  for (const capability of [
    ...bindReadTools((method, payload) => dispatch(method as Method, payload)),
    ...bindWriteTools((method, payload) => dispatch(method as Method, payload)),
    bindAskUserTool(questions),
    bindWebSearchTool(webSearch),
    ...bindMemoryTools({
      write(botId, text) {
        const bot = getBot(db, botId);
        if (bot === undefined || bot.archivedAt !== null) {
          throw new ToolRejectionError("UNAUTHORIZED_PATH", "memory bot is not available");
        }
        const row = writeMemory(db, { botId, text });
        return { id: row.id, text: row.text, at: row.createdAt };
      },
      search(botId, query, limit) {
        const bot = getBot(db, botId);
        if (bot === undefined || bot.archivedAt !== null) {
          throw new ToolRejectionError("UNAUTHORIZED_PATH", "memory bot is not available");
        }
        return listMemories(db, { botId, query, limit }).map((row) => ({
          id: row.id,
          text: row.text,
          at: row.createdAt,
        }));
      },
    }),
    ...bindConnectorTools({
      invoke(connectorId, action, params) {
        return invokeConnector(db, layout.connectorOutputs, { connectorId, action, params }, { now });
      },
    }),
    ...bindKnowledgeTools({
      search(botId, query, limit) {
        const bot = getBot(db, botId);
        if (bot === undefined || bot.archivedAt !== null) {
          throw new ToolRejectionError("UNAUTHORIZED_PATH", "knowledge bot is not available");
        }
        return searchKnowledge(db, { botId, query, limit });
      },
    }),
  ]) {
    agentRegistry.register(capability);
  }
  const agentTools = new ToolGateway({
    registry: agentRegistry,
    audit: new JsonlAuditSink(join(layout.logs, "agent-tools-audit.jsonl")),
    grants: permissions,
  });
  agentToolsHolder.current = agentTools;
  const chatNetworkPermissions = (caller: ToolCaller): ToolNetworkPermissions => ({
    authorize: (action) => authorizeChatSearch(db, caller, action),
  });
  const applicationTools = await startApplicationToolServer(agentTools, {
    networkPermissions: chatNetworkPermissions,
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
    chatNetworkPermissions,
    handleMethod: dispatch,
    start(): void {
      scheduler.start();
    },
    async shutdown(): Promise<void> {
      if (closed) return;
      closed = true;
      permissions.close();
      questions.close();
      webSearch.close();
      scheduler.stop();
      try {
        await bridge.close();
      } finally {
        try {
          await applicationTools?.close();
          await chat.disposeAll();
        } finally {
          db.close();
        }
      }
    },
  };
}

function restoreSearchEndpoint(search: WebSearchService, saved: unknown): void {
  if (saved === null) {
    search.setEndpoint(undefined);
    return;
  }
  if (typeof saved !== "string") return;
  try {
    search.setEndpoint(saved);
  } catch (error) {
    if (!(error instanceof ToolRejectionError)) throw error;
  }
}

function recordChatSearch(
  db: OpenedDatabase,
  searches: Map<string, ChatSearchRecord[]>,
  caller: ToolCaller,
  result: WebSearchResult,
): void {
  if (caller.botId === undefined || !caller.id.startsWith("chat:")) return;
  const bot = getBot(db, caller.botId);
  if (bot === undefined || bot.archivedAt !== null) return;
  const record: ChatSearchRecord = {
    query: result.query,
    results: result.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
    })),
    warnings: [...result.warnings],
    at: db.now().toISOString(),
  };
  const current = searches.get(caller.botId) ?? [];
  current.push(record);
  searches.set(caller.botId, current.slice(-MAX_CHAT_SEARCHES));
  const lines = [`搜索「${result.query}」`];
  result.results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`, item.url, item.snippet);
  });
  lines.push(...result.warnings);
  appendChatMessage(db, {
    botId: caller.botId,
    sessionId: caller.id,
    role: "assistant",
    text: lines.join("\n").slice(0, 4_000),
  });
}

function authorizeChatSearch(
  db: OpenedDatabase,
  caller: ToolCaller,
  action: {
    readonly kind: "network.request";
    readonly callId: string;
    readonly toolName: string;
    readonly url: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  },
): Promise<{ approvalId: null; resource: string }> {
  if (caller.botId === undefined) {
    throw new NodeExecutionError({
      code: "UNAUTHORIZED_PATH",
      message: "web_search chat caller is not bound to a bot",
      retryable: false,
    });
  }
  const bot = getBot(db, caller.botId);
  const policy =
    bot === undefined || bot.archivedAt !== null ? undefined : getToolPolicy(db, bot.toolPolicyId);
  if (bot === undefined || bot.archivedAt !== null || policy === undefined) {
    throw new NodeExecutionError({
      code: "UNAUTHORIZED_PATH",
      message: "web_search chat bot is not available",
      retryable: false,
    });
  }
  const decision = evaluateToolAction(
    {
      kind: "network.request",
      callId: action.callId,
      toolName: action.toolName,
      url: action.url,
      arguments: action.arguments,
    },
    undefined,
    { policy, workspace: getWorkspace(db, bot.workspaceId), artifactsRoot: undefined },
  );
  if (decision.effect === "allow") return Promise.resolve({ approvalId: null, resource: decision.resource });
  if (decision.effect === "deny") {
    throw new NodeExecutionError({ code: decision.code, message: decision.message, retryable: false });
  }
  throw new NodeExecutionError({
    code: "APPROVAL_REQUIRED",
    message: "chat web_search cannot open a workflow approval",
    retryable: false,
  });
}

/** Backup directory name for a backup id (backups live under layout.backups). */
export function backupDirFor(layout: DataLayout, backupId: string): string {
  return join(layout.backups, backupId);
}

/** Mint a backup id — the destination directory name doubles as the id. */
export function newBackupId(): string {
  return randomUUID();
}







