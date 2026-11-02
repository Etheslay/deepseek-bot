/**
 * Contract-backed bot list state for the workspace UI (D05 brief §2.1).
 *
 * The contract Bot entity is the source of truth; visual-only attributes
 * (shape/color/group/unread) are session UI state and are deliberately NOT
 * part of any contract. Group membership is UI-only because CONTRACTS v0.1
 * has no Bot.group field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bot } from "@deepseek-bot/contracts";
import type { BotDraft, BotUpdatePatch } from "../../services/desktop-service.js";
import { ServiceError } from "../../services/desktop-service.js";
import { hostErrorCode, hostErrorMessage } from "../../services/host-error.js";
import { useService } from "../../services/service-context.js";
import { defaultAvatarFor, fromContractAvatar, type Avatar } from "../avatars/avatar-meta.js";
import { t } from "../../i18n.js";

export type UiBot = {
  /** Stable numeric key for list rendering; contract id lives on `bot.id`. */
  key: number;
  bot: Bot;
  avatar: Avatar;
  shape: number;
  color: number;
  group: number;
  unread: boolean;
  /** UI-only hide (session state; the service has no delete). */
  hidden: boolean;
};

type UiFields = Pick<UiBot, "avatar" | "shape" | "color" | "group" | "unread">;

const LOOKS_KEY = "deepseek-bot.bot-looks.v1";

type StoredLook = { avatar: Avatar; shape: number; color: number };

function isStoredAvatar(value: unknown): value is Avatar {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "mono") return true;
  if (kind !== "grok") return false;
  const record = value as { shape?: unknown; color?: unknown };
  return typeof record.shape === "string" && typeof record.color === "string";
}

function readLooks(): Map<string, StoredLook> {
  const map = new Map<string, StoredLook>();
  try {
    const raw = window.localStorage.getItem(LOOKS_KEY);
    if (raw === null) return map;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return map;
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const record = value as { avatar?: unknown; shape?: unknown; color?: unknown };
      if (!isStoredAvatar(record.avatar)) continue;
      if (typeof record.shape !== "number" || typeof record.color !== "number") continue;
      map.set(id, { avatar: record.avatar, shape: record.shape, color: record.color });
    }
  } catch {
    // A corrupt row falls back to the contract avatar or the default ball.
  }
  return map;
}

function writeLooks(map: Map<string, StoredLook>): void {
  try {
    const record: Record<string, StoredLook> = {};
    for (const [id, look] of map) record[id] = look;
    window.localStorage.setItem(LOOKS_KEY, JSON.stringify(record));
  } catch {
    // The in-memory look still applies for this session.
  }
}

export type BotsOperationResult = {
  ok: boolean;
  /** Key of the affected UiBot on success (create/duplicate). */
  key?: number;
  errorCode?: string;
  /**
   * The failure text as it actually arrived.
   *
   * Electron's contextBridge keeps an Error's name and message. The preload
   * puts the stable host code in `name` (and `code` when the clone allows it)
   * so a dead host stays RUNTIME_UNAVAILABLE instead of being relabeled
   * INVALID_INPUT. The message is still shown beside the code.
   */
  errorMessage?: string;
};

/** Code and message of a service failure, best effort. */
function describeFailure(error: unknown): { errorCode: string; errorMessage: string } {
  if (error instanceof ServiceError) {
    return { errorCode: error.code, errorMessage: error.message };
  }
  return { errorCode: hostErrorCode(error), errorMessage: hostErrorMessage(error) };
}

export function useBots(defaultGroupKey: number) {
  const service = useService();
  const [bots, setBots] = useState<UiBot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const uiByBotId = useRef(new Map<string, UiFields>());
  const looks = useRef(readLooks());

  const baseFields = (bot: Bot): UiFields => {
    const stored = looks.current.get(bot.id);
    const contract = fromContractAvatar(bot.avatar);
    return {
      avatar: stored?.avatar ?? contract ?? defaultAvatarFor(bot.id),
      shape: stored?.shape ?? 0,
      color: stored?.color ?? 2,
      group: defaultGroupKey,
      unread: false,
    };
  };

  const toUi = useCallback((bot: Bot): UiBot => {
    const saved = uiByBotId.current.get(bot.id);
    const stored = looks.current.get(bot.id);
    const contract = fromContractAvatar(bot.avatar);
    const fields: UiFields = saved ?? {
      avatar: stored?.avatar ?? contract ?? defaultAvatarFor(bot.id),
      shape: stored?.shape ?? 0,
      color: stored?.color ?? 2,
      group: defaultGroupKey,
      unread: false,
    };
    return { key: nextKey.current++, bot, ...fields, hidden: false };
  }, [defaultGroupKey]);

  const remember = (bot: Bot, patch: Partial<UiFields>): void => {
    const saved = uiByBotId.current.get(bot.id) ?? baseFields(bot);
    const next = { ...saved, ...patch };
    uiByBotId.current.set(bot.id, next);
    if (patch.avatar !== undefined) {
      looks.current.set(bot.id, { avatar: next.avatar, shape: next.shape, color: next.color });
      writeLooks(looks.current);
    }
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
          ...describeFailure(error),
        };
      }
    },
    [service, defaultGroupKey, toUi],
  );

  const update = useCallback(
    async (botId: string, patch: BotUpdatePatch): Promise<BotsOperationResult> => {
      const target = bots.find((b) => b.bot.id === botId);
      if (!target) {
        return { ok: false, errorCode: "INVALID_INPUT", errorMessage: t("bots.botNotFound") };
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
          ...describeFailure(error),
        };
      }
    },
    [bots, service, refresh],
  );

  const archive = useCallback(
    async (botId: string): Promise<BotsOperationResult> => {
      const target = bots.find((b) => b.bot.id === botId);
      if (!target) {
        return { ok: false, errorCode: "INVALID_INPUT", errorMessage: t("bots.botNotFound") };
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
          ...describeFailure(error),
        };
      }
    },
    [bots, service, refresh],
  );

  const duplicate = useCallback(
    async (botId: string): Promise<BotsOperationResult> => {
      const target = bots.find((b) => b.bot.id === botId);
      if (!target) {
        return { ok: false, errorCode: "INVALID_INPUT", errorMessage: t("bots.botNotFound") };
      }
      try {
        const copy = await service.bots.duplicate(botId);
        remember(copy, {
          avatar: target.avatar,
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
          ...describeFailure(error),
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

  /**
   * G1': reorder the loaded list by a persisted id sequence (ui.state). Keys
   * stay stable; entries missing from the snapshot keep their relative order
   * at the end, so a stale snapshot can never drop a bot from the sidebar.
   */
  const applyPersistedOrder = useCallback((ids: readonly string[]): void => {
    setBots((prev) => {
      if (ids.length === 0 || prev.length === 0) {
        return prev;
      }
      const rank = new Map(ids.map((id, index) => [id, index]));
      return [...prev].sort(
        (a, b) =>
          (rank.get(a.bot.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.bot.id) ?? Number.MAX_SAFE_INTEGER),
      );
    });
  }, []);

  const hide = useCallback((botKey: number): void => {
    setBots((prev) => prev.filter((b) => b.key !== botKey));
  }, []);

  // Memoized identity: effects key on the `bots` reference. A fresh array
  // from this filter on each render used to restart those effects forever
  // (the old session sublist flashed on a real machine 2026-11-01).
  const visible = useMemo(() => bots.filter((b) => !b.hidden), [bots]);

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
    applyPersistedOrder,
    hide,
  };
}
