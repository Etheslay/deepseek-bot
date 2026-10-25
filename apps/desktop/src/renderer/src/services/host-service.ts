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
  type TestConnectionResult,
} from "./desktop-service.js";
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
