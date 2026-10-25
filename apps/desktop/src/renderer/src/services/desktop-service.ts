/**
 * DesktopService interface (D05 brief §2.1 services).
 *
 * The renderer talks only to this interface; the fixture implementation is
 * replaceable by a future IPC/Host implementation without touching UI code.
 * UI-only types (ChatSessionView) live here because CONTRACTS v0.1 has no
 * Session entity — they must never be promoted into packages/contracts.
 */
import type { Artifact, Bot, ErrorCode, EventEnvelope } from "@deepseek-bot/contracts";
import type { WorkflowServiceApi } from "../features/workflow-editor/workflow-service.js";
import type { RunServiceApi } from "../features/run-monitor/run-service.js";

export type ChatSessionView = {
  sessionId: string;
  botId: string;
  title: string;
  startedAt: string;
  replayEventCount: number;
  status: "active" | "ended";
};

export type BotDraft = {
  name: string;
  instructions: string;
  modelProfileId: string;
  workspaceId: string;
  toolPolicyId: string;
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
  artifacts: {
    listBySession(sessionId: string): Promise<Artifact[]>;
    /** Text/Markdown preview; HTML and unknown media are blocked, never executed. */
    preview(artifact: Artifact): Promise<{ kind: "text"; content: string } | { kind: "blocked"; reason: string }>;
  };
  /** Workflow editor API (D07); fixture-backed, no execution/persistence. */
  workflows: WorkflowServiceApi;
  /** Run monitor / approval API (D09); fixture playback, no real engine. */
  runs: RunServiceApi;
}
