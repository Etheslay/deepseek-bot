/**
 * DesktopService interface (D05 brief §2.1 services).
 *
 * The renderer talks only to this interface; the fixture implementation is
 * replaceable by a future IPC/Host implementation without touching UI code.
 * UI-only types (ChatSessionView) live here because CONTRACTS v0.1 has no
 * Session entity — they must never be promoted into packages/contracts.
 */
import type {
  ArtifactVersion,
  Bot,
  BotArtifact,
  BotGroup,
  ChatMessageMeta,
  ChatSkillInjection,
  ErrorCode,
  EventEnvelope,
  SkillLibrary,
  UiState,
} from "@deepseek-bot/contracts";
import type { BackupSummary } from "../../../shared/ipc-channels.js";
import type { WorkflowServiceApi } from "../features/workflow-editor/workflow-service.js";
import type { RunServiceApi } from "../features/run-monitor/run-service.js";
import type { TaskServiceApi } from "../features/run-monitor/tasks/task-service.js";

export type ChatSessionView = {
  sessionId: string;
  botId: string;
  title: string;
  startedAt: string;
  replayEventCount: number;
  status: "active" | "ended";
  /** G12: host session metadata. Absent on fixture/legacy shapes. */
  archived?: boolean;
  lastMessageAt?: string;
};

export type BotRoleDraft = "standard" | "coordinator";

export type BotDraft = {
  name: string;
  instructions: string;
  modelProfileId: string;
  workspaceId: string;
  toolPolicyId: string;
  /** v0.5 coordinator role (FR-1): human editor only, never the model. */
  role?: BotRoleDraft;
};

/**
 * Patch for `bots.update` → bot.update. Wider than BotDraft because moves
 * between persisted groups ride the same method (G1' 分组实体化): `groupId`
 * null puts the bot back into 未分组. The Host's BotPatchSchema stays the
 * validation authority.
 */
export type BotUpdatePatch = Partial<BotDraft> & { groupId?: string | null };

/** Result of one D26 attachment upload commit (trusted desktop only). */
export type AttachmentUploadResult = {
  /** Workspace-relative posix path inside the bot workspace. */
  path: string;
  size: number;
  checksum: string;
};

/** One persisted host chat row (chat.history), including an optional meta marker. */
export type ChatHistoryRow = {
  id: string;
  botId: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  meta?: ChatMessageMeta;
  at: string;
};

/**
 * One D25 Host retrieval hit (search.global): display metadata only — message
 * bodies appear solely as bounded snippets and artifact hits carry the
 * workspace-relative path, never an absolute path or content.
 */
export type GlobalSearchHitView = {
  kind: "bot" | "workflow" | "message" | "artifact";
  id: string;
  botId: string | null;
  title: string;
  snippet: string | null;
  at: string | null;
};

/**
 * Context meter (TASK_CONTEXT_METER.md): one read-only gauge for the bot's
 * chat session. Display data only — it never gates a send.
 */
export type ContextUsageView = {
  percent: number;
  usedTokens: number;
  windowTokens: number;
  estimated: boolean;
  compressedAt: string | null;
  compressing: boolean;
};

export type ToolStatus = {
  toolName: string;
  state: "requested" | "running" | "succeeded" | "failed";
  summary?: string;
};

export type ChatFailure = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
} | null;

export type StreamResult = {
  cancelled: boolean;
  failure: ChatFailure;
  /**
   * B6: the authoritative reply text from `chat.send`, present on the host
   * path. The stream runner commits this over the accumulated deltas — live
   * segments of a tool turn may include narration the reply does not carry.
   */
  text?: string;
};

export type StreamOptions = {
  /** Deterministic knobs for UI states and tests; fixture-only. */
  chunkDelayMs?: number;
  chunkCount?: number;
  simulateFailure?: Extract<
    ErrorCode,
    "RATE_LIMITED" | "AUTH_FAILED" | "MODEL_UNAVAILABLE" | "BUDGET_EXCEEDED"
  >;
  /** Saved skills for this turn. The host injects them; the fixture ignores them. */
  skills?: readonly ChatSkillInjection[];
  /**
   * 原始人模式 (primitive mode): one-step terse turn. The Host composes a
   * minimal prompt — no persona instructions, no history replay. Persisted
   * rows and history replay are unchanged. The fixture ignores the flag.
   */
  primitive?: boolean;
  /**
   * G12: storage session the turn belongs to. Omitted means the bot's
   * default session — the pre-sessions single thread.
   */
  sessionId?: string;
  /**
   * B3'' 视觉输入: raster attachments riding this turn as real image content
   * blocks (canonical base64, admitted MIME types). Omitted means no image
   * blocks — the pre-vision wire shape; images stay saved to the workspace
   * regardless, so read_workspace_file keeps working.
   */
  images?: readonly {
    data: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  }[];
};

