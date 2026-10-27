/**
 * Host-backed DesktopService (D12 wiring).
 *
 * The renderer is a sandboxed browser context: it can only reach the Host
 * through the preload bridge (`window.deepseekBot.host.call`), which forwards
 * one allowlisted contract method at a time. This implementation replaces the
 * fixture for settings and bots; chat/workflow/run views stay on the fixture
 * until their contract methods exist (see docs/AGENT_PLATFORM.md).
 */
import type { Bot, ErrorCode } from "@deepseek-bot/contracts";
import {
  ServiceError,
  type BotDraft,
  type DesktopService,
  type StreamResult,
  type TestConnectionResult,
} from "./desktop-service.js";
import { validateArtifactVersion, validateBotArtifact } from "./contract-validation.js";
import { createFixtureService } from "./fixture-service.js";

type HostBridge = {
  host: { call: (method: string, payload: unknown) => Promise<unknown> };
  settings: { saveKey: (key: string) => Promise<{ configured: boolean }> };
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
  const artifactCall = async (method: string, payload: unknown): Promise<unknown> => {
    try {
      return await bridge.host.call(method, payload);
    } catch (error) {
      const code = (error as { code?: ErrorCode }).code;
      if (typeof code === "string") {
        throw new ServiceError(code, error instanceof Error ? error.message : String(error), false);
      }
      throw error;
    }
  };

  return {
    ...base,
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
          throw new ServiceError("INVALID_INPUT", "找不到要复制的 Bot", false);
        }
        return (await bridge.host.call("bot.create", {
          name: `${source.name} 副本`,
          instructions: source.instructions,
          modelProfileId: source.modelProfileId,
          workspaceId: source.workspaceId,
          toolPolicyId: source.toolPolicyId,
        })) as Bot;
      },
    },
    artifacts: {
      list: async (botId) => {
        const response = (await artifactCall("artifacts.list", { botId })) as {
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
        (await artifactCall("artifacts.read", { botId, path: relativePath })) as Awaited<
          ReturnType<DesktopService["artifacts"]["read"]>
        >,
      save: async (botId, relativePath, content, expectedChecksum) => {
        const response = (await artifactCall("artifacts.save", {
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
        const response = (await artifactCall("artifacts.versions", {
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
        (await artifactCall("artifacts.versionContent", {
          botId,
          path: relativePath,
          versionId,
        })) as Awaited<ReturnType<DesktopService["artifacts"]["versionContent"]>>,
      revert: async (botId, relativePath, versionId) => {
        const response = (await artifactCall("artifacts.revert", {
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
    chat: {
      // Sessions/history replay stays empty for now: the Host persists chat
      // rows (chat.history) but the UI rebuilds its thread from live sends.
      listSessions: async () => [],
      openSession: async () => ({ events: [] }),
      stream: (botId, text, handlers) => {
        let cancelled = false;
        const sessionId = `chat:${botId}`;
        const done = bridge.host
          .call("chat.send", { botId, text })
          .then((response) => {
            const reply = (response as { text: string }).text;
            if (!cancelled) {
              const chunks = reply.match(/[\s\S]{1,32}/g) ?? [reply];
              for (const chunk of chunks) {
                handlers.onDelta(chunk);
              }
            }
            return { cancelled, failure: null } satisfies StreamResult;
          })
          .catch((error: unknown) => ({
            cancelled,
            failure: {
              code: (error as { code?: ErrorCode }).code ?? "RUNTIME_UNAVAILABLE",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
          }));
        return {
          cancel: () => {
            cancelled = true;
            void bridge.host.call("chat.cancel", { sessionId }).catch(() => undefined);
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
  };
}

