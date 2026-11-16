/**
 * Host-backed DesktopService (D12 wiring).
 *
 * The renderer is a sandboxed browser context: it can only reach the Host
 * through the preload bridge (`window.deepseekBot.host.call`), which forwards
 * one allowlisted contract method at a time. This implementation replaces the
 * fixture for settings, bots, workflow editing and the run monitor; the fixture
 * service remains the seed for surfaces without a contract method yet.
 */
import {
  ChatSessionSchema,
  MAX_ATTACHMENT_CHUNK_BYTES,
  METHOD_CONTRACTS,
  type Bot,
  type BotGroup,
  type ErrorCode,
  type SkillLibrary,
  type Task,
  type UiState,
} from "@deepseek-bot/contracts";
import { bytesToBase64 } from "../features/chat/attachments.js";
import { deliveredFilesFromResponse } from "./delivered-bytes.js";
import {
  ServiceError,
  type AttachmentUploadResult,
  type BotDraft,
  type ChatHistoryRow,
  type ChatSessionView,
  type DesktopService,
  type StreamResult,
  type TestConnectionResult,
} from "./desktop-service.js";
import { validateArtifactVersion, validateBotArtifact } from "./contract-validation.js";
import { createFixtureService } from "./fixture-service.js";
import { createHostRunService } from "./host-run-service.js";
import { createHostWorkflowService } from "./host-workflow-service.js";
import type { HostCall } from "./host-call.js";
import {
  STORED_SESSION_HISTORY_LIMIT,
} from "./stored-session.js";
import { t } from "../i18n.js";
import {
  encodeBase64,
  sha256Hex,
  splitAttachmentChunks,
} from "../features/chat/attachments.js";

type HostBridge = {
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
    /** B6: live assistant segments (absent on bridges that predate the channel). */
    onChatStream?: (
      listener: (notice: { botId: string; sessionId: string; text: string }) => void,
    ) => () => void;
  };
  settings: { saveKey: (key: string) => Promise<{ configured: boolean }> };
  backups?: { list: () => Promise<unknown[]> };
  app?: {
    hardwareAcceleration: (
      enabled?: boolean,
    ) => Promise<{ enabled: boolean; restartRequired: boolean }>;
    microphone?: (enabled?: boolean) => Promise<{ enabled: boolean }>;
  };
};

