/**
 * FixtureService (D05 brief §2.1): the only DesktopService implementation in
 * this milestone. Every returned entity is validated against
 * `@deepseek-bot/contracts` schemas before it leaves the service; all state
 * is in-memory session state and disappears on restart (persistence is D04).
 */
import type {
  Artifact,
  Bot,
  EventEnvelope,
} from "@deepseek-bot/contracts";
import {
  validateArtifact,
  validateBot,
  validateEventEnvelope,
} from "./contract-validation.js";
import {
  ServiceError,
  type ChatSessionView,
  type ConnectionScenario,
  type DesktopService,
  type StreamHandle,
  type StreamResult,
  type TestConnectionResult,
  type ToolStatus,
} from "./desktop-service.js";
import { createFixtureWorkflowService } from "../features/workflow-editor/workflow-service.js";
import { createFixtureRunService } from "../features/run-monitor/run-service.js";

// Fixture imports resolve through the workspace package exports
// ("./fixtures/*"); validated against EventEnvelopeSchema in openSession.
import successRunFixture from "@deepseek-bot/contracts/fixtures/success-run.json";
import cancelRunFixture from "@deepseek-bot/contracts/fixtures/cancel-run.json";

const SESSION_BOT_A = "11111111-1111-4111-8111-111111111111";

function isoNow(): string {
  return new Date().toISOString();
}

/** Deterministic seeds shaped exactly like the success-run fixture snapshot. */
const SEED_BOTS: Bot[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    revision: "22222222-2222-4222-8222-222222222222",
    name: "note-summarizer",
    instructions: "You summarize notes.",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
    archivedAt: null,
  },
  {
    id: "11111111-1111-4111-8111-111111111112",
    revision: "22222222-2222-4222-8222-222222222223",
    name: "research-bot",
    instructions: "You research the provided sample directory.",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555556",
    toolPolicyId: "66666666-6666-4666-8666-666666666667",
    archivedAt: null,
  },
];

const SEED_SESSIONS: ChatSessionView[] = [
  {
    sessionId: "sess-success-run",
    botId: SESSION_BOT_A,
    title: "note-summarizer · 摘要任务",
    startedAt: "2026-10-24T10:00:00Z",
    replayEventCount: successRunFixture.events.length,
    status: "ended",
  },
  {
    sessionId: "sess-cancel-run",
    botId: SESSION_BOT_A,
    title: "note-summarizer · 已取消的任务",
    startedAt: "2026-10-24T09:30:00Z",
    replayEventCount: cancelRunFixture.events.length,
    status: "ended",
  },
];

const SESSION_FIXTURES: Record<string, { events: unknown[] }> = {
  "sess-success-run": successRunFixture,
  "sess-cancel-run": cancelRunFixture,
};

const SEED_ARTIFACTS: Record<string, Artifact[]> = {
  "sess-success-run": [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      relativePath: "summaries/note-summary.md",
      mediaType: "text/markdown",
      size: 2048,
      checksum: { algorithm: "sha256", value: "a".repeat(64) },
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      relativePath: "reports/index.html",
      mediaType: "text/html",
      size: 4096,
      checksum: { algorithm: "sha256", value: "b".repeat(64) },
    },
  ],
};

