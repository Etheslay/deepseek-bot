/** Allowlisted IPC invoke channels for the desktop shell. */
export const IPC_CHANNELS = {
  APP_GET_INFO: "app:getInfo",
  WINDOW_SHOW: "window:show",
  WINDOW_HIDE: "window:hide",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggleMaximize",
  WINDOW_CLOSE: "window:close",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ALLOWED_CHANNELS: ReadonlySet<string> = new Set(
  Object.values(IPC_CHANNELS),
);

export type AppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
};

export type IpcErrorCode = "UNKNOWN_CHANNEL" | "UNAUTHORIZED_SENDER";

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
