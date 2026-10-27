/**
 * OS integration payloads (D22): the per-bot tray, system notifications and the
 * Chrome bookmark import cross the IPC boundary, so every shape is validated in
 * the main process before it is trusted. No contract method changes here — these
 * are desktop-process channels only.
 */
import { IpcDeniedError } from "./ipc-channels.js";

/** Tray caps: the renderer may push at most this many bots / bytes per icon. */
export const TRAY_MAX_BOTS = 50;
export const TRAY_NAME_MAX_LENGTH = 60;
export const TRAY_ICON_MAX_BASE64_LENGTH = 64 * 1024;

export type TrayBotStatus = "idle" | "running" | "waiting-approval";

export type TrayBotEntry = {
  /** Contract bot id — the renderer owns it, main only echoes it back on click. */
  id: string;
  name: string;
  status: TrayBotStatus;
  unread: boolean;
  /** `data:image/png;base64,…` rasterised avatar, already size-capped. */
  icon: string | null;
};

export type TraySyncPayload = {
  activeBotId: string | null;
  bots: TrayBotEntry[];
};

const TRAY_STATUSES: readonly TrayBotStatus[] = ["idle", "running", "waiting-approval"];
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

function badRequest(detail: string): never {
  throw new IpcDeniedError("INVALID_PAYLOAD", detail);
}

/**
 * Strict validator + normalizer: anything odd (extra fields, oversized payloads,
 * non-PNG data URLs, wrong id types) is rejected before main touches it, and the
 * result is a fresh object so renderer-owned references never leak inside.
 */
export function assertValidTraySync(value: unknown): asserts value is TraySyncPayload {
  if (typeof value !== "object" || value === null) {
    badRequest("tray sync must be an object");
  }
  const source = value as Record<string, unknown>;
  if (source["activeBotId"] !== null && typeof source["activeBotId"] !== "string") {
    badRequest("tray activeBotId must be a string or null");
  }
  if (!Array.isArray(source["bots"])) {
    badRequest("tray bots must be an array");
  }
  const bots = source["bots"] as unknown[];
  if (bots.length > TRAY_MAX_BOTS) {
    badRequest(`tray bots exceeds the ${TRAY_MAX_BOTS} entry cap`);
  }
  for (const raw of bots) {
    if (typeof raw !== "object" || raw === null) {
      badRequest("tray bot entry must be an object");
    }
    const bot = raw as Record<string, unknown>;
    if (typeof bot["id"] !== "string" || bot["id"].length === 0 || bot["id"].length > 128) {
      badRequest("tray bot id must be a non-empty string");
    }
    if (
      typeof bot["name"] !== "string" ||
      bot["name"].length === 0 ||
      bot["name"].length > TRAY_NAME_MAX_LENGTH
    ) {
      badRequest(`tray bot name must be 1-${TRAY_NAME_MAX_LENGTH} characters`);
    }
    if (!TRAY_STATUSES.includes(bot["status"] as TrayBotStatus)) {
      badRequest("tray bot status must be idle, running or waiting-approval");
    }
    if (typeof bot["unread"] !== "boolean") {
      badRequest("tray bot unread must be a boolean");
    }
    if (bot["icon"] !== null) {
      if (typeof bot["icon"] !== "string") {
        badRequest("tray bot icon must be a data URL or null");
      }
      if ((bot["icon"] as string).length > TRAY_ICON_MAX_BASE64_LENGTH) {
        badRequest("tray bot icon exceeds the size cap");
      }
      if (!PNG_DATA_URL.test(bot["icon"] as string)) {
        badRequest("tray bot icon must be a base64 PNG data URL");
      }
    }
  }
}

