/** Allowlisted IPC invoke channels for the desktop shell. */
import type { LanguagePreference } from "./i18n/types.js";

export const IPC_CHANNELS = {
  APP_GET_INFO: "app:getInfo",
  WINDOW_SHOW: "window:show",
  WINDOW_HIDE: "window:hide",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggleMaximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_SET_TITLEBAR_OVERLAY: "window:set-titlebar-overlay",
  /** Open one chat-message link outside this window. The href was already classified. */
  SHELL_OPEN_LINK: "shell:openLink",
  /** Encrypt and persist the API key via safeStorage, then point the Host at it. */
  SETTINGS_SAVE_KEY: "settings:saveKey",
  /** Renderer → Host contract call (method allowlist enforced in main). */
  HOST_CALL: "host:call",
  /** Desktop file dialog for one .txt/.md knowledge note. No path argument. */
  KNOWLEDGE_IMPORT: "knowledge:import",
  ACCOUNT_AVATAR_PICK: "account:pickAvatar",
  /**
   * Desktop file dialog for one local whisper path (binary or model). The
   * only argument is the file kind — the renderer never sends a path.
   */
  VOICE_PICK_FILE: "voice:pickFile",
  /** D24: app-update checks via electron-updater against GitHub Releases. */
  UPDATES_CHECK: "updates:check",
  UPDATES_DOWNLOAD_INSTALL: "updates:downloadInstall",
  /**
   * D24: list existing backup summaries from the data root's
   * backups/ directory. Desktop-process channel (like knowledge/updates) —
   * the Host contract has no backup-listing method, and the main process
   * already owns the data root path. Read-only over manifest.json files.
   */
  BACKUPS_LIST: "backups:list",
  /** D24: query or toggle hardware acceleration (restart to apply). */
  APP_HARDWARE_ACCELERATION: "app:hardwareAcceleration",
  /** D22: mirror the persisted UI language into the main process. */
  I18N_SET_LANGUAGE: "i18n:setLanguage",
  /** D22: renderer pushes the per-bot tray state (bots, active bot, avatars). */
  TRAY_SYNC: "tray:sync",
  /** D22: renderer asks main to raise a system notification. */
  NOTIFICATION_SHOW: "notification:show",
  /** D22: scan Chrome profiles / preview / import / clear its bookmarks. */
  CHROME_SCAN: "chrome:scan",
  CHROME_PREVIEW: "chrome:preview",
  CHROME_IMPORT: "chrome:import",
  CHROME_STATE: "chrome:state",
  CHROME_CLEAR: "chrome:clear",
  CHROME_EXPORT: "chrome:export",
  /** Open a delivered office file with the system handler. Bytes, not a path. */
  FILE_OPEN: "file:open",
  /** Save a delivered office file through the system save dialog. */
  FILE_SAVE: "file:save",
} as const;

/** Main → renderer event channel for scheduler skip-and-notify notices (FR-08). */
export const HOST_EVENT_MISSED = "host:event:missed";

/** B6: Main → renderer event channel for live chat assistant segments. */
export const HOST_EVENT_CHAT_STREAM = "host:event:chat-stream";

/** D22 main → renderer: a tray menu entry was clicked. */
export const SYSTEM_EVENT_TRAY_ACTION = "system:event:tray-action";
/** D22 main → renderer: a system notification was clicked. */
export const SYSTEM_EVENT_NOTIFICATION_CLICK = "system:event:notification-click";
/** D22 main → renderer: native window focus changed (notification gating). */
export const SYSTEM_EVENT_WINDOW_FOCUS = "system:event:window-focus";

export type TrayActionEvent = { kind: "bot"; botId: string } | { kind: "settings" };
export type NotificationClickEvent = { botId: string | null };
export type WindowFocusEvent = { focused: boolean };

/**
 * Data root directory name, mirroring storage's layout constant. Duplicated
 * because the main process must not import @deepseek-bot/storage (its index
 * pulls node:sqlite, unavailable in Electron 38's Node 22).
 */
export const DATA_ROOT_DIR_NAME = "DeepSeekBot";

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ALLOWED_CHANNELS: ReadonlySet<string> = new Set(
  Object.values(IPC_CHANNELS),
);

export type AppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  /** Desktop locale reported by Electron, used for "跟随系统" (D22). */
  locale: string;
};

/** D24: update check result surfaced to the renderer. */
export type UpdateStatus = {
  /** A newer version exists on the release source. */
  available: boolean;
  /** Latest version string when available; current version otherwise. */
  version: string | null;
  /** True while the installer download is in flight. */
  downloading: boolean;
  /** Update installed on disk; renderer may prompt restart-to-install. */
  readyToInstall: boolean;
  /** Failure reason (network, no releases yet, signature…), if any. */
  error: string | null;
};

/**
 * D24 leftover: one existing backup, summarized from its manifest. Metadata
 * database only — artifact/version-snapshot files are not part of a backup
 * (documented boundary; SECURITY_DATA §5).
 */
export type BackupSummary = {
  /** Directory name under backups/; doubles as the data.restore id. */
  backupId: string;
  createdAt: string;
  schemaVersion: number;
  sizeBytes: number;
};

/** D24 leftover: hardware-acceleration shell preference (userData-scoped). */
export type HardwareAccelerationStatus = {
  /** The preference that will apply on the next launch. */
  enabled: boolean;
  /** True when this call changed the preference (restart to apply). */
  restartRequired: boolean;
};

export type IpcErrorCode = "UNKNOWN_CHANNEL" | "UNAUTHORIZED_SENDER" | "INVALID_PAYLOAD";

export type TitleBarOverlayColors = {
  color: string;
  symbolColor: string;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** 主题切换时渲染进程提交的窗口控制条颜色，进主进程前先收紧为两个合法 hex。 */
export function assertValidTitleBarOverlayColors(
  value: unknown,
): asserts value is TitleBarOverlayColors {
  if (
    typeof value !== "object" ||
    value === null ||
    !HEX_COLOR.test((value as TitleBarOverlayColors).color ?? "") ||
    !HEX_COLOR.test((value as TitleBarOverlayColors).symbolColor ?? "")
  ) {
    throw new IpcDeniedError(
      "INVALID_PAYLOAD",
      "titlebar overlay colors must be #rrggbb strings: { color, symbolColor }",
    );
  }
}

/**
 * D22: the language preference main will mirror for tray and notification
 * strings. Anything else is rejected before it reaches the main process.
 */
export function assertValidLanguagePreference(
  value: unknown,
): asserts value is LanguagePreference {
  if (value !== "system" && value !== "zh" && value !== "en") {
    throw new IpcDeniedError(
      "INVALID_PAYLOAD",
      "language preference must be one of: system, zh, en",
    );
  }
}

export class IpcDeniedError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = "IpcDeniedError";
    this.code = code;
  }
}

export function assertAllowedChannel(channel: string): asserts channel is IpcChannel {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new IpcDeniedError(
      "UNKNOWN_CHANNEL",
      `IPC channel is not registered: ${channel}`,
    );
  }
}