export function createFixtureService(): DesktopService {
  let bots: Bot[] = SEED_BOTS.map((bot) => ({ ...bot }));
  let keyConfigured = false;
  let connectionScenario: ConnectionScenario = "unverified";

  const requireBot = (botId: string): Bot => {
    const bot = bots.find((b) => b.id === botId);
    if (!bot) {
      throw new ServiceError("INVALID_INPUT", `bot not found: ${botId}`);
    }
    return bot;
  };

  const assertLive = (bot: Bot): void => {
    if (bot.archivedAt !== null) {
      throw new ServiceError(
        "INVALID_INPUT",
        `archived bot ${bot.name} cannot start a new chat`,
      );
    }
  };

  const service: DesktopService = {
    bots: {
      async list() {
        return bots.map((bot) => {
          const checked = validateBot(bot);
          if (!checked.ok) {
            throw new ServiceError("INVALID_INPUT", `seed bot failed schema: ${checked.issues[0]?.message ?? ""}`);
          }
          return checked.value;
        });
      },

      async create(draft) {
        const bot: Bot = {
          id: crypto.randomUUID(),
          revision: crypto.randomUUID(),
          name: draft.name,
          instructions: draft.instructions,
          modelProfileId: draft.modelProfileId,
          workspaceId: draft.workspaceId,
          toolPolicyId: draft.toolPolicyId,
          archivedAt: null,
        };
        const checked = validateBot(bot);
        if (!checked.ok) {
          throw new ServiceError(
            "INVALID_INPUT",
            `bot draft failed schema: ${checked.issues[0]?.path.join(".")} ${checked.issues[0]?.message ?? ""}`,
          );
        }
        bots = [...bots, checked.value];
        return checked.value;
      },

      async update(botId, expectedRevision, patch) {
        const bot = requireBot(botId);
        if (bot.revision !== expectedRevision) {
          throw new ServiceError("REVISION_CONFLICT", "bot was modified elsewhere", false);
        }
        const next: Bot = {
          ...bot,
          name: patch.name ?? bot.name,
          instructions: patch.instructions ?? bot.instructions,
          modelProfileId: patch.modelProfileId ?? bot.modelProfileId,
          workspaceId: patch.workspaceId ?? bot.workspaceId,
          toolPolicyId: patch.toolPolicyId ?? bot.toolPolicyId,
          revision: crypto.randomUUID(),
        };
        const checked = validateBot(next);
        if (!checked.ok) {
          throw new ServiceError(
            "INVALID_INPUT",
            `bot patch failed schema: ${checked.issues[0]?.path.join(".")} ${checked.issues[0]?.message ?? ""}`,
          );
        }
        bots = bots.map((b) => (b.id === botId ? checked.value : b));
        return checked.value;
      },

      async archive(botId, expectedRevision) {
        const bot = requireBot(botId);
        if (bot.revision !== expectedRevision) {
          throw new ServiceError("REVISION_CONFLICT", "bot was modified elsewhere", false);
        }
        const next: Bot = { ...bot, archivedAt: isoNow(), revision: crypto.randomUUID() };
        const checked = validateBot(next);
        if (!checked.ok) {
          throw new ServiceError("INVALID_INPUT", "archive failed schema");
        }
        bots = bots.map((b) => (b.id === botId ? checked.value : b));
        return checked.value;
      },

      async duplicate(botId) {
        const bot = requireBot(botId);
        const copy: Bot = {
          ...bot,
          id: crypto.randomUUID(),
          revision: crypto.randomUUID(),
          name: `${bot.name} 副本`,
          archivedAt: null,
        };
        const checked = validateBot(copy);
        if (!checked.ok) {
          throw new ServiceError("INVALID_INPUT", "duplicate failed schema");
        }
        bots = [...bots, checked.value];
        return checked.value;
      },
    },

    settings: {
      async saveKey(key) {
        if (key.length === 0) {
          throw new ServiceError("INVALID_INPUT", "key must not be empty");
        }
        keyConfigured = true;
        return { configured: true };
      },

      keyConfigured() {
        return keyConfigured;
      },

      setConnectionScenario(scenario: ConnectionScenario) {
        connectionScenario = scenario;
      },

      async testConnection(_input): Promise<TestConnectionResult> {
        switch (connectionScenario) {
          case "success":
            return { result: "success", ok: true, latencyMs: 120 };
          case "auth-failed":
            return { result: "failure", ok: false, errorCode: "AUTH_FAILED" };
          case "rate-limited":
            return { result: "failure", ok: false, errorCode: "RATE_LIMITED" };
          case "unverified":
          default:
            // No real network in D05: the result is honestly unverified.
            return { result: "unverified", ok: false, errorCode: "RUNTIME_UNAVAILABLE" };
        }
      },
    },

    chat: {
      async listSessions(botId) {
        return SEED_SESSIONS.filter((s) => s.botId === botId);
      },

      async openSession(sessionId) {
        const fixture = SESSION_FIXTURES[sessionId];
        if (!fixture) {
          throw new ServiceError("INVALID_INPUT", `unknown session: ${sessionId}`);
        }
        const events = fixture.events.map((raw) => {
          const checked = validateEventEnvelope(raw);
          if (!checked.ok) {
            throw new ServiceError(
              "DATA_VERSION_UNSUPPORTED",
              `fixture event failed schema: ${checked.issues[0]?.message ?? ""}`,
            );
          }
          return checked.value as EventEnvelope;
        });
        return { events };
      },

      stream(botId, userText, handlers, options): StreamHandle {
        const bot = requireBot(botId);
        assertLive(bot);
        if (userText.trim().length === 0) {
          throw new ServiceError("INVALID_INPUT", "message must not be empty");
        }

        let settled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        let resolveFinish!: (result: StreamResult) => void;
        const finishPromise = new Promise<StreamResult>((resolve) => {
          resolveFinish = resolve;
        });
        const settle = (result: StreamResult): void => {
          if (!settled) {
            settled = true;
            resolveFinish(result);
          }
        };

        const chunkDelayMs = options?.chunkDelayMs ?? 60;
        const chunkCount = options?.chunkCount ?? 8;
        const simulateFailure = options?.simulateFailure;
        const reply = `（占位回复）已收到：「${userText.slice(0, 40)}」。真实模型会话将在 D06/D12 接入。`;

        const schedule = (delay: number, fn: () => void): void => {
          timers.push(setTimeout(() => { if (!settled) fn(); }, delay));
        };

        schedule(chunkDelayMs, () => {
          handlers.onTool({
            toolName: "read_workspace_file",
            state: "requested",
            summary: "读取工作区样例文件",
          } satisfies ToolStatus);
        });
        schedule(chunkDelayMs * 2, () => {
          handlers.onTool({
            toolName: "read_workspace_file",
            state: "succeeded",
            summary: "已读取 1 个文件",
          } satisfies ToolStatus);
        });
        const chunkSize = Math.ceil(reply.length / chunkCount);
        for (let i = 0; i < chunkCount; i++) {
          schedule(chunkDelayMs * (3 + i), () => {
            if (simulateFailure && i === 0) {
              settle({
                cancelled: false,
                failure: {
                  code: simulateFailure,
                  message:
                    simulateFailure === "RATE_LIMITED"
                      ? "请求过于频繁，请稍后重试。"
                      : "请求失败，请检查模型配置。",
                  retryable: simulateFailure === "RATE_LIMITED",
                },
              });
              return;
            }
            handlers.onDelta(reply.slice(i * chunkSize, (i + 1) * chunkSize));
          });
        }
        schedule(chunkDelayMs * (3 + chunkCount), () => {
          settle({ cancelled: false, failure: null });
        });

        return {
          cancel() {
            timers.forEach(clearTimeout);
            settle({ cancelled: true, failure: null });
          },
          finish: () => finishPromise,
        };
      },
    },

    artifacts: {
      async listBySession(sessionId) {
        const list = SEED_ARTIFACTS[sessionId] ?? [];
        return list.map((artifact) => {
          const checked = validateArtifact(artifact);
          if (!checked.ok) {
            throw new ServiceError("INVALID_INPUT", "artifact fixture failed schema");
          }
          return checked.value as Artifact;
        });
      },

      async preview(artifact) {
        if (artifact.mediaType === "text/markdown" || artifact.mediaType === "text/plain") {
          return {
            kind: "text",
            content: `# ${artifact.relativePath}\n\n（占位预览）该文件在 D04 落地后来自真实产物目录；当前仅演示安全文本预览。`,
          };
        }
        return {
          kind: "blocked",
          reason: `mediaType ${artifact.mediaType} 不做内联预览（防脚本执行，QA-14）。`,
        };
      },
    },

    workflows: createFixtureWorkflowService(),
    runs: createFixtureRunService(),
  };

  return service;
}
