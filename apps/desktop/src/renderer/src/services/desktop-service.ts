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
  ErrorCode,
  EventEnvelope,
  Task,
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

/** One persisted host chat row (chat.history) with its v0.5 meta marker. */
export type ChatHistoryRow = {
  id: string;
  botId: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  meta?:
    | { kind: "dispatch"; taskId: string; fromBotId: string }
    | { kind: "task_notice"; taskId: string; status: Task["status"]; resultSummary?: string };
  at: string;
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
};

export type StreamOptions = {
  /** Deterministic knobs for UI states and tests; fixture-only. */
  chunkDelayMs?: number;
  chunkCount?: number;
  simulateFailure?: Extract<ErrorCode, "RATE_LIMITED" | "AUTH_FAILED" | "MODEL_UNAVAILABLE">;
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
    update(botId: string, expectedRevision: string, patch: Partial<BotDraft>): Promise<Bot>;
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
    listSessions(botId: string): Promise<ChatSessionView[]>;
    /** Replays persisted events for a session (fixture-backed in D05). */
    openSession(sessionId: string): Promise<{ events: EventEnvelope[] }>;
    /**
     * chat.history: persisted host rows for one bot, including the v0.5
     * dispatch markers and task notices. The fixture chat is local-only
     * and returns an empty list.
     */
    history(botId: string, limit?: number): Promise<ChatHistoryRow[]>;
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
  /** Workflow editor API (D07); fixture-backed, no execution/persistence. */
  workflows: WorkflowServiceApi;
  /** Run monitor / approval API (D09); fixture playback, no real engine. */
  runs: RunServiceApi;
  /** v0.5 manager orchestration: dispatched-task query + human cancel. */
  tasks: TaskServiceApi;

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
