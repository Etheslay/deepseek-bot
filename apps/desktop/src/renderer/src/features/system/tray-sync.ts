/**
 * Tray state sync (D22).
 *
 * The renderer owns bot data (contract `Bot` list plus its own avatar/unread
 * state), so it is the only place that can describe what the tray should show.
 * This module turns that state into the validated `TraySyncPayload` main
 * consumes, rasterising each avatar through `tray-avatar` first.
 *
 * Everything is best-effort: no preload bridge (browser preview) or a rejected
 * sync must never break the UI, and the caps come from the shared payload module
 * so main and renderer agree on them.
 */
import {
  TRAY_MAX_BOTS,
  TRAY_NAME_MAX_LENGTH,
  type TrayBotEntry,
  type TrayBotStatus,
  type TraySyncPayload,
} from "../../../../shared/system-integration.js";
import type { Avatar } from "../avatars/avatar-meta.js";
import { rasterizeTrayIcon, trayAvatarSvg, type TrayIconColors } from "./tray-avatar.js";

export type TrayBotSource = {
  id: string;
  name: string;
  avatar: Avatar;
  unread: boolean;
  status: TrayBotStatus;
};

/** Pure half of the sync: icon map in, payload out (caps applied, order kept). */
export function buildTrayPayload(
  sources: readonly TrayBotSource[],
  activeBotId: string | null,
  icons: ReadonlyMap<string, string | null>,
): TraySyncPayload {
  const bots: TrayBotEntry[] = sources.slice(0, TRAY_MAX_BOTS).map((source) => ({
    id: source.id,
    name: source.name.slice(0, TRAY_NAME_MAX_LENGTH),
    status: source.status,
    unread: source.unread,
    icon: icons.get(source.id) ?? null,
  }));
  const active = bots.find((bot) => bot.id === activeBotId);
  return { activeBotId: active === undefined ? null : active.id, bots };
}

export function trayIconColors(theme: "dark" | "light"): TrayIconColors {
  return theme === "dark"
    ? { theme, mono: "#ececf1", eye: "#12131699" }
    : { theme, mono: "#1a1a1e", eye: "#f6f6f899" };
}

/**
 * Push the tray state. `rasterize` is injectable so unit tests (and the browser
 * evidence runs without a tray) can supply their own icon resolver.
 */
export async function syncTrayState(
  sources: readonly TrayBotSource[],
  activeBotId: string | null,
  options: {
    theme: "dark" | "light";
    rasterize?: (svg: string) => Promise<string | null>;
    bridge?: { system?: { tray?: { sync: (payload: TraySyncPayload) => Promise<void> } } } | null;
  },
): Promise<TraySyncPayload | null> {
  const rasterize = options.rasterize ?? rasterizeTrayIcon;
  const colors = trayIconColors(options.theme);
  const icons = new Map<string, string | null>();
  for (const source of sources.slice(0, TRAY_MAX_BOTS)) {
    icons.set(source.id, await rasterize(trayAvatarSvg(source.avatar, colors, statusToState(source.status))));
  }
  const payload = buildTrayPayload(sources, activeBotId, icons);
  const bridge = options.bridge ?? (typeof window === "undefined" ? null : window.deepseekBot);
  if (!bridge || !("system" in bridge) || !bridge.system?.tray) {
    return payload;
  }
  try {
    await bridge.system.tray.sync(payload);
  } catch {
    // A rejected sync is cosmetic only: the window still shows everything.
    return payload;
  }
  return payload;
}

/** A bot waiting on approval or mid-answer gets a matching face in the tray. */
export function statusToState(status: TrayBotStatus): "idle" | "thinking" | "waiting" {
  if (status === "waiting-approval") {
    return "waiting";
  }
  return status === "running" ? "thinking" : "idle";
}
