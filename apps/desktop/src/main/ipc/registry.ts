import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  assertAllowedChannel,
  assertValidTitleBarOverlayColors,
  type AppInfo,
} from "../../shared/ipc-channels.js";
import {
  assertAuthorizedSender,
  type SenderGuard,
} from "./guards.js";

export type IpcHandlers = {
  getAppInfo: () => AppInfo;
  showWindow: () => void;
  hideWindow: () => void;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  setTitleBarOverlay: (colors: { color: string; symbolColor: string }) => void;
  /** Forward one allowlisted contract method call to the Host process. */
  hostCall: (method: unknown, payload: unknown) => Promise<unknown>;
  /** Encrypt the API key with safeStorage and register the credential ref. */
  saveKey: (key: unknown) => Promise<{ configured: boolean }>;
};

/**
 * Registers only allowlisted invoke handlers.
 */
export function registerIpcHandlers(
  handlers: IpcHandlers,
  isAuthorized: SenderGuard,
): void {
  unregisterIpcHandlers();

  const wrap =
    <T>(channel: string, run: () => T): ((event: IpcMainInvokeEvent) => T) =>
    (event: IpcMainInvokeEvent) => {
      assertAllowedChannel(channel);
      assertAuthorizedSender(event, isAuthorized);
      return run();
    };

  ipcMain.handle(
    IPC_CHANNELS.APP_GET_INFO,
    wrap(IPC_CHANNELS.APP_GET_INFO, () => handlers.getAppInfo()),
  );
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SAVE_KEY,
    (event, key: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.SETTINGS_SAVE_KEY);
      assertAuthorizedSender(event, isAuthorized);
      return handlers.saveKey(key);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.WINDOW_SHOW,
    wrap(IPC_CHANNELS.WINDOW_SHOW, () => {
      handlers.showWindow();
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.WINDOW_HIDE,
    wrap(IPC_CHANNELS.WINDOW_HIDE, () => {
      handlers.hideWindow();
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MINIMIZE,
    wrap(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
      handlers.minimizeWindow();
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE,
    wrap(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
      handlers.toggleMaximizeWindow();
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.WINDOW_CLOSE,
    wrap(IPC_CHANNELS.WINDOW_CLOSE, () => {
      handlers.closeWindow();
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.WINDOW_SET_TITLEBAR_OVERLAY,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.WINDOW_SET_TITLEBAR_OVERLAY);
      assertAuthorizedSender(event, isAuthorized);
      assertValidTitleBarOverlayColors(payload);
      handlers.setTitleBarOverlay(payload);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.HOST_CALL,
    (event: IpcMainInvokeEvent, method: unknown, payload: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.HOST_CALL);
      assertAuthorizedSender(event, isAuthorized);
      return handlers.hostCall(method, payload);
    },
  );
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}


