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
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDeviceInputBackend,
  createScreenBackend,
  unavailableDeviceInputBackend,
  type DeviceInputBackend,
  type ScreenBackend,
} from "@deepseek-bot/exec-daemon";
import {
  DeviceInputSchema,
  methodContract,
  type Method,
  type Task,
  type ToolPolicy,
} from "@deepseek-bot/contracts";
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
import { createAttachmentStore, readWorkspaceFileText } from "./attachments.js";
import { createWorkspaceArtifacts } from "./artifacts.js";
import {
  EngineError,
  NodeExecutionError,
  WorkflowEngine,
  LocalScheduler,
  evaluateEventRules,
  evaluateToolAction,
  type ScheduleMissNotice,
} from "@deepseek-bot/runtime";
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
  listTasks,
  openDatabase,
  recordUsage,
  type DataLayout,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { buildHandlers, type ChatSearchRecord, type HostContext } from "./handlers.js";
import { AgentPermissionService, capabilitiesConsumedBy } from "./agent-permissions.js";
import {
  AskUserCoordinator,
  JsonlAuditSink,
  ToolGateway,
  ToolRegistry,
  bindAskUserTool,
  bindReadTools,
  bindTaskTools,
  bindWorkflowTools,
  bindWriteTools,
  bindWorkspaceFileTool,
  type UserQuestionControls,
} from "@deepseek-bot/agent-tools";
import {
  ToolRejectionError,
  WebSearchService,
  bindConnectorTools,
  bindMcpTool,
  McpInvokeInputSchema,
  bindKnowledgeTools,
  bindMemoryTools,
  bindScreenCaptureTool,
  bindDeviceActionTool,
  bindDeviceInputTool,
  bindAttachmentTools,
  bindWebSearchTool,
  type ToolCaller,
  type ToolNetworkPermissions,
  type WebSearchOptions,
  type WebSearchResult,
} from "@deepseek-bot/agent-tools";
import { startApplicationToolServer } from "./app-tool-channel.js";
import {
  AttachmentByteStore,
  createAttachmentIngress,
  createWorkspaceAttachmentFiles,
} from "./workspace-attachments.js";
import { createScreenService, unavailableScreenBackend, type ScreenService } from "./screen.js";
import { createDeviceActionService } from "./device.js";
import { createDeviceInputService } from "./device-input.js";
import {
  createVoiceService,
  type VoiceService,
  type VoiceSpeakRunner,
  type VoiceTranscribeRunner,
} from "./voice.js";
import { TaskDispatcher } from "./task-dispatcher.js";
import { ChatNativeGate } from "./chat-gate.js";
import { writeAutomationNotice } from "./automation-notices.js";
import { evaluateTriggerRules } from "./triggers.js";
import { invokeConnector } from "./connectors.js";
import { McpService } from "./mcp.js";

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
  /** v0.7 manager orchestration tuning (T7/Q3/Q6 defaults built in). */
  readonly tasks?: {
    /** Total hops per relay chain, 2–4 (contract hard cap 4); default 3. */
    readonly chainLimit?: number;
    /** Queued tasks tolerated per executor bot before dispatch refuses. */
    readonly queuedCapPerBot?: number;
    /** UI language seed for dispatcher copy; settings.update { ui.locale } overrides live. */
    readonly locale?: UiLocale;
  };
  /** D20 trigger evaluation interval (default 5s). */
  readonly triggers?: { readonly intervalMs?: number };
  /**
   * Screen backend seam. Production on Windows uses the bundled OCR helper.
   * Other platforms stay unavailable and do not spawn a process.
   */
  readonly screen?: {
    readonly backend: ScreenBackend;
    readonly supported?: boolean;
  };
  /**
   * Device-input backend seam. Production on Windows uses the bundled helper.
   * Other platforms stay unavailable and do not spawn a process.
   */
  readonly deviceInput?: {
    readonly backend: DeviceInputBackend;
  };
  /**
   * D27 local voice configuration. whisper.cpp paths are local user choices
   * (environment in production); injected runners replace the real whisper
   * and SAPI processes in tests. Speech never leaves the machine.
   */
  readonly voice?: {
    readonly whisperBin?: string;
    readonly whisperModel?: string;
    readonly transcribeTimeoutMs?: number;
    readonly speakTimeoutMs?: number;
    readonly runTranscribe?: VoiceTranscribeRunner;
    readonly runSpeak?: VoiceSpeakRunner;
  };
}