export type StreamHandle = {
  cancel(): void;
  finish(): Promise<StreamResult>;
};

export type ConnectionScenario = "unverified" | "success" | "auth-failed" | "rate-limited";

export type TestConnectionResult = {
  result: "success" | "failure" | "unverified";
  ok: boolean;
  latencyMs?: number;
  errorCode?: ErrorCode;
};

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface DesktopService {
  bots: {
    list(): Promise<Bot[]>;
    create(draft: BotDraft): Promise<Bot>;
    update(botId: string, expectedRevision: string, patch: BotUpdatePatch): Promise<Bot>;
    archive(botId: string, expectedRevision: string): Promise<Bot>;
    /** New id/revision, name gets a "副本" suffix; sessions are never copied. */
    duplicate(botId: string): Promise<Bot>;
  };
  settings: {
    /** Key is written into the service-side store; no method ever reads it back. */
    saveKey(key: string): Promise<{ configured: boolean }>;
    keyConfigured(): boolean;
    setConnectionScenario(scenario: ConnectionScenario): void;
    testConnection(input: { model: string; endpoint: string }): Promise<TestConnectionResult>;
  };
  chat: {
    /**
     * G12: the bot's sessions (host metadata, newest activity first). The
     * default session (`chat:<botId>`) is always present. Fixture: seeded
     * run sessions.
     */
    listSessions(botId: string): Promise<ChatSessionView[]>;
    /** G12: start an extra session for the bot (`cs:` id). */
    createSession(botId: string, title?: string): Promise<ChatSessionView>;
    /** G12: retitle a session; archived sessions reject the rename. */
    renameSession(botId: string, sessionId: string, title: string): Promise<ChatSessionView>;
    /** G12: archive a session (final, read-only); the default session refuses. */
    archiveSession(botId: string, sessionId: string): Promise<ChatSessionView>;
    /**
     * Host: that session's stored messages and an empty event list. The
     * owning botId is passed explicitly — extra session ids (`cs:`) are not
     * parseable back to a bot. Fixture: the run-event log and an empty
     * message list.
     */
    openSession(botId: string, sessionId: string): Promise<{
      events: EventEnvelope[];
      messages: ChatHistoryRow[];
    }>;
    /**
     * chat.history: persisted host rows for one bot, including the v0.5
     * dispatch markers and task notices. `sessionId` scopes the read to one
     * session; omitted means the default session. The fixture chat is
     * local-only and returns an empty list.
     */
    history(botId: string, limit?: number, sessionId?: string): Promise<ChatHistoryRow[]>;
    /**
     * chat.contextUsage: the gauge behind the composer context circle.
     * `sessionId` scopes the meter to one session; omitted means the
     * default session. The fixture has no Host meter and reports an empty
     * gauge.
     */
    contextUsage(botId: string, sessionId?: string): Promise<ContextUsageView>;
    /**
     * Stage the picked bytes and import them through the tool gateway.
     * The real host waits for fs.write grant or approval before writing.
     * Returns the workspace-relative path the artifact preview and the
     * read tool both use.
     */
    importAttachment(
      botId: string,
      file: { name: string; mediaType: string; bytes: Uint8Array },
    ): Promise<{ relativePath: string; mediaType: string; size: number; checksum: string }>;
    /** Rejects with ServiceError("INVALID_INPUT") for archived bots. */
    stream(
      botId: string,
      userText: string,
      handlers: {
        onDelta: (chunk: string) => void;
        onTool: (tool: ToolStatus) => void;
      },
      options?: StreamOptions,
    ): StreamHandle;
  };
  /**
   * D26 attachment upload (trusted desktop only): bytes stage chunked through
   * the Host and commit into the bot workspace's attachments/ directory. The
   * model never picks the path; reads go through read_workspace_file (fs.read).
   */
  attachments: {
    upload(
      botId: string,
      file: { name: string; bytes: Uint8Array },
    ): Promise<AttachmentUploadResult>;
  };
  /**
   * D28 co-edit sidecar over one bot's workspace files. Read/save address a
   * file by (botId, relativePath); every save/revert appends a version. The
   * read union mirrors the contract: HTML and binary media never hand the
   * renderer executable or opaque content (QA-14).
   */
  artifacts: {
    list(botId: string): Promise<BotArtifact[]>;
    read(
      botId: string,
      relativePath: string,
    ): Promise<
      | { kind: "text"; mediaType: string; checksum: BotArtifact["checksum"]; content: string }
      | { kind: "blocked"; mediaType: string; reason: string }
    >;
    save(
      botId: string,
      relativePath: string,
      content: string,
      expectedChecksum?: string,
    ): Promise<{ artifact: BotArtifact; version: ArtifactVersion }>;
    versions(botId: string, relativePath: string): Promise<ArtifactVersion[]>;
    versionContent(
      botId: string,
      relativePath: string,
      versionId: string,
    ): Promise<
      | { kind: "text"; mediaType: string; content: string }
      | { kind: "blocked"; mediaType: string; reason: string }
    >;
    revert(
      botId: string,
      relativePath: string,
      versionId: string,
    ): Promise<{ artifact: BotArtifact; version: ArtifactVersion }>;
  };
  /**
   * D25-second-half Host retrieval for the Ctrl+K overlay. One literal
   * substring fans out over bot names, workflow names, every persisted chat
   * message (bounded snippets) and artifact paths across all bots. The search
   * grants nothing: opening a hit routes through the existing per-bot methods.
   */
  search: {
    global(query: string): Promise<GlobalSearchHitView[]>;
  };
  /**
   * Workflow editor API (D07). The host service serves it from the real Host
   * contracts (v0.12: workflow.list/get/validate/save/export); the fixture
   * implementation stays available for offline UI development.
   */
  workflows: WorkflowServiceApi;
  /**
   * Run monitor / approval API (D09). Host-backed since the v0.12 read surface
   * (run.list/get/snapshot/resume/retryNode, events.subscribe, approval.*);
   * `playback` tells the monitor whether fixture-only controls apply.
   */
  runs: RunServiceApi;
  /** v0.5 manager orchestration: dispatched-task query + human cancel. */
  tasks: TaskServiceApi;

  /**
   * G1' interface state (v0.13 ui.state.get/set): the persisted sidebar
   * snapshot — order + selection over stable entity IDs only. The fixture
   * keeps the snapshot in memory; the Host persists it in a settings KV row
   * and answers the empty state when the row is missing or corrupt.
   */
  uiState: {
    get(): Promise<UiState>;
    /** Replace the whole snapshot atomically; the caller debounces writes. */
    save(state: UiState): Promise<UiState>;
  };

  /**
   * B3'' 视觉能力标志: whether the bot's configured model is known to accept
   * image input. visionKnown=false (model id outside the pinned catalog)
   * means the UI stays neutral; the send-time harness gating is the truth.
   */
  vision: {
    status(botId: string): Promise<{ model: string; visionAvailable: boolean; visionKnown: boolean }>;
  };

  /**
   * G1' 分组实体化 (v0.14): the sidebar's persisted groups. `list` never
   * returns archived groups; `archive` uses optimistic concurrency (the
   * archive rotates the revision, so retries use the returned one). The
   * empty-group rule stays a UI policy. Members move via `bots.update` with
   * a `groupId` patch (null = ungrouped).
   */
  groups: {
    list(): Promise<BotGroup[]>;
    create(name: string): Promise<BotGroup>;
    archive(id: string, expectedRevision: string): Promise<BotGroup>;
  };

  /**
   * D17' skill library (v0.11 skillLibrary.get/save): whole-library reads
   * and writes. The Host validates the full shape on save and echoes it;
   * the fixture keeps the library in session memory.
   */
  skills: {
    getLibrary(): Promise<SkillLibrary>;
    saveLibrary(library: SkillLibrary): Promise<SkillLibrary>;
  };

  /**
   * D24 leftover vault: backup/restore entry plus data counts. listBackups
   * reads the data root's manifests through a desktop IPC channel (no host
   * contract method); create/restore/describe forward to the host's data.*
   * methods. After a successful restore the main process restarts the Host
   * child before this resolves, so follow-up calls hit the restored data.
   */
  vault: {
    listBackups(): Promise<BackupSummary[]>;
    createBackup(): Promise<{ backupId: string; createdAt: string; sizeBytes: number }>;
    restore(backupId: string): Promise<{ restored: true; hostRestarted: boolean }>;
    describe(): Promise<{ schemaVersion: string; counts: Record<string, number> }>;
  };
  /**
   * D24 leftover: hardware-acceleration shell preference. Reads the current
   * value; passing a boolean persists it (restart required to apply).
   */
  hardwareAcceleration(enabled?: boolean): Promise<{
    enabled: boolean;
    restartRequired: boolean;
  }>;
}
