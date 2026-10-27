/**
 * Tray menu model (D22 per-bot tray icon).
 *
 * Pure and Electron-free: the renderer pushes a validated `TraySyncPayload`
 * (bot list, active bot, unread flags, rasterised avatars) and the already
 * localized strings, and this module decides what the menu looks like. The main
 * process only maps rows onto `Menu.buildFromTemplate`, which keeps the
 * user-visible rules (ordering, active marker, status text, caps) unit-testable.
 */
import type { TrayBotEntry, TrayBotStatus, TraySyncPayload } from "../shared/system-integration.js";

export type TrayMenuAction =
  | { kind: "show" }
  | { kind: "hide" }
  | { kind: "settings" }
  | { kind: "quit" }
  | { kind: "bot"; botId: string };

export type TrayMenuRow =
  | { type: "separator" }
  | { type: "header"; label: string; enabled: false }
  | {
      type: "item";
      label: string;
      enabled: boolean;
      action: TrayMenuAction;
      icon: string | null;
      active: boolean;
    };

export type TrayStrings = {
  show: string;
  hide: string;
  settings: string;
  quit: string;
  noBots: string;
  botsHeader: (count: number) => string;
  status: Record<TrayBotStatus, string>;
  unreadMarker: (count: number) => string;
};

/** Bot rows first (active one on top), then the window commands. */
export function buildTrayMenu(state: TraySyncPayload, strings: TrayStrings): TrayMenuRow[] {
  const rows: TrayMenuRow[] = [];
  const bots = sortBots(state, strings);
  if (bots.length === 0) {
    rows.push({ type: "header", label: strings.noBots, enabled: false });
  } else {
    rows.push({
      type: "header",
      label: strings.botsHeader(bots.length),
      enabled: false,
    });
    for (const bot of bots) {
      rows.push({
        type: "item",
        label: botLabel(bot, strings),
        enabled: true,
        icon: bot.icon,
        active: bot.id === state.activeBotId,
        action: { kind: "bot", botId: bot.id },
      });
    }
  }
  rows.push({ type: "separator" });
  rows.push({ type: "item", label: strings.show, enabled: true, icon: null, active: false, action: { kind: "show" } });
  rows.push({ type: "item", label: strings.hide, enabled: true, icon: null, active: false, action: { kind: "hide" } });
  rows.push({
    type: "item",
    label: strings.settings,
    enabled: true,
    icon: null,
    active: false,
    action: { kind: "settings" },
  });
  rows.push({ type: "separator" });
  rows.push({ type: "item", label: strings.quit, enabled: true, icon: null, active: false, action: { kind: "quit" } });
  return rows;
}

export function botLabel(bot: TrayBotEntry, strings: TrayStrings): string {
  const status = strings.status[bot.status] ?? bot.status;
  const unread = bot.unread ? ` ${strings.unreadMarker(1)}` : "";
  return `${bot.name} · ${status}${unread}`;
}

/** Tooltip names the active bot, which is also the icon currently shown. */
export function trayTooltip(state: TraySyncPayload, appName: string, strings: TrayStrings): string {
  const active = state.bots.find((bot) => bot.id === state.activeBotId);
  if (active === undefined) {
    return appName;
  }
  const unreadCount = state.bots.filter((bot) => bot.unread).length;
  const parts = [appName, active.name, strings.status[active.status]];
  if (unreadCount > 0) {
    parts.push(strings.unreadMarker(unreadCount));
  }
  return parts.filter((part) => typeof part === "string" && part.length > 0).join(" — ");
}

/**
 * The tray icon is the active bot's avatar; the unread bot that the user has
 * not opened yet wins the top slot so the first click is always useful.
 */
function sortBots(state: TraySyncPayload, strings: TrayStrings): TrayBotEntry[] {
  const rank = (bot: TrayBotEntry): number => {
    if (bot.id === state.activeBotId) {
      return 0;
    }
    if (bot.status === "waiting-approval") {
      return 1;
    }
    if (bot.status === "running") {
      return 2;
    }
    return bot.unread ? 3 : 4;
  };
  return [...state.bots].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-CN") || strings.status[a.status].length,
  );
}

/** Which bot avatar the tray itself shows right now. */
export function trayIconFor(state: TraySyncPayload): string | null {
  const active = state.bots.find((bot) => bot.id === state.activeBotId);
  if (active !== undefined && active.icon !== null) {
    return active.icon;
  }
  const firstWithIcon = state.bots.find((bot) => bot.icon !== null);
  return firstWithIcon?.icon ?? null;
}