export interface DeepSeekBotHost {
  readonly layout: DataLayout;
  readonly db: OpenedDatabase;
  readonly engine: WorkflowEngine;
  readonly scheduler: LocalScheduler;
  readonly bridge: RunningApprovalBridge;
  readonly bootGeneration: number;
  /** Runs still recovered at startup (host restart before run completion). */
  readonly recoveredRuns: ReadonlyArray<{
    runId: string;
    interruptedNodeRuns: number;
    expiredApprovals: number;
  }>;
  /** v0.5: dispatched tasks swept to `interrupted` at startup (FR-10). */
  readonly interruptedTasks: number;
  /**
   * Execute one CONTRACTS §3 method. The payload is validated against the
   * method contract; the response is validated before returning. Errors are
   * EngineError/StorageError with stable codes — the desktop bridge maps them
   * to the wire error object.
   */
  handleMethod(method: Method, payload: unknown, requestId?: string): Promise<unknown>;
  /** D15 agent tool gateway (read + write layers; every call audited). */
  readonly agentTools: ToolGateway;
  readonly mcp: McpService;
  /** In-process screen target, lock, and local artifacts. Desktop uses the contract methods. */
  readonly screen: ScreenService;
  /** D27 local voice backend (whisper.cpp transcription + Windows SAPI speech). */
  readonly voice: VoiceService;
  /** G2/G3: the D08 bridge session registry (diagnostics; chat turns register here). */
  readonly sessions: SessionRegistry;
  /** The D16 checkpoint instance backing the gateway and the chat native gate (diagnostics/tests). */
  readonly permissions: AgentPermissionService;
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
/**
 * Built-in reasoning profile (GAP_AUDIT G5): seeded next to the chat default
 * so the renderer's deep-thinking toggle can switch a bot between the two via
 * the existing human path bot.update (patch.modelProfileId). Same UUID is
 * mirrored in apps/desktop renderer (features/chat/reasoner.ts) — the desktop
 * does not import the host package; the host seeding test pins both rows.
 */
export const REASONER_MODEL_PROFILE_ID = "8d5a5e30-0000-4000-8000-000000000005";
export const SEARXNG_ENDPOINT_SETTING = "searxng.endpoint";
/** Settings KV keys for the D27 local whisper configuration (desktop-settable, live-applied). */
export const VOICE_WHISPER_BIN_SETTING = "voice.whisper.bin";
export const VOICE_WHISPER_MODEL_SETTING = "voice.whisper.model";
/** Settings KV key the desktop pushes its resolved UI language into (zh/en). */
export const UI_LOCALE_SETTING = "ui.locale";
export type UiLocale = "zh" | "en";
/** Anything unknown (missing, "system", garbage) falls back to zh. */
export function asUiLocale(value: unknown): UiLocale {
  return value === "en" ? "en" : "zh";
}
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
  // GAP_AUDIT G5: the built-in reasoning profile shares the default
  // credential; switching a bot onto it is a plain bot.update.
  db.raw
    .prepare(
      "INSERT OR IGNORE INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) VALUES (?, 'deepseek', 'deepseek-reasoner', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(REASONER_MODEL_PROFILE_ID, DEFAULT_CREDENTIAL_REF, now, now);
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
    db.raw
      .prepare(
        "UPDATE tool_policies SET policy_json = json_set(policy_json, ?, ?), revision = ?, updated_at = ? " +
          "WHERE id = ? AND CASE WHEN json_valid(policy_json) THEN json_extract(policy_json, ?) END = ?;",
      )
      .run(path, current, randomUUID(), now, DEFAULT_TOOL_POLICY_ID, path, legacy);
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
  const mcp = new McpService(db, layout.connectorOutputs, {
    resolveCredential: (credentialRef) => options.resolveApiKey(credentialRef),
  });
  const patches = writeProfilePatches(layout.harnessHome);
  const now = options.now ?? (() => new Date());
  const screenChoice = resolveScreenBackend(options);
  const screen = createScreenService({
    root: layout.screenOutputs,
    db,
    permissions,
    now,
    backend: screenChoice.backend,
    supported: screenChoice.supported,
  });
  const device = createDeviceActionService({ db, permissions, now });
  const deviceInputBackend = resolveDeviceInputBackend(options);
  const deviceInput = createDeviceInputService({
    root: layout.deviceOutputs,
    db,
    permissions,
    now,
    backend: deviceInputBackend,
  });
  const voice = createVoiceService(options.voice ?? {});
  restoreVoiceConfig(
    voice,
    getSettingRaw(db, VOICE_WHISPER_BIN_SETTING),
    getSettingRaw(db, VOICE_WHISPER_MODEL_SETTING),
  );

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
    ? packagedBridge
    : fileURLToPath(new URL("../../harness-bridge/", import.meta.url));
  // G2: stage the approval bridge into the pinned "sdk" profile once at
  // startup. Chat turns staged it lazily and workflow runs never did, so the
  // profile mounted the dsb-approval-bridge row without the package and the
  // pinned harness reported "entry did not activate" — no approval channel.
  // The copy-based install is idempotent; a failure keeps the previous
  // lazy-staging behavior and is recorded in the local diagnostics.
  try {
    prepareAppToolProfile({ dshHome: layout.harnessHome, bridgePackageDir });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[host] approval bridge staging failed: ${message}\n`);
  }
  // UI language for Host-authored copy (dispatcher notices, chat turn errors,
  // canvas conflicts, ask_user labels): seeded from the settings KV (the
  // desktop pushes the resolved preference via settings.update) and mutable
  // live through the same method, so a language switch applies to new rows
  // without restarting the Host.
  const uiLocale: { current: UiLocale } = {
    current: options.tasks?.locale ?? asUiLocale(getSettingRaw(db, UI_LOCALE_SETTING)),
  };
  const chat = new ChatManager(
    executorOptions,
    {
      prepareProfile: () =>
        prepareAppToolProfile({ dshHome: layout.harnessHome, bridgePackageDir }),
      openTurn: (sessionId, caller, signal, skillCapabilities) => {
        return applicationTools.openTurn({
          sessionId,
          caller,
          signal,
          ...(skillCapabilities !== undefined ? { skillCapabilities } : {}),
        });
      },
      // G3: native harness tool calls in a chat turn route through the D16
      // checkpoint (fs/exec capabilities, chat D08 network seam, mcp.call);
      // ask mints the same AppApproval card the app tools use.
      bridgeRegistration: {
        register: (sessionId, permissions) =>
          sessionRegistry.register(sessionId, {
            runId: sessionId,
            nodeRunId: sessionId,
            permissions,
          }),
        unregister: (sessionId) => sessionRegistry.unregister(sessionId),
      },
      nativeGate: (input) =>
        new ChatNativeGate({
          permissions,
          network: (caller, action) => {
            if (action.kind !== "network.request" || action.url === undefined) {
              return Promise.reject(
                new NodeExecutionError({
                  code: "INVALID_INPUT",
                  message: "chat network ask is missing a url",
                  retryable: false,
                }),
              );
            }
            return chatNetworkPermissions(caller).authorize({
              kind: "network.request",
              callId: action.callId,
              toolName: action.toolName,
              url: action.url,
              arguments: action.arguments as Readonly<Record<string, unknown>>,
            }) as Promise<{ approvalId: string | null; resource: string }>;
          },
          botId: input.botId,
          sessionId: input.sessionId,
          signal: input.signal,
        }),
    },
    () => uiLocale.current,
    (usage) => {
      /* best-effort: a usage write must never break the reply path */
      try {
        recordUsage(db, {
          id: randomUUID(),
          botId: usage.botId,
          model: usage.model,
          sessionId: usage.sessionId,
          occurredAt: new Date().toISOString(),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          source: usage.estimated ? "estimated" : "harness",
        });
      } catch {
        /* usage accounting is best-effort */
      }
    },
  );
  // v0.5 manager orchestration: dispatched-task queue + executor. The audit
  // sink is shared with the tool gateway so relay hops (which bypass the
  // gateway) still leave one audit record per hop under the same log.
  const agentAudit = new JsonlAuditSink(join(layout.logs, "agent-tools-audit.jsonl"));
  const tasks = new TaskDispatcher({
    db,
    chat,
    audit: agentAudit,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.tasks?.chainLimit !== undefined ? { chainLimit: options.tasks.chainLimit } : {}),
    ...(options.tasks?.queuedCapPerBot !== undefined
      ? { queuedCapPerBot: options.tasks.queuedCapPerBot }
      : {}),
    locale: () => uiLocale.current,
  });
  const bridge = await startApprovalBridgeServer({
    sessions: (sessionId) => sessionRegistry.resolve(sessionId),
  });
  bridgeRef.current = bridge;

  const workspaceArtifacts = createWorkspaceArtifacts({
    db,
    artifactsRoot: layout.artifacts,
    now,
    locale: () => uiLocale.current,
  });
  // D26: chunked trusted-desktop uploads stage under cache/ and commit into
  // the bot workspace's attachments/ directory (shutdown sweeps strays).
  const attachmentStore = createAttachmentStore({ db, cacheDir: layout.cache });

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
  // FR-10: dispatched tasks die with the process — queued/running rows
  // become `interrupted` and stay queryable, exactly like D10 run recovery.
  const interruptedTasks = tasks.sweepInterrupted();
  // D18 保留策略: apply configured limits once at startup so expiry and
  // caps hold even when nothing writes for a while.
  sweepRetention(db, readRetentionPolicy(db), now());
  // D20 review queue: catch up on events that accumulated while the host
  // was down (enqueued as reason "missed", never silently replayed). The
  // same tick evaluates local event rules, which start one run, hold one
  // pending review, or record a disabled skip. Neither path opens a network
  // connection.
  const bootAt = now();
  const scanLocalEvents = (): void => {
    try {
      evaluateTriggerRules(db, { bootAt });
    } catch {
      // A failed scan retries on the next tick; the cursor only advances
      // after a successful pass, so nothing is skipped.
    }
    try {
      evaluateEventRules(db, engine, {
        onRuleOutcome: (notice) => {
          writeAutomationNotice(
            db,
            {
              ruleId: notice.ruleId,
              botId: notice.botId,
              ruleName: notice.ruleName,
              outcome: notice.outcome,
              runId: notice.runId,
              reason: notice.reason,
            },
            uiLocale.current,
          );
        },
      });
    } catch {
      // A failed rule keeps its cursor and is retried on the next tick.
    }
  };
  scanLocalEvents();
  const triggerTimer = setInterval(scanLocalEvents, options.triggers?.intervalMs ?? 5_000);
  triggerTimer.unref?.();

  let closed = false;
  const agentToolsHolder: { current?: ToolGateway } = {};
  const attachmentFiles = createWorkspaceAttachmentFiles(db);
  const attachmentBytes = new AttachmentByteStore();
  const attachments = createAttachmentIngress({
    db,
    bytes: attachmentBytes,
    files: attachmentFiles,
    now,
    call: (caller, params) => {
      const gateway = agentToolsHolder.current;
      if (gateway === undefined) {
        throw new EngineError({
          code: "RUNTIME_UNAVAILABLE",
          message: "agent tools gateway is not ready yet",
          retryable: false,
        });
      }
      return gateway.call(caller, "import_attachment", params);
    },
  });
  const questions = new AskUserCoordinator();
  const context: HostContext = {
    db,
    engine,
    scheduler,
    layout,
    now,
    resolveApiKey: options.resolveApiKey,
    permissions,
    mcp,
    screen,
    device,
    deviceInput,
    voice,
    chat,
    attachments,
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
    tasks,
    locale: uiLocale,
    attachmentUploads: attachmentStore,
    get agentTools(): ToolGateway {
      if (agentToolsHolder.current === undefined) {
        throw new Error("agent tools gateway is not ready yet");
      }
      return agentToolsHolder.current;
    },
    artifacts: workspaceArtifacts,
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
    if (method === "data.restore") {
      screen.close();
      device.close();
      deviceInput.close();
      voice.close();
      attachmentStore.close();
      permissions.close();
    }
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
        return invokeConnector(
          db,
          layout.connectorOutputs,
          { connectorId, action, params },
          { now },
        );
      },
    }),
    bindMcpTool((input, context) => mcp.invoke(input, context)),
    ...bindKnowledgeTools({
      search(botId, query, limit) {
        const bot = getBot(db, botId);
        if (bot === undefined || bot.archivedAt !== null) {
          throw new ToolRejectionError("UNAUTHORIZED_PATH", "knowledge bot is not available");
        }
        return searchKnowledge(db, { botId, query, limit });
      },
    }),
    bindScreenCaptureTool(screen),
    bindDeviceActionTool(device),
    // D26 closure: chat attachments land in the bot workspace; the bot reads
    // them back through this tool (capability fs.read, D08/D16 governed).
    bindWorkspaceFileTool({
      read: (botId, relativePath) => readWorkspaceFileText(db, botId, relativePath),
    }),
    bindDeviceInputTool(deviceInput),
    // v0.5 manager orchestration (T4/T3): coordinator workflow saving and
    // dispatched-task tools. Role rules live inside the task tool layer;
    // the dispatcher re-checks them authoritatively.
    ...bindWorkflowTools((method, payload) => dispatch(method as Method, payload)),
    ...bindTaskTools({
      resolveBot: (botId) => {
        const bot = getBot(db, botId);
        return bot === undefined
          ? undefined
          : {
              id: bot.id,
              name: bot.name,
              role: bot.role,
              groupId: bot.groupId ?? null,
              archivedAt: bot.archivedAt,
            };
      },
      dispatch: (input) => tasks.dispatch(input),
      listForBot: async (botId, filter) => {
        const statusFilter = filter.status !== undefined ? { status: filter.status } : {};
        const rootFilter = filter.rootTaskId !== undefined ? { rootTaskId: filter.rootTaskId } : {};
        const merged = new Map<string, Task>();
        for (const task of [
          ...listTasks(db, { fromBotId: botId, ...statusFilter, ...rootFilter, limit: 100 }),
          ...listTasks(db, { toBotId: botId, ...statusFilter, ...rootFilter, limit: 100 }),
        ]) {
          merged.set(task.id, task);
        }
        const ordered = [...merged.values()].sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.chainIndex - b.chainIndex
            : a.createdAt < b.createdAt
              ? -1
              : 1,
        );
        return { tasks: ordered.slice(Math.max(0, ordered.length - filter.limit)) };
      },
    }),
    ...bindAttachmentTools({
      importFile(botId, input) {
        const bytes = attachmentBytes.take(input.uploadId, botId);
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (bytes.byteLength !== input.size || checksum !== input.checksum) {
          throw new ToolRejectionError("INVALID_INPUT", "staged attachment does not match the request");
        }
        return attachmentFiles.write(botId, input.name, bytes);
      },
      readFile(botId, relativePath) {
        return attachmentFiles.read(botId, relativePath);
      },
    }),
  ]) {
    agentRegistry.register(capability);
  }
  const agentTools = new ToolGateway({
    registry: agentRegistry,
    audit: agentAudit,
    capabilitiesForTool: capabilitiesConsumedBy,
    grants: {
      async check(tool, caller, params, options) {
        if (tool === "screen_capture") {
          const mode = (params as { mode?: unknown }).mode;
          if (mode !== "image" && mode !== "ocr") {
            return {
              allowed: false,
              code: "INVALID_INPUT",
              reason: "screen capture mode is invalid",
              decision: "denied",
            };
          }
          return screen.authorize(caller, mode, options);
        }
        if (tool === "device_action") {
          const kind = (params as { kind?: unknown }).kind;
          if (kind !== "pointer" && kind !== "key") {
            return {
              allowed: false,
              code: "INVALID_INPUT",
              reason: "device action kind is invalid",
              decision: "denied",
            };
          }
          return device.authorize(caller, kind, options);
        }
        if (tool === "device_input") {
          const parsed = DeviceInputSchema.safeParse(params);
          if (!parsed.success) {
            return {
              allowed: false,
              code: "INVALID_INPUT",
              reason: "device input is invalid",
              decision: "denied",
            };
          }
          return deviceInput.authorize(caller, parsed.data, options);
        }
        const input = tool === "mcp_call" ? McpInvokeInputSchema.parse(params) : undefined;
        if (input) mcp.check(input, caller);
        const authorization = await permissions.check(tool, caller, params, options);
        return {
          ...authorization,
          revalidate() {
            authorization.revalidate?.();
            if (input) mcp.check(input, caller);
          },
        };
      },
    },
  });
  agentToolsHolder.current = agentTools;
  const chatNetworkPermissions = (caller: ToolCaller): ToolNetworkPermissions => ({
    authorize: (action) => authorizeChatSearch(db, caller, action),
  });
  const applicationTools = await startApplicationToolServer(agentTools, {
    networkPermissions: chatNetworkPermissions,
    mcp,
    screenCatalog: (caller) =>
      screen.visible(caller.botId) ? agentTools.capabilities.schemas(["screen_capture"]) : [],
  });

  return {
    layout,
    db,
    engine,
    scheduler,
    bridge,
    bootGeneration,
    recoveredRuns,
    interruptedTasks: interruptedTasks.length,
    agentTools,
    mcp,
    screen,
    voice,
    sessions: sessionRegistry,
    permissions,
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
      clearInterval(triggerTimer);
      screen.close();
      device.close();
      attachmentStore.close();
      deviceInput.close();
      voice.close();
      permissions.close();
      mcp.close();
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
          // Preserve interrupted-run recovery, then drain the app-owned
          // workflow children before Windows releases their workspace cwd.
          await engine.abandonInflight();
        }
      }
    },
  };
}

function resolveScreenBackend(options: HostOptions): {
  backend: ScreenBackend;
  supported: boolean;
} {
  if (options.screen !== undefined) {
    return {
      backend: options.screen.backend,
      supported: options.screen.supported ?? true,
    };
  }
  if (process.platform !== "win32") {
    return { backend: unavailableScreenBackend(), supported: false };
  }
  const modulePath = fileURLToPath(import.meta.url);
  const bundled = basename(modulePath) === "main.js";
  const assets = bundled
    ? join(dirname(modulePath), "screen-assets")
    : join(dirname(modulePath), "..", "..", "exec-daemon");
  return {
    backend: createScreenBackend({
      resourcesDirectory: bundled ? join(assets, "ocr") : join(assets, "dist", "ocr"),
      helperScriptPath: bundled
        ? join(assets, "win32-capture.ps1")
        : join(assets, "assets", "win32-capture.ps1"),
    }),
    supported: true,
  };
}

function resolveDeviceInputBackend(options: HostOptions): DeviceInputBackend {
  if (options.deviceInput !== undefined) return options.deviceInput.backend;
  if (process.platform !== "win32") return unavailableDeviceInputBackend();
  const modulePath = fileURLToPath(import.meta.url);
  const bundled = basename(modulePath) === "main.js";
  const assets = bundled
    ? join(dirname(modulePath), "screen-assets")
    : join(dirname(modulePath), "..", "..", "exec-daemon");
  return createDeviceInputBackend({
    helperScriptPath: bundled
      ? join(assets, "win32-input.ps1")
      : join(assets, "assets", "win32-input.ps1"),
  });
}

/**
 * The settings KV is authoritative when the key exists: a string overrides
 * the environment seed, null or garbage clears (voice.status stays honest).
 * An absent key keeps the environment-seeded boot default.
 */
function restoreVoiceConfig(voice: VoiceService, savedBin: unknown, savedModel: unknown): void {
  if (savedBin !== undefined) {
    const bin = typeof savedBin === "string" && savedBin.length > 0 ? savedBin : null;
    voice.setConfig({ ...voice.config(), whisperBin: bin });
  }
  if (savedModel !== undefined) {
    const model = typeof savedModel === "string" && savedModel.length > 0 ? savedModel : null;
    voice.setConfig({ ...voice.config(), whisperModel: model });
  }
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
  if (decision.effect === "allow")
    return Promise.resolve({ approvalId: null, resource: decision.resource });
  if (decision.effect === "deny") {
    throw new NodeExecutionError({
      code: decision.code,
      message: decision.message,
      retryable: false,
    });
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
