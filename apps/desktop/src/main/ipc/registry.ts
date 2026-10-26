import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  assertAllowedChannel,
  assertValidLanguagePreference,
  assertValidTitleBarOverlayColors,
  type AppInfo,
  type UpdateStatus,
} from "../../shared/ipc-channels.js";
import type { LanguagePreference } from "../../shared/i18n/types.js";
import {
  assertValidChromeToken,
  assertValidNotificationRequest,
  assertValidTraySync,
  normalizeTraySync,
  type ChromeClearResult,
  type ChromeExportResult,
  type ChromeImportResult,
  type ChromePreviewResult,
  type ChromeScanResult,
  type ChromeStateResult,
  type NotificationRequest,
  type TraySyncPayload,
} from "../../shared/system-integration.js";
import type { NotificationOutcome } from "../notifications.js";
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
  /** D24: check GitHub Releases for a newer version. */
  checkUpdates: () => Promise<UpdateStatus>;
  /** D24: download the update and restart into the installer. */
  downloadAndInstallUpdate: () => Promise<UpdateStatus>;
  /** D22: mirror the UI language preference so tray/notifications match. */
  setLanguage: (preference: LanguagePreference) => void;
  /** D22: replace the per-bot tray state (validated + normalized in main). */
  traySync: (payload: TraySyncPayload) => void;
  /** D22: raise one system notification and report what happened. */
  showNotification: (request: NotificationRequest) => NotificationOutcome;
  /** D22: Chrome bookmark import surface (read-only). */
  chromeScan: () => ChromeScanResult;
  chromePreview: (token: string) => ChromePreviewResult;
  chromeImport: (token: string) => ChromeImportResult;
  chromeState: () => ChromeStateResult;
  chromeClear: () => ChromeClearResult;
  chromeExport: () => ChromeExportResult;
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
  ipcMain.handle(
    IPC_CHANNELS.UPDATES_CHECK,
    wrap(IPC_CHANNELS.UPDATES_CHECK, () => handlers.checkUpdates()),
  );
  ipcMain.handle(
    IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL,
    wrap(IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL, () =>
      handlers.downloadAndInstallUpdate(),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.I18N_SET_LANGUAGE,
    (event: IpcMainInvokeEvent, preference: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.I18N_SET_LANGUAGE);
      assertAuthorizedSender(event, isAuthorized);
      assertValidLanguagePreference(preference);
      handlers.setLanguage(preference);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.TRAY_SYNC,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.TRAY_SYNC);
      assertAuthorizedSender(event, isAuthorized);
      assertValidTraySync(payload);
      handlers.traySync(normalizeTraySync(payload));
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.NOTIFICATION_SHOW,
    (event: IpcMainInvokeEvent, request: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.NOTIFICATION_SHOW);
      assertAuthorizedSender(event, isAuthorized);
      assertValidNotificationRequest(request);
      return handlers.showNotification(request);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.CHROME_SCAN,
    wrap(IPC_CHANNELS.CHROME_SCAN, () => handlers.chromeScan()),
  );
  ipcMain.handle(
    IPC_CHANNELS.CHROME_PREVIEW,
    (event: IpcMainInvokeEvent, token: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.CHROME_PREVIEW);
      assertAuthorizedSender(event, isAuthorized);
      assertValidChromeToken(token);
      return handlers.chromePreview(token);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.CHROME_IMPORT,
    (event: IpcMainInvokeEvent, token: unknown) => {
      assertAllowedChannel(IPC_CHANNELS.CHROME_IMPORT);
      assertAuthorizedSender(event, isAuthorized);
      assertValidChromeToken(token);
      return handlers.chromeImport(token);
    },
  );
  ipcMain.handle(IPC_CHANNELS.CHROME_STATE, wrap(IPC_CHANNELS.CHROME_STATE, () => handlers.chromeState()));
  ipcMain.handle(IPC_CHANNELS.CHROME_CLEAR, wrap(IPC_CHANNELS.CHROME_CLEAR, () => handlers.chromeClear()));
  ipcMain.handle(IPC_CHANNELS.CHROME_EXPORT, wrap(IPC_CHANNELS.CHROME_EXPORT, () => handlers.chromeExport()));
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}


