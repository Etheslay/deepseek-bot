/**
 * FixtureService (D05 brief §2.1): the only DesktopService implementation in
 * this milestone. Every returned entity is validated against
 * `@deepseek-bot/contracts` schemas before it leaves the service; all state
 * is in-memory session state and disappears on restart (persistence is D04).
 */
import type {
  ArtifactVersion,
  Bot,
  BotArtifact,
  BotGroup,
  EventEnvelope,
  SkillLibrary,
  UiState,
} from "@deepseek-bot/contracts";
import {
  validateArtifactVersion,
  validateBot,
  validateBotArtifact,
  validateEventEnvelope,
} from "./contract-validation.js";
import {
  ServiceError,
  type AttachmentUploadResult,
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
import { createFixtureTaskService, fixtureChatHistory } from "../features/run-monitor/tasks/task-service.js";

// Fixture imports resolve through the workspace package exports
// ("./fixtures/*"); validated against EventEnvelopeSchema in openSession.
import successRunFixture from "@deepseek-bot/contracts/fixtures/success-run.json";
import cancelRunFixture from "@deepseek-bot/contracts/fixtures/cancel-run.json";
import { t } from "../i18n.js";

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
    role: "standard",
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
    role: "standard",
    archivedAt: null,
  },
];

/**
 * Session titles are rendered copy, so they are built per call: a frozen module
 * constant would keep showing the language the page booted in (D22).
 */
function seedSessions(): ChatSessionView[] {
  return [
  {
    sessionId: "sess-success-run",
    botId: SESSION_BOT_A,
    title: t("services.fixtureBotSummary"),
    startedAt: "2026-10-24T10:00:00Z",
    replayEventCount: successRunFixture.events.length,
    status: "ended",
  },
  {
    sessionId: "sess-cancel-run",
    botId: SESSION_BOT_A,
    title: t("services.fixtureBotCancelled"),
    startedAt: "2026-10-24T09:30:00Z",
    replayEventCount: cancelRunFixture.events.length,
    status: "ended",
  },
  ];
}

const SESSION_FIXTURES: Record<string, { events: unknown[] }> = {
  "sess-success-run": successRunFixture,
  "sess-cancel-run": cancelRunFixture,
};

/**
 * G12 fixture session store: the seeded run sessions plus any sessions the
 * preview user creates. Mutations are preview-local (never persisted), and
 * re-seeding on module load keeps tests deterministic.
 */
const fixtureSessions = new Map<string, ChatSessionView[]>(
  SEED_BOTS.map((bot) => [bot.id, [] as ChatSessionView[]]),
);
let fixtureSessionCounter = 0;

/**
 * D28 co-edit fixture seeds: an in-memory workspace for the seeded bot, one
 * text/markdown file plus one HTML file (blocked, QA-14). Each file starts
 * with a v1 version row so the version panel has history out of the box.
 */
const SEED_WORKSPACE_FILES: Array<{
  botId: string;
  relativePath: string;
  content: string;
}> = [
  {
    botId: SESSION_BOT_A,
    relativePath: "summaries/note-summary.md",
    content:
      // i18n-ignore: 夹具工作区文件的正文，属被编辑的数据而非界面文案
      "# 会议纪要（示例产物）\n\n这是夹具工作区里的真实文本内容，可在画布中编辑并保存。\n\n- 第一版由 bot 写入\n- 用户每次保存都会追加一个新版本\n",
  },
  {
    botId: SESSION_BOT_A,
    relativePath: "reports/index.html",
    // i18n-ignore: 夹具工作区文件的正文，属被编辑的数据而非界面文案
    content: "<!doctype html>\n<html><body><p>HTML 产物不进入画布编辑。</p></body></html>\n",
  },
];

interface FixtureWorkspaceFile {
  content: string;
  mediaType: string;
  updatedAt: string;
  versions: ArtifactVersion[];
  nextRevision: number;
  /** In-memory snapshot per version id (contract rows stay metadata-only). */
  versionContents: Map<string, string>;
}

function fixtureChecksum(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    );
}

function fixtureAttachmentPath(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80);
  const safe = /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `file${cleaned}`;
  return `attachments/${safe}`;
}

function fixtureMediaType(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml";
  if (lower.endsWith(".xml")) return "text/xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function fixtureEditable(mediaType: string): boolean {
  return (
    mediaType === "text/markdown" ||
    mediaType === "text/plain" ||
    mediaType === "application/json" ||
    mediaType === "text/csv" ||
    mediaType === "text/yaml" ||
    mediaType === "text/xml"
  );
}

