/**
 * Per-bot tray controller (D22).
 *
 * One Tray icon (a second icon per bot would be folded away by Windows and
 * reads as clutter) that mirrors the active bot's avatar, and a menu listing
 * every bot with its own icon. The renderer owns the data — it rasterises each
 * Grok Ball avatar and pushes it through the validated `tray:sync` channel —
 * so main never reads the database and never re-renders React.
 *
 * Clicking a bot row shows the window and tells the renderer which bot to open;
 * a language change rebuilds the menu in place.
 */
import { Menu, Tray, nativeImage, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { SYSTEM_EVENT_TRAY_ACTION, type TrayActionEvent } from "../shared/ipc-channels.js";
import type { TraySyncPayload } from "../shared/system-integration.js";
import { buildTrayMenu, trayIconFor, trayTooltip, type TrayMenuAction } from "./tray-menu.js";
import { onMainLanguageChange, tr } from "./i18n.js";

export type TrayController = {
  /** Replace the tray state with the payload the renderer just pushed. */
  sync: (payload: TraySyncPayload) => void;
  /** Clear the pushed state (e.g. every bot archived) back to the app icon. */
  reset: () => void;
  destroy: () => void;
};

export function createTrayController(deps: {
  getWindow: () => BrowserWindow | null;
  quit: () => void;
  appName: string;
  /** Fallback icon used before the renderer pushes any bot avatar. */
  defaultIcon: () => Electron.NativeImage;
  send: (event: TrayActionEvent) => void;
}): TrayController {
  const tray = new Tray(deps.defaultIcon());
  let state: TraySyncPayload | null = null;
  let disposed = false;
  /**
   * Serialised form of the last payload actually applied. The renderer pushes a
   * sync whenever any of its tray inputs change identity, which happens far more
   * often than the tray's contents change - each push rebuilt the whole menu,
   * re-set the icon and the tooltip, and (when the shell had refused the icon in
   * the first place) logged two warnings per push, about once a second. Equal
   * payloads are now dropped instead.
   */
  let appliedKey: string | null = null;

  const strings = () => ({
    show: tr("d22.trayShow"),
    hide: tr("d22.trayHide"),
    settings: tr("d22.traySettings"),
    quit: tr("d22.trayQuit"),
    noBots: tr("d22.trayNoBots"),
    botsHeader: (count: number) => tr("d22.trayBotsHeader", [count]),
    status: {
      idle: tr("d22.trayIdle"),
      running: tr("d22.trayRunning"),
      "waiting-approval": tr("d22.trayWaitingApproval"),
    } as const,
    unreadMarker: (count: number) => tr("d22.trayUnread", [count]),
  });

  const iconFromDataUrl = (dataUrl: string | null): Electron.NativeImage | null => {
    if (dataUrl === null) {
      return null;
    }
    const image = nativeImage.createFromDataURL(dataUrl);
    return image.isEmpty() ? null : image;
  };

  const apply = (force = false): void => {
    if (disposed) {
      return;
    }
    const next = state ?? { activeBotId: null, bots: [] };
    const key = JSON.stringify(next);
    if (!force && key === appliedKey) {
      return;
    }
    appliedKey = key;
    const rows = buildTrayMenu(next, strings());
    const template: MenuItemConstructorOptions[] = rows.map((row) => {
      if (row.type === "separator") {
        return { type: "separator" as const };
      }
      if (row.type === "header") {
        return { label: row.label, enabled: false };
      }
      const action = row.action;
      const image = iconFromDataUrl(row.icon);
      return {
        label: row.label,
        enabled: row.enabled,
        // exactOptionalPropertyTypes: omit the icon instead of passing undefined.
        ...(image !== null ? { icon: image } : {}),
        click: () => handle(action),
      };
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));

    const icon = state === null ? null : trayIconFor(state);
    const image = iconFromDataUrl(icon);
    tray.setImage(image ?? deps.defaultIcon());
    tray.setToolTip(trayTooltip(next, deps.appName, strings()));
  };

  const handle = (action: TrayMenuAction): void => {
    switch (action.kind) {
      case "show": {
        const win = deps.getWindow();
        win?.show();
        win?.focus();
        return;
      }
      case "hide": {
        deps.getWindow()?.hide();
        return;
      }
      case "quit": {
        deps.quit();
        return;
      }
      case "settings": {
        const win = deps.getWindow();
        win?.show();
        win?.focus();
        deps.send({ kind: "settings" });
        return;
      }
      case "bot": {
        const win = deps.getWindow();
        win?.show();
        win?.focus();
        deps.send({ kind: "bot", botId: action.botId });
        return;
      }
    }
  };

  tray.on("double-click", () => {
    const win = deps.getWindow();
    win?.show();
    win?.focus();
  });

  // A language change rewrites every label while the payload is unchanged, so
  // it has to bypass the dedupe below.
  const offLanguageChange = onMainLanguageChange(() => apply(true));
  apply();

  return {
    sync: (payload: TraySyncPayload) => {
      state = payload;
      apply();
    },
    reset: () => {
      state = null;
      apply();
    },
    destroy: () => {
      disposed = true;
      offLanguageChange();
      tray.destroy();
    },
  };
}

/** Sends a tray action to the renderer of a live window. */
export function sendTrayAction(win: BrowserWindow | null, event: TrayActionEvent): void {
  if (win !== null && !win.isDestroyed()) {
    win.webContents.send(SYSTEM_EVENT_TRAY_ACTION, event);
  }
}