export function normalizeTraySync(value: TraySyncPayload): TraySyncPayload {
  return {
    activeBotId: value.activeBotId,
    bots: value.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      status: bot.status,
      unread: bot.unread,
      icon: bot.icon,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * System notifications
 * ------------------------------------------------------------------ */

export type NotificationRequest = {
  /** Bot the notice belongs to; null for app-level notices. */
  botId: string | null;
  title: string;
  body: string;
  icon: string | null;
  /** Silence the platform sound (used for the test notification). */
  silent: boolean;
};

export const NOTIFICATION_TITLE_MAX_LENGTH = 120;
export const NOTIFICATION_BODY_MAX_LENGTH = 300;

export function assertValidNotificationRequest(
  value: unknown,
): asserts value is NotificationRequest {
  if (typeof value !== "object" || value === null) {
    badRequest("notification request must be an object");
  }
  const request = value as Record<string, unknown>;
  if (request["botId"] !== null && typeof request["botId"] !== "string") {
    badRequest("notification botId must be a string or null");
  }
  if (
    typeof request["title"] !== "string" ||
    request["title"].length === 0 ||
    request["title"].length > NOTIFICATION_TITLE_MAX_LENGTH
  ) {
    badRequest(`notification title must be 1-${NOTIFICATION_TITLE_MAX_LENGTH} characters`);
  }
  if (
    typeof request["body"] !== "string" ||
    request["body"].length > NOTIFICATION_BODY_MAX_LENGTH
  ) {
    badRequest(`notification body must be at most ${NOTIFICATION_BODY_MAX_LENGTH} characters`);
  }
  if (request["icon"] !== null && typeof request["icon"] !== "string") {
    badRequest("notification icon must be a data URL or null");
  }
  if (request["icon"] !== null && !PNG_DATA_URL.test(request["icon"] as string)) {
    badRequest("notification icon must be a base64 PNG data URL");
  }
  if (request["icon"] !== null && (request["icon"] as string).length > TRAY_ICON_MAX_BASE64_LENGTH) {
    badRequest("notification icon exceeds the size cap");
  }
  if (typeof request["silent"] !== "boolean") {
    badRequest("notification silent must be a boolean");
  }
}

export type NotificationOutcome = {
  shown: boolean;
  /** Machine-readable reason when nothing was raised. */
  reason: "unsupported" | "duplicate" | null;
};

/* ------------------------------------------------------------------ *
 * Chrome bookmark import (read-only, bookmarks only by design)
 * ------------------------------------------------------------------ */

export const CHROME_PREVIEW_MAX = 12;
export const CHROME_IMPORT_MAX = 5000;

export type ChromeProfileSummary = {
  /** Profile directory name under Chrome's User Data (e.g. "Default"). */
  directory: string;
  /** Human label from Chrome's Local State, falling back to the directory. */
  name: string;
  bookmarkCount: number;
  /** Absolute path is never sent to the renderer; only this token is. */
  token: string;
};

export type ChromeScanResult = {
  found: boolean;
  /** Chrome's User Data root, shown so the user knows what was read. */
  rootPath: string;
  profiles: ChromeProfileSummary[];
  error: string | null;
};

export type ChromeBookmarkItem = {
  name: string;
  url: string;
  folder: string;
};

export type ChromePreviewResult = {
  profile: ChromeProfileSummary | null;
  total: number;
  samples: ChromeBookmarkItem[];
  error: string | null;
};

export type ChromeExportResult = { filePath: string; items: number } | { error: string };
export type ChromeClearResult = { cleared: boolean };

export type ChromeImportResult = {
  imported: number;
  importedAt: string;
  profileName: string;
  /** Absolute path of the JSON written into the app data root. */
  filePath: string;
  error: string | null;
};

export type ChromeStateResult = {
  imported: number;
  importedAt: string | null;
  profileName: string | null;
  filePath: string | null;
  samples: ChromeBookmarkItem[];
};

/**
 * Chrome profile directories are plain names like `Default` or `Profile 1`, so
 * spaces are legal. Path separators and any `..` are rejected here and re-checked
 * when main resolves the path.
 */
const CHROME_TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;

export function assertValidChromeToken(value: unknown): asserts value is string {
  if (typeof value !== "string" || !CHROME_TOKEN.test(value) || value.includes("..")) {
    badRequest("chrome token must be a plain profile directory name");
  }
}