function fixtureArtifact(file: FixtureWorkspaceFile, checksum: string, relativePath: string): BotArtifact {
  return {
    relativePath,
    mediaType: file.mediaType,
    size: new TextEncoder().encode(file.content).byteLength,
    updatedAt: file.updatedAt,
    checksum: { algorithm: "sha256", value: checksum },
  };
}

export function createFixtureService(): DesktopService {
  let bots: Bot[] = SEED_BOTS.map((bot) => ({ ...bot }));
  let rememberAttachment:
    | ((botId: string, relativePath: string, content: string, mediaType: string) => void)
    | undefined;
  let keyConfigured = false;
  let connectionScenario: ConnectionScenario = "unverified";
  let uiStateStore: UiState = {
    botOrder: [],
    groupOrder: [],
    selectedBotId: null,
    selectedGroupId: null,
  };
  // G1' 分组实体化: the fixture's groups are session state like everything
  // else here — it starts with none, so the sidebar shows only 未分组.
  const fixtureGroups: BotGroup[] = [];
  // D17': the fixture skill library is session memory too — the boot
  // migration fills it from localStorage once; nothing persists a refresh.
  let fixtureSkillLibrary: SkillLibrary = { skills: [], bindings: {} };
  let fixtureMicrophoneEnabled = true;

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
          role: draft.role ?? "standard",
          archivedAt: null,
          ...(draft.avatar != null ? { avatar: draft.avatar } : {}),
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
          ...(patch.avatar !== undefined ? { avatar: patch.avatar ?? undefined } : {}),
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
          name: t("common.copyOf", [bot.name]),
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

    // D26 fixture: no real storage — reports the path the host would use so
    // the composer flow is exercisable offline. Never claim a real commit.
    attachments: {
      async upload(botId, file): Promise<AttachmentUploadResult> {
        const path = fixtureAttachmentPath(file.name);
        const mediaType = fixtureMediaType(path);
        const textLike =
          mediaType.startsWith("text/") ||
          mediaType === "application/json" ||
          mediaType === "text/yaml" ||
          mediaType === "text/xml";
        const content = textLike ? new TextDecoder().decode(file.bytes) : "";
        rememberAttachment?.(botId, path, content, mediaType);
        return {
          path,
          size: file.bytes.byteLength,
          checksum: await fixtureChecksum(content),
        };
      },
    },

    chat: {
      async listSessions(botId) {
        const created = fixtureSessions.get(botId) ?? [];
        return [...seedSessions().filter((s) => s.botId === botId), ...created];
      },

      async createSession(botId, title) {
        requireBot(botId);
        fixtureSessionCounter += 1;
        const session: ChatSessionView = {
          sessionId: `cs:fixture-${fixtureSessionCounter}`,
          botId,
          title: title ?? t("chat.sessionUntitled"),
          startedAt: isoNow(),
          replayEventCount: 0,
          status: "active",
          archived: false,
          lastMessageAt: isoNow(),
        };
        fixtureSessions.set(botId, [...(fixtureSessions.get(botId) ?? []), session]);
        return session;
      },

      async renameSession(botId, sessionId, title) {
        const sessions = fixtureSessions.get(botId) ?? [];
        const found = sessions.find((s) => s.sessionId === sessionId);
        if (!found) {
          throw new ServiceError("INVALID_INPUT", `unknown session: ${sessionId}`);
        }
        const renamed = { ...found, title };
        fixtureSessions.set(
          botId,
          sessions.map((s) => (s.sessionId === sessionId ? renamed : s)),
        );
        return renamed;
      },

      async archiveSession(botId, sessionId) {
        const sessions = fixtureSessions.get(botId) ?? [];
        const found = sessions.find((s) => s.sessionId === sessionId);
        if (!found) {
          throw new ServiceError("INVALID_INPUT", `unknown session: ${sessionId}`);
        }
        const archived = { ...found, archived: true, status: "ended" as const };
        fixtureSessions.set(
          botId,
          sessions.map((s) => (s.sessionId === sessionId ? archived : s)),
        );
        return archived;
      },

      async openSession(_botId, sessionId) {
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
        return { events, messages: [] };
      },

      // The fixture chat thread lives in the UI's own state; there are no
      // persisted host rows to replay (dispatch markers/notices show up
      // only against a real host).
      history: async (botId, limit) => fixtureChatHistory(botId, limit),

      // No host meter in the browser preview: an honest empty gauge, not a
      // fabricated percentage.
      contextUsage: async () => ({
        percent: 0,
        usedTokens: 0,
        windowTokens: 0,
        estimated: true,
        compressedAt: null,
        compressing: false,
      }),

      async importAttachment(botId, file) {
        requireBot(botId);
        if (file.bytes.byteLength === 0) {
          throw new ServiceError("INVALID_INPUT", t("shell.attachmentEmpty", [file.name]));
        }
        const relativePath = fixtureAttachmentPath(file.name);
        const mediaType = fixtureMediaType(relativePath);
        const textLike =
          mediaType.startsWith("text/") ||
          mediaType === "application/json" ||
          mediaType === "text/yaml" ||
          mediaType === "text/xml";
        const content = textLike ? new TextDecoder().decode(file.bytes) : "";
        rememberAttachment?.(botId, relativePath, content, mediaType);
        return {
          relativePath,
          mediaType,
          size: file.bytes.byteLength,
          checksum: await fixtureChecksum(content),
        };
      },

      aside(): Promise<boolean> {
        return Promise.resolve(false);
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
        const reply = t("services.placeholderReply", [userText.slice(0, 40)]);

        const schedule = (delay: number, fn: () => void): void => {
          timers.push(setTimeout(() => { if (!settled) fn(); }, delay));
        };

        schedule(chunkDelayMs, () => {
          handlers.onTool({
            toolName: "read_workspace_file",
            state: "requested",
            summary: t("services.fixtureReadTool"),
          } satisfies ToolStatus);
        });
        schedule(chunkDelayMs * 2, () => {
          handlers.onTool({
            toolName: "read_workspace_file",
            state: "succeeded",
            summary: t("services.fixtureReadDone"),
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
                      ? t("chat.rateLimited")
                      : simulateFailure === "BUDGET_EXCEEDED"
                        ? t("chat.budgetExhausted")
                        : t("chat.requestFailed"),
                  /* only a rate limit is worth retrying; out of credit is not */
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

    artifacts: (() => {
      const workspaces = new Map<string, Map<string, FixtureWorkspaceFile>>();
      for (const seed of SEED_WORKSPACE_FILES) {
        let files = workspaces.get(seed.botId);
        if (files === undefined) {
          files = new Map<string, FixtureWorkspaceFile>();
          workspaces.set(seed.botId, files);
        }
        files.set(seed.relativePath, {
          content: seed.content,
          mediaType: fixtureMediaType(seed.relativePath),
          updatedAt: "2026-10-24T10:05:00Z",
          versions: [],
          nextRevision: 1,
          versionContents: new Map<string, string>(),
        });
      }

      const requireFile = (botId: string, relativePath: string): FixtureWorkspaceFile => {
        const file = workspaces.get(botId)?.get(relativePath);
        if (file === undefined) {
          throw new ServiceError("INVALID_INPUT", `artifact not found: ${relativePath}`);
        }
        return file;
      };

      const checkedArtifact = (
        file: FixtureWorkspaceFile,
        checksum: string,
        relativePath: string,
      ): BotArtifact => {
        const checked = validateBotArtifact(fixtureArtifact(file, checksum, relativePath));
        if (!checked.ok) {
          throw new ServiceError("INVALID_INPUT", "artifact fixture failed schema");
        }
        return checked.value;
      };

      const appendVersion = async (
        botId: string,
        file: FixtureWorkspaceFile,
        relativePath: string,
        author: "user" | "bot",
      ): Promise<ArtifactVersion> => {
        const checksum = await fixtureChecksum(file.content);
        const version = validateArtifactVersion({
          id: crypto.randomUUID(),
          botId,
          relativePath,
          revision: file.nextRevision,
          author,
          mediaType: file.mediaType,
          size: new TextEncoder().encode(file.content).byteLength,
          checksum: { algorithm: "sha256", value: checksum },
          createdAt: isoNow(),
        });
        if (!version.ok) {
          throw new ServiceError("INVALID_INPUT", "artifact version fixture failed schema");
        }
        file.nextRevision += 1;
        file.versions = [version.value, ...file.versions];
        file.versionContents.set(version.value.id, file.content);
        return version.value;
      };

      // Seeded files get their v1 ("bot") version lazily, once per file, so
      // the version panel has history out of the box without sync checksums.
      const seededFiles = new Set<string>();
      const ensureSeedVersion = async (
        botId: string,
        relativePath: string,
        file: FixtureWorkspaceFile,
      ): Promise<void> => {
        const key = `${botId}:${relativePath}`;
        if (seededFiles.has(key)) {
          return;
        }
        seededFiles.add(key);
        if (file.versions.length === 0) {
          await appendVersion(botId, file, relativePath, "bot");
        }
      };

      rememberAttachment = (botId, relativePath, content, mediaType) => {
        let files = workspaces.get(botId);
        if (files === undefined) {
          files = new Map();
          workspaces.set(botId, files);
        }
        const existing = files.get(relativePath);
        if (existing !== undefined) {
          existing.content = content;
          existing.mediaType = mediaType;
          existing.updatedAt = isoNow();
          return;
        }
        files.set(relativePath, {
          content,
          mediaType,
          updatedAt: isoNow(),
          versions: [],
          nextRevision: 1,
          versionContents: new Map(),
        });
      };

      return {
        async list(botId) {
          const files = workspaces.get(botId);
          if (files === undefined) {
            return [];
          }
          const artifacts: BotArtifact[] = [];
          for (const [relativePath, file] of files) {
            artifacts.push(checkedArtifact(file, await fixtureChecksum(file.content), relativePath));
          }
          return artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        },

        async read(botId, relativePath) {
          const file = requireFile(botId, relativePath);
          if (!fixtureEditable(file.mediaType)) {
            return {
              kind: "blocked",
              mediaType: file.mediaType,
              reason:
                file.mediaType === "text/html"
                  ? t("services.htmlInlineBlocked")
                  : t("services.mediaTypeNotEditable", [file.mediaType]),
            };
          }
          await ensureSeedVersion(botId, relativePath, file);
          return {
            kind: "text",
            mediaType: file.mediaType,
            checksum: { algorithm: "sha256", value: await fixtureChecksum(file.content) },
            content: file.content,
          };
        },

        async save(botId, relativePath, content, expectedChecksum) {
          requireBot(botId);
          let files = workspaces.get(botId);
          if (files === undefined) {
            files = new Map<string, FixtureWorkspaceFile>();
            workspaces.set(botId, files);
          }
          const existing = files.get(relativePath);
          if (existing !== undefined) {
            await ensureSeedVersion(botId, relativePath, existing);
            const current = await fixtureChecksum(existing.content);
            if (expectedChecksum !== undefined && current !== expectedChecksum) {
              throw new ServiceError(
                "REVISION_CONFLICT",
                t("services.revisionConflict"),
                false,
              );
            }
            existing.content = content;
            existing.updatedAt = isoNow();
            const version = await appendVersion(botId, existing, relativePath, "user");
            return {
              artifact: checkedArtifact(existing, await fixtureChecksum(existing.content), relativePath),
              version,
            };
          }
          const mediaType = fixtureMediaType(relativePath);
          if (!fixtureEditable(mediaType)) {
            throw new ServiceError("INVALID_INPUT", t("services.mediaTypeCanvasUnsupported", [mediaType]));
          }
          const created: FixtureWorkspaceFile = {
            content,
            mediaType,
            updatedAt: isoNow(),
            versions: [],
            nextRevision: 1,
            versionContents: new Map<string, string>(),
          };
          files.set(relativePath, created);
          const version = await appendVersion(botId, created, relativePath, "user");
          return {
            artifact: checkedArtifact(created, await fixtureChecksum(created.content), relativePath),
            version,
          };
        },

        async versions(botId, relativePath) {
          const file = requireFile(botId, relativePath);
          await ensureSeedVersion(botId, relativePath, file);
          return file.versions;
        },

        async versionContent(botId, relativePath, versionId) {
          const file = requireFile(botId, relativePath);
          const content = file.versionContents.get(versionId);
          if (content === undefined) {
            throw new ServiceError("INVALID_INPUT", "version not found for this file");
          }
          if (!fixtureEditable(file.mediaType)) {
            return {
              kind: "blocked",
              mediaType: file.mediaType,
              reason: t("services.mediaTypeNoPreviewText", [file.mediaType]),
            };
          }
          return { kind: "text", mediaType: file.mediaType, content };
        },

        async revert(botId, relativePath, versionId) {
          const file = requireFile(botId, relativePath);
          const content = file.versionContents.get(versionId);
          if (content === undefined) {
            throw new ServiceError("INVALID_INPUT", "version not found for this file");
          }
          file.content = content;
          file.updatedAt = isoNow();
          const revertVersion = await appendVersion(botId, file, relativePath, "user");
          return {
            artifact: checkedArtifact(file, await fixtureChecksum(file.content), relativePath),
            version: revertVersion,
          };
        },
      };
    })(),

    vault: (() => {
      // In-memory backup store shaped like the real one: created backups get
      // an id/time/size and persist for the session; restore refuses unknown
      // ids exactly like the storage layer refuses a missing directory.
      let counter = 0;
      const backups: Array<{
        backupId: string;
        createdAt: string;
        schemaVersion: number;
        sizeBytes: number;
      }> = [
        {
          backupId: "fixture-backup-older",
          createdAt: "2026-10-25T08:00:00.000Z",
          schemaVersion: 11,
          sizeBytes: 48_000,
        },
      ];

      return {
        async listBackups() {
          return [...backups];
        },
        async createBackup() {
          counter += 1;
          const created = {
            backupId: `fixture-backup-${counter}`,
            createdAt: new Date().toISOString(),
            schemaVersion: 11,
            sizeBytes: 52_000 + counter,
          };
          backups.unshift(created);
          return created;
        },
        async restore(backupId) {
          if (!backups.some((backup) => backup.backupId === backupId)) {
            throw new ServiceError("INVALID_INPUT", t("d24.backupMissing"));
          }
          return { restored: true as const, hostRestarted: true };
        },
        async describe() {
          return {
            schemaVersion: "11",
            counts: { bots: bots.length, workflows: 0, runs: 0, schedules: 0 },
          };
        },
      };
    })(),

    hardwareAcceleration(enabled?: boolean) {
      // Fixture: the preference flips in memory; a real shell restart is a
      // packaged-app concern and stays UNVERIFIED here.
      if (enabled === undefined) {
        return Promise.resolve({ enabled: true, restartRequired: false });
      }
      return Promise.resolve({ enabled, restartRequired: true });
    },

    microphone(enabled?: boolean) {
      if (enabled === undefined) {
        return Promise.resolve({ enabled: fixtureMicrophoneEnabled });
      }
      fixtureMicrophoneEnabled = enabled;
      return Promise.resolve({ enabled });
    },

    workflows: createFixtureWorkflowService(),
    runs: createFixtureRunService(),
    tasks: createFixtureTaskService(),

    // D17': the fixture skill library is session memory — save echoes and
    // keeps the library for the rest of the session, nothing more.
    skills: {
      getLibrary: () => Promise.resolve(fixtureSkillLibrary),
      saveLibrary: (library) => {
        fixtureSkillLibrary = library;
        return Promise.resolve(library);
      },
    },

    // G1': the fixture keeps the snapshot in memory — session state like
    // everything else here, gone on restart.
    uiState: {
      get: () => Promise.resolve(uiStateStore),
      save: (state) => {
        uiStateStore = state;
        return Promise.resolve(state);
      },
    },

    // B3'' fixture: no pinned-catalog knowledge in the preview, so the UI
    // stays neutral (visionKnown=false) and image cards keep the fallback
    // note — an honest "unknown", not a fabricated "supported".
    vision: {
      status: () =>
        Promise.resolve({ model: "fixture-model", visionAvailable: false, visionKnown: false }),
    },

    // G1' 分组实体化: in-memory groups with the same archive semantics as
    // the Host (optimistic concurrency, list skips archived).
    groups: {
      list: () => Promise.resolve(fixtureGroups.filter((g) => g.archivedAt === null)),
      create: (name) => {
        const group: BotGroup = {
          id: crypto.randomUUID(),
          revision: crypto.randomUUID(),
          name,
          archivedAt: null,
        };
        fixtureGroups.push(group);
        return Promise.resolve(group);
      },
      archive: (id, expectedRevision) => {
        const group = fixtureGroups.find((g) => g.id === id);
        if (!group) {
          return Promise.reject(
            new ServiceError("INVALID_INPUT", `group not found: ${id}`),
          );
        }
        if (group.revision !== expectedRevision) {
          return Promise.reject(
            new ServiceError("REVISION_CONFLICT", "group was modified by someone else"),
          );
        }
        if (group.archivedAt !== null) {
          return Promise.resolve(group);
        }
        const archived: BotGroup = {
          ...group,
          revision: crypto.randomUUID(),
          archivedAt: new Date().toISOString(),
        };
        fixtureGroups.splice(fixtureGroups.indexOf(group), 1, archived);
        return Promise.resolve(archived);
      },
    },

    // The fixture chat is renderer-local only, so there is no Host corpus to
    // query; the overlay degrades to its local index without a failure notice.
    search: {
      global: () => Promise.resolve([]),
    },
  };

  return service;
}
