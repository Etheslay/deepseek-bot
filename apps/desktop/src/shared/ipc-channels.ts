/** Allowlisted IPC invoke channels for the desktop shell. */
export const IPC_CHANNELS = {
  APP_GET_INFO: "app:getInfo",
  WINDOW_SHOW: "window:show",
  WINDOW_HIDE: "window:hide",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggleMaximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_SET_TITLEBAR_OVERLAY: "window:set-titlebar-overlay",
  /** Encrypt and persist the API key via safeStorage, then point the Host at it. */
  SETTINGS_SAVE_KEY: "settings:saveKey",
  /** Renderer → Host contract call (method allowlist enforced in main). */
  HOST_CALL: "host:call",
} as const;

/** Main → renderer event channel for scheduler skip-and-notify notices (FR-08). */
export const HOST_EVENT_MISSED = "host:event:missed";

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

