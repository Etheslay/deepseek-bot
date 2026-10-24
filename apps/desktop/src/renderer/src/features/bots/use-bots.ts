/**
 * Contract-backed bot list state for the workspace UI (D05 brief §2.1).
 *
 * The contract Bot entity is the source of truth; visual-only attributes
 * (shape/color/group/unread) are session UI state and are deliberately NOT
 * part of any contract. Group membership is UI-only because CONTRACTS v0.1
 * has no Bot.group field.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bot } from "@deepseek-bot/contracts";
import type { BotDraft } from "../../services/desktop-service.js";
import { ServiceError } from "../../services/desktop-service.js";
import { useService } from "../../services/service-context.js";

export type UiBot = {
  /** Stable numeric key for list rendering; contract id lives on `bot.id`. */
  key: number;
  bot: Bot;
  shape: number;
  color: number;
  group: number;
  unread: boolean;
  /** UI-only hide (session state; the service has no delete). */
  hidden: boolean;
};

type UiFields = Pick<UiBot, "shape" | "color" | "group" | "unread">;

export type BotsOperationResult = {
  ok: boolean;
  /** Key of the affected UiBot on success (create/duplicate). */
  key?: number;
  errorCode?: string;
};

export function useBots(defaultGroupKey: number) {
  const service = useService();
  const [bots, setBots] = useState<UiBot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const uiByBotId = useRef(new Map<string, UiFields>());

  const toUi = useCallback((bot: Bot): UiBot => {
    const saved = uiByBotId.current.get(bot.id);
    const fields: UiFields = saved ?? {
      shape: 0,
      color: 2,
      group: defaultGroupKey,
      unread: false,
    };
    return { key: nextKey.current++, bot, ...fields, hidden: false };
  }, [defaultGroupKey]);

  const remember = (bot: Bot, patch: Partial<UiFields>): void => {
    const saved = uiByBotId.current.get(bot.id) ?? {
      shape: 0,
      color: 2,
      group: defaultGroupKey,
      unread: false,
    };
    uiByBotId.current.set(bot.id, { ...saved, ...patch });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await service.bots.list();
        if (!cancelled) {
          setBots(list.map(toUi));
          setLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, toUi]);

  const refresh = useCallback(async () => {
    const list = await service.bots.list();
    setBots(list.map(toUi));
  }, [service, toUi]);

  const create = useCallback(
    async (draft: BotDraft): Promise<BotsOperationResult> => {
      try {
        const bot = await service.bots.create(draft);
        remember(bot, { group: defaultGroupKey });
        const uiBot = toUi(bot);
        setBots((prev) => [...prev, uiBot]);
        return { ok: true, key: uiBot.key };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof ServiceError ? error.code : "INVALID_INPUT",
        };
      }
    },
    [service, defaultGroupKey, toUi],
  );

  const update = useCallback(
    async (botId: string, patch: Partial<BotDraft>): Promise<BotsOperationResult> => {
      const target = bots.find((b) => b.bot.id === botId);
      if (!target) {
        return { ok: false, errorCode: "INVALID_INPUT" };
      }
      try {
        const bot = await service.bots.update(botId, target.bot.revision, patch);
        setBots((prev) =>
          prev.map((b) => (b.bot.id === botId ? { ...b, bot } : b)),
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof ServiceError && error.code === "REVISION_CONFLICT") {
          void refresh();
        }
        return {
          ok: false,
          errorCode: error instanceof ServiceError ? error.code : "INVALID_INPUT",
        };
      }
    },
    [bots, service, refresh],
  );

  const archive = useCallback(
    async (botId: string): Promise<BotsOperationResult> => {
      const target = bots.find((b) => b.bot.id === botId);
      if (!target) {
        return { ok: false, errorCode: "INVALID_INPUT" };
      }
      try {
        const bot = await service.bots.archive(botId, target.bot.revision);
        setBots((prev) =>
          prev.map((b) => (b.bot.id === botId ? { ...b, bot } : b)),
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof ServiceError && error.code === "REVISION_CONFLICT") {
          void refresh();
        }
        return {
          ok: false,
          errorCode: error instanceof ServiceError ? error.code : "INVALID_INPUT",
        };
      }
    },
    [bots, service, refresh],
  );

  const duplicate = useCallback(
    async (botId: string): Promise<BotsOperationResult> => {
      const target = bots.find((b) => b.bot.id === botId);
      if (!target) {
        return { ok: false, errorCode: "INVALID_INPUT" };
      }
      try {
        const copy = await service.bots.duplicate(botId);
        remember(copy, {
          shape: target.shape,
          color: target.color,
          group: target.group,
        });
        const uiBot = toUi(copy);
        setBots((prev) => [...prev, uiBot]);
        return { ok: true, key: uiBot.key };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof ServiceError ? error.code : "INVALID_INPUT",
        };
      }
    },
    [bots, service, toUi],
  );

  const setUi = useCallback((botKey: number, patch: Partial<UiFields>): void => {
    setBots((prev) =>
      prev.map((b) => {
        if (b.key !== botKey) {
          return b;
        }
        remember(b.bot, patch);
        return { ...b, ...patch };
      }),
    );
  }, []);

  const moveToTop = useCallback((botKey: number): void => {
    setBots((prev) => {
      const target = prev.find((b) => b.key === botKey);
      if (!target) {
        return prev;
      }
      return [target, ...prev.filter((b) => b.key !== botKey)];
    });
  }, []);

  const hide = useCallback((botKey: number): void => {
    setBots((prev) => prev.filter((b) => b.key !== botKey));
  }, []);

  const visible = bots.filter((b) => !b.hidden);

  return {
    bots: visible,
    loaded,
    loadError,
    create,
    update,
    archive,
    duplicate,
    setUi,
    moveToTop,
    hide,
  };
}