export function createHostService(bridge: HostBridge): DesktopService {
  const base = createFixtureService();
  let keyConfigured = false;

  const listBots = async (): Promise<Bot[]> => {
    const response = (await bridge.host.call("bot.list", {})) as { bots: Bot[] };
    return response.bots;
  };

  /**
   * Host errors arrive as plain objects with a stable `code`; map them to the
   * ServiceError the UI already understands. REVISION_CONFLICT keeps its
   * meaning: the file changed underneath an open editor.
   */
  const hostCall: HostCall = async (method, payload) => {
    try {
      return await bridge.host.call(method, payload);
    } catch (error) {
      const shaped = error as { code?: unknown };
      const named =
        error instanceof Error && error.name !== "Error" && error.name !== "ServiceError"
          ? error.name
          : undefined;
      const code = typeof shaped.code === "string" ? shaped.code : named;
      if (typeof code === "string") {
        throw new ServiceError(
          code as ErrorCode,
          error instanceof Error ? error.message : String(error),
          false,
        );
      }
      throw error;
    }
  };

  const readHistory = async (botId: string, limit: number, sessionId?: string): Promise<ChatHistoryRow[]> => {
    const response = (await bridge.host.call("chat.history", {
      botId,
      limit,
      ...(sessionId !== undefined ? { sessionId } : {}),
    })) as { messages: ChatHistoryRow[] };
    return response.messages;
  };

  // v0.12 read surface: editing and monitoring run against the real Host.
  const workflows = createHostWorkflowService(hostCall);
  const runs = createHostRunService(hostCall);

  // G1' (v0.13): the sidebar snapshot persists in the Host's settings KV.
  const uiState = {
    get: async (): Promise<UiState> =>
      ((await bridge.host.call("ui.state.get", {})) as { state: UiState }).state,
    save: async (state: UiState): Promise<UiState> =>
      ((await bridge.host.call("ui.state.set", { state })) as { state: UiState }).state,
  };

  /**
   * G12: one host ChatSession row → the ChatSessionView the UI renders. The
   * response is parsed against the frozen contract so a malformed reply
   * cannot reach the sidebar.
   */
  const toSessionView = (session: unknown): ChatSessionView => {
    const row = ChatSessionSchema.parse(session);
    return {
      sessionId: row.sessionId,
      botId: row.botId,
      title: row.title,
      startedAt: row.createdAt,
      replayEventCount: row.messageCount,
      status: row.archived ? "ended" : "active",
      archived: row.archived,
      lastMessageAt: row.lastMessageAt,
    };
  };

  const sessionCall = async (
    method: "chat.session.create" | "chat.session.rename" | "chat.session.archive",
    payload: Record<string, unknown>,
  ): Promise<ChatSessionView> => {
    const response = (await hostCall(method, payload)) as { session: unknown };
    return toSessionView(response.session);
  };

  // B3'' (v0.14): the vision capability flag for the composer UI.
  const vision = {
    status: async (botId: string) =>
      METHOD_CONTRACTS["vision.status"].response.parse(
        await bridge.host.call("vision.status", { botId }),
      ),
  };

  // G1' 分组实体化 (v0.14): the sidebar's persisted groups.
  const groups = {
    list: async (): Promise<BotGroup[]> =>
      ((await bridge.host.call("group.list", {})) as { groups: BotGroup[] }).groups,
    create: async (name: string): Promise<BotGroup> =>
      (await bridge.host.call("group.create", { name })) as BotGroup,
    archive: async (id: string, expectedRevision: string): Promise<BotGroup> =>
      (await bridge.host.call("group.archive", { id, expectedRevision })) as BotGroup,
  };

  // D17' (v0.11): the skill library persists in the Host's settings KV; the
  // contract schemas stay the validation authority on both calls.
  const skills = {
    getLibrary: async (): Promise<SkillLibrary> =>
      METHOD_CONTRACTS["skillLibrary.get"].response.parse(
        await bridge.host.call("skillLibrary.get", {}),
      ).library,
    saveLibrary: async (library: SkillLibrary): Promise<SkillLibrary> =>
      METHOD_CONTRACTS["skillLibrary.save"].response.parse(
        await bridge.host.call("skillLibrary.save", { library }),
      ).library,
  };

  return {
    ...base,
    workflows,
    runs,
    uiState,
    vision,
    groups,
    skills,
    bots: {
      list: listBots,
      create: async (draft: BotDraft): Promise<Bot> =>
        (await bridge.host.call("bot.create", draft)) as Bot,
      update: async (botId, expectedRevision, patch): Promise<Bot> =>
        (await bridge.host.call("bot.update", {
          id: botId,
          expectedRevision,
          patch,
        })) as Bot,
      archive: async (botId, expectedRevision): Promise<Bot> =>
        (await bridge.host.call("bot.archive", { id: botId, expectedRevision })) as Bot,
      duplicate: async (botId): Promise<Bot> => {
        const bots = await listBots();
        const source = bots.find((bot) => bot.id === botId);
        if (!source) {
          throw new ServiceError("INVALID_INPUT", t("services.botNotFound"), false);
        }
        return (await bridge.host.call("bot.create", {
          name: t("common.copyOf", [source.name]),
          instructions: source.instructions,
          modelProfileId: source.modelProfileId,
          workspaceId: source.workspaceId,
          toolPolicyId: source.toolPolicyId,
        })) as Bot;
      },
    },
    artifacts: {
      list: async (botId) => {
        const response = (await hostCall("artifacts.list", { botId })) as {
          artifacts: unknown[];
        };
        return response.artifacts.map((artifact) => {
          const checked = validateBotArtifact(artifact);
          if (!checked.ok) {
            throw new ServiceError("INVALID_INPUT", "artifacts.list response failed schema");
          }
          return checked.value;
        });
      },
      read: async (botId, relativePath) =>
        (await hostCall("artifacts.read", { botId, path: relativePath })) as Awaited<
          ReturnType<DesktopService["artifacts"]["read"]>
        >,
      save: async (botId, relativePath, content, expectedChecksum) => {
        const response = (await hostCall("artifacts.save", {
          botId,
          path: relativePath,
          content,
          ...(expectedChecksum !== undefined ? { expectedChecksum } : {}),
        })) as { artifact: unknown; version: unknown };
        const artifact = validateBotArtifact(response.artifact);
        const version = validateArtifactVersion(response.version);
        if (!artifact.ok || !version.ok) {
          throw new ServiceError("INVALID_INPUT", "artifacts.save response failed schema");
        }
        return { artifact: artifact.value, version: version.value };
      },
      versions: async (botId, relativePath) => {
        const response = (await hostCall("artifacts.versions", {
          botId,
          path: relativePath,
        })) as { versions: unknown[] };
        return response.versions.map((version) => {
          const checked = validateArtifactVersion(version);
          if (!checked.ok) {
            throw new ServiceError("INVALID_INPUT", "artifacts.versions response failed schema");
          }
          return checked.value;
        });
      },
      versionContent: async (botId, relativePath, versionId) =>
        (await hostCall("artifacts.versionContent", {
          botId,
          path: relativePath,
          versionId,
        })) as Awaited<ReturnType<DesktopService["artifacts"]["versionContent"]>>,
      revert: async (botId, relativePath, versionId) => {
        const response = (await hostCall("artifacts.revert", {
          botId,
          path: relativePath,
          versionId,
        })) as { artifact: unknown; version: unknown };
        const artifact = validateBotArtifact(response.artifact);
        const version = validateArtifactVersion(response.version);
        if (!artifact.ok || !version.ok) {
          throw new ServiceError("INVALID_INPUT", "artifacts.revert response failed schema");
        }
        return { artifact: artifact.value, version: version.value };
      },
    },
    attachments: {
      // D26: one begin call, 512 KiB base64 chunks, one commit — the Host
      // verifies size and sha256 before the file enters the workspace.
      upload: async (botId, { name, bytes }): Promise<AttachmentUploadResult> => {
        const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
        const sha256 = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const begun = (await hostCall("attachment.begin", {
          botId,
          name,
          size: bytes.byteLength,
          sha256,
        })) as { uploadId: string };
        for (let offset = 0; offset < bytes.byteLength; offset += MAX_ATTACHMENT_CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, Math.min(offset + MAX_ATTACHMENT_CHUNK_BYTES, bytes.byteLength));
          await hostCall("attachment.append", {
            uploadId: begun.uploadId,
            chunkBase64: bytesToBase64(chunk),
          });
        }
        return (await hostCall("attachment.commit", {
          uploadId: begun.uploadId,
        })) as AttachmentUploadResult;
      },
    },
    chat: {
      // G12: real session metadata; the default session materializes host-side.
      listSessions: async (botId) => {
        const response = (await hostCall("chat.session.list", { botId })) as {
          sessions: unknown[];
        };
        return response.sessions.map(toSessionView);
      },
      createSession: (botId, title) =>
        sessionCall("chat.session.create", {
          botId,
          ...(title !== undefined ? { title } : {}),
        }),
      renameSession: (botId, sessionId, title) =>
        sessionCall("chat.session.rename", { botId, sessionId, title }),
      archiveSession: (botId, sessionId) =>
        sessionCall("chat.session.archive", { botId, sessionId }),
      openSession: async (botId, sessionId) => ({
        events: [],
        messages: await readHistory(botId, STORED_SESSION_HISTORY_LIMIT, sessionId),
      }),
      history: async (botId, limit = 100, sessionId) =>
        readHistory(botId, limit, sessionId),
      aside: async (botId, text) => {
        const response = METHOD_CONTRACTS["chat.aside"].response.parse(
          await hostCall("chat.aside", { botId, text }),
        );
        return response.queued;
      },
      contextUsage: async (botId, sessionId) =>
        METHOD_CONTRACTS["chat.contextUsage"].response.parse(
          await bridge.host.call("chat.contextUsage", {
            botId,
            ...(sessionId !== undefined ? { sessionId } : {}),
          }),
        ),
      importAttachment: async (botId, file) => {
        if (file.bytes.byteLength === 0) {
          throw new ServiceError("INVALID_INPUT", t("shell.attachmentEmpty", [file.name]));
        }
        const checksum = await sha256Hex(file.bytes);
        const chunks = splitAttachmentChunks(file.bytes);
        const uploadId = crypto.randomUUID();
        let imported: {
          relativePath: string;
          mediaType: string;
          size: number;
          checksum: string;
        } | null = null;
        for (let index = 0; index < chunks.length; index += 1) {
          const response = METHOD_CONTRACTS["chat.attach"].response.parse(
            await bridge.host.call("chat.attach", {
              botId,
              uploadId,
              name: file.name,
              mediaType: file.mediaType,
              size: file.bytes.byteLength,
              checksum,
              index,
              count: chunks.length,
              data: encodeBase64(chunks[index]!),
            }),
          );
          if (response.status === "imported") imported = response;
        }
        if (imported === null) {
          throw new ServiceError("INVALID_INPUT", t("shell.attachmentImportFailed", [file.name]));
        }
        return imported;
      },
      stream: (botId, text, handlers, options) => {
        let cancelled = false;
        /** What handlers.onDelta has already emitted, in order. */
        let shown = "";
        // The cancel key stays bot-scoped: one turn per bot runs at a time,
        // no matter which session it was started from.
        const cancelSessionId = `chat:${botId}`;
        const skills = options?.skills;
        const primitive = options?.primitive === true;
        const storageSessionId = options?.sessionId;
        const images = options?.images;
        const payload: Record<string, unknown> = { botId, text };
        if (storageSessionId !== undefined) {
          payload.sessionId = storageSessionId;
        }
        if (skills !== undefined && skills.length > 0) {
          payload.skills = skills;
        }
        if (images !== undefined && images.length > 0) {
          payload.images = images;
        }
        if (primitive) {
          payload.primitive = true;
        }
        /**
         * B6 incremental streaming. The Host pushes one notification per
         * settled assistant segment (a whole message, not tokens). Each
         * segment is spoken in full: dripping it sentence by sentence left a
         * half-written line on screen while the next tool or paragraph was
         * still pending, and that pause read as a freeze. Emissions still
         * serialize so a tool turn's narration keeps its order. The thinking
         * line stays up under the finished paragraph until the turn ends.
         */
        let queued: Promise<void> = Promise.resolve();
        const emitWhole = (piece: string): Promise<void> => {
          const run = queued.then(() => {
            if (cancelled || piece.length === 0) return;
            shown += piece;
            handlers.onDelta(piece);
          });
          queued = run;
          return run;
        };
        const unsubscribe =
          bridge.host.onChatStream?.((notice) => {
            if (cancelled || notice.botId !== botId) return;
            void emitWhole(notice.text);
          }) ?? null;
        const done = bridge.host
          .call("chat.send", payload)
          .then(async (response) => {
            // The turn settled: no later notification belongs to this stream.
            unsubscribe?.();
            const reply = (response as { text: string }).text;
            const files = deliveredFilesFromResponse((response as { files?: unknown }).files);
            if (cancelled) {
              return { cancelled: true, failure: null, text: reply } satisfies StreamResult;
            }
            /**
             * The reply is authoritative (chat.send's response). Wait for the
             * live segments to settle, then converge: what was shown stays when
             * it is a prefix of the reply (single-segment turns — only the
             * remainder is spoken; no live segments — the whole reply is
             * spoken here). Interim narration of a tool turn is not part of
             * the reply, so nothing more is emitted and the caller commits
             * `text`, replacing the bubble.
             */
            await queued;
            if (cancelled) {
              return { cancelled: true, failure: null, text: reply } satisfies StreamResult;
            }
            if (reply.startsWith(shown) && reply.length > shown.length) {
              await emitWhole(reply.slice(shown.length));
            }
            return {
              cancelled,
              failure: null,
              text: reply,
              ...(files.length > 0 ? { files } : {}),
            } satisfies StreamResult;
          })
          .catch((error: unknown) => {
            unsubscribe?.();
            return {
              cancelled,
              failure: {
                code: (error as { code?: ErrorCode }).code ?? "RUNTIME_UNAVAILABLE",
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
            } satisfies StreamResult;
          });
        return {
          cancel: () => {
            cancelled = true;
            unsubscribe?.();
            void bridge.host.call("chat.cancel", { sessionId: cancelSessionId }).catch(() => undefined);
          },
          finish: () => done,
        };
      },
    },
    settings: {
      ...base.settings,
      saveKey: async (key) => {
        const result = await bridge.settings.saveKey(key);
        keyConfigured = result.configured;
        return result;
      },
      keyConfigured: () => keyConfigured,
      testConnection: async (input): Promise<TestConnectionResult> => {
        try {
          const response = (await bridge.host.call("settings.testConnection", {
            modelProfile: {
              provider: "deepseek",
              model: input.model,
              endpoint: input.endpoint,
            },
          })) as { ok: boolean; latencyMs?: number; errorCode?: ErrorCode };
          if (response.ok) {
            return {
              result: "success",
              ok: true,
              ...(response.latencyMs !== undefined ? { latencyMs: response.latencyMs } : {}),
            };
          }
          return {
            result: "failure",
            ok: false,
            ...(response.errorCode !== undefined ? { errorCode: response.errorCode } : {}),
          };
        } catch (error) {
          const code = (error as { code?: ErrorCode }).code;
          return {
            result: "failure",
            ok: false,
            errorCode: code ?? "RUNTIME_UNAVAILABLE",
          };
        }
      },
    },
    // D25-second-half Ctrl+K retrieval: one Host query over every persisted
    // corpus; responses are validated against the frozen contract before the
    // overlay sees them.
    search: {
      global: async (query) => {
        const response = METHOD_CONTRACTS["search.global"].response.parse(
          await bridge.host.call("search.global", { query, limit: 20 }),
        );
        return response.results;
      },
    },
    // v0.5 manager orchestration: dispatched tasks are host-backed from day
    // one (the fixture store only exists for offline UI development).
    tasks: {
      list: async (query = {}) =>
        (await bridge.host.call("task.list", {
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.rootTaskId !== undefined ? { rootTaskId: query.rootTaskId } : {}),
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
        })) as { tasks: Task[] },
      cancel: async (taskId) =>
        (await bridge.host.call("task.cancel", { taskId })) as Task,
    },

    vault: {
      listBackups: async () => {
        if (bridge.backups === undefined) {
          // Preview shims have no backups bridge; keep the vault visible but
          // honest about the empty listing instead of throwing.
          return [];
        }
        return (await bridge.backups.list()) as Awaited<
          ReturnType<DesktopService["vault"]["listBackups"]>
        >;
      },
      createBackup: async () => {
        const response = (await hostCall("data.backup", {})) as {
          backupId: string;
          createdAt: string;
          sizeBytes: number;
        };
        return response;
      },
      restore: async (backupId) => {
        const response = (await hostCall("data.restore", { backupId })) as {
          restored: true;
          hostRestarted?: boolean;
        };
        return { restored: true, hostRestarted: response.hostRestarted === true };
      },
      describe: async () => {
        const response = (await hostCall("data.describe", {})) as {
          schemaVersion: string;
          counts: Record<string, number>;
        };
        return response;
      },
    },
    hardwareAcceleration: (enabled?: boolean) => {
      if (bridge.app !== undefined) {
        return bridge.app.hardwareAcceleration(enabled);
      }
      // Preview shim fallback: report the default without persisting.
      if (enabled === undefined) {
        return Promise.resolve({ enabled: true, restartRequired: false });
      }
      return Promise.resolve({ enabled, restartRequired: true });
    },
    microphone: (enabled?: boolean) => {
      if (bridge.app?.microphone !== undefined) {
        return bridge.app.microphone(enabled);
      }
      if (enabled === undefined) {
        return Promise.resolve({ enabled: true });
      }
      return Promise.resolve({ enabled });
    },
  };
}

