import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  HOST_EVENT_CHAT_STREAM,
  HOST_EVENT_MISSED,
  IPC_CHANNELS,
  SYSTEM_EVENT_NOTIFICATION_CLICK,
  SYSTEM_EVENT_TRAY_ACTION,
  SYSTEM_EVENT_WINDOW_FOCUS,
  type NotificationClickEvent,
  type TrayActionEvent,
  type WindowFocusEvent,
} from "../shared/ipc-channels.js";
import type { LanguagePreference } from "../shared/i18n/types.js";
import type {
  ChromeClearResult,
  ChromeExportResult,
  ChromeImportResult,
  ChromePreviewResult,
  ChromeScanResult,
  ChromeStateResult,
  NotificationOutcome,
  NotificationRequest,
  TraySyncPayload,
} from "../shared/system-integration.js";

export type HostMissedNotice = {
  scheduleId: string;
  workflowId: string;
  occurrenceUtc: string;
  reason: string;
};

/**
 * B6: one live assistant segment of a running chat turn (the `chat.stream`
 * host notification, forwarded over HOST_EVENT_CHAT_STREAM). The pinned
 * harness settles a whole assistant message per model attempt, so a segment
 * is a full message text, not a token delta.
 */
export type HostChatStreamNotice = {
  botId: string;
  sessionId: string;
  text: string;
};

export type HostCallErrorShape = {
  code: string;
  message: string;
  retryable: boolean;
};

/** Main → renderer subscription with a stable unsubscribe handle. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export type DesktopBridge = {
  getAppInfo: () => Promise<{
    name: string;
    version: string;
    platform: string;
  }>;
  window: {
    show: () => Promise<void>;
    hide: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    setTitleBarOverlay: (colors: { color: string; symbolColor: string }) => Promise<void>;
  };
  /**
   * CONTRACTS §3 method surface, forwarded to the Host process. The method
   * allowlist and payload schemas are enforced in the main process and the
   * Host; failures reject with { code, message, retryable }.
   */
  /** Settings helpers that must stay in the main process (safeStorage). */
  settings: {
    saveKey: (key: string) => Promise<{ configured: boolean }>;
  };
  /** D24: app updates against GitHub Releases (electron-updater). */
  updates: {
    check: () => Promise<import("../shared/ipc-channels.js").UpdateStatus>;
    downloadInstall: () => Promise<import("../shared/ipc-channels.js").UpdateStatus>;
  };
  knowledge: {
    importFile: () => Promise<import("../shared/knowledge-import.js").KnowledgeImportResult>;
  };
  /** D24 leftover: backup summaries and the hardware-acceleration shell pref. */
  backups: {
    list: () => Promise<import("../shared/ipc-channels.js").BackupSummary[]>;
  };
  app: {
    hardwareAcceleration: (
      enabled?: boolean,
    ) => Promise<import("../shared/ipc-channels.js").HardwareAccelerationStatus>;
  };
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
    /** Scheduler skip-and-notify notices (FR-08); returns an unsubscribe. */
    onMissed: (listener: (notices: HostMissedNotice[]) => void) => () => void;
    /** B6: live assistant segments of a running chat turn; returns an unsubscribe. */
    onChatStream: (listener: (notice: HostChatStreamNotice) => void) => () => void;
  };
  /** D22: mirror the UI language into main so tray/notification strings match. */
  i18n: {
    setLanguage: (preference: LanguagePreference) => Promise<void>;
  };
  /**
   * D22 OS integration. Everything here is desktop-process only: the tray state
   * is pushed by the renderer (it owns bot data and avatars), notifications are
   * raised by main, and Chrome bookmark import never leaves this machine.
   */
  system: {
    tray: {
      sync: (payload: TraySyncPayload) => Promise<void>;
    };
    notifications: {
      show: (request: NotificationRequest) => Promise<NotificationOutcome>;
    };
    chrome: {
      scan: () => Promise<ChromeScanResult>;
      preview: (token: string) => Promise<ChromePreviewResult>;
      import: (token: string) => Promise<ChromeImportResult>;
      state: () => Promise<ChromeStateResult>;
      clear: () => Promise<ChromeClearResult>;
      export: () => Promise<ChromeExportResult>;
    };
    /** Main → renderer events; each returns an unsubscribe function. */
    onTrayAction: (listener: (event: TrayActionEvent) => void) => () => void;
    onNotificationClick: (listener: (event: NotificationClickEvent) => void) => () => void;
    onWindowFocus: (listener: (event: WindowFocusEvent) => void) => () => void;
  };
};

const api: DesktopBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  window: {
    show: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SHOW),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_HIDE),
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    setTitleBarOverlay: (colors) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_TITLEBAR_OVERLAY, colors),
  },
  settings: {
    saveKey: (key) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE_KEY, key),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_CHECK),
    downloadInstall: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL),
  },
  knowledge: {
    importFile: () => ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_IMPORT),
  },
  backups: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUPS_LIST),
  },
  app: {
    hardwareAcceleration: (enabled?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_HARDWARE_ACCELERATION, enabled),
  },
  host: {
    /**
     * Humanized errors: the channel resolves an envelope ({ok, result|error})
     * instead of throwing, so failures keep the Host's own message and stable
     * code without Electron's "Error invoking remote method …" wrapping.
     */
    call: async (method, payload) => {
      const outcome = (await ipcRenderer.invoke(IPC_CHANNELS.HOST_CALL, method, payload)) as
        | { ok: true; result: unknown }
        | {
            ok: false;
            error: { code: string; message: string; retryable: boolean };
          };
      if (outcome.ok) {
        return outcome.result;
      }
      // contextBridge clones thrown errors down to name/message/stack, so a
      // custom `.code` never reaches the renderer and every failure was
      // labeled INVALID_INPUT. `name` is part of the clone.
      const failure = new Error(outcome.error.message);
      failure.name = outcome.error.code;
      throw Object.assign(failure, {
        code: outcome.error.code,
        retryable: outcome.error.retryable,
      });
    },
    onMissed: (listener) => {
      const handler = (_event: IpcRendererEvent, notices: HostMissedNotice[]): void =>
        listener(notices);
      ipcRenderer.on(HOST_EVENT_MISSED, handler);
      return () => ipcRenderer.removeListener(HOST_EVENT_MISSED, handler);
    },
    onChatStream: (listener) => {
      const handler = (_event: IpcRendererEvent, notice: HostChatStreamNotice): void =>
        listener(notice);
      ipcRenderer.on(HOST_EVENT_CHAT_STREAM, handler);
      return () => ipcRenderer.removeListener(HOST_EVENT_CHAT_STREAM, handler);
    },
  },
  i18n: {
    setLanguage: (preference) =>
      ipcRenderer.invoke(IPC_CHANNELS.I18N_SET_LANGUAGE, preference),
  },
  system: {
    tray: {
      sync: (payload) => ipcRenderer.invoke(IPC_CHANNELS.TRAY_SYNC, payload),
    },
    notifications: {
      show: (request) => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SHOW, request),
    },
    chrome: {
      scan: () => ipcRenderer.invoke(IPC_CHANNELS.CHROME_SCAN),
      preview: (token) => ipcRenderer.invoke(IPC_CHANNELS.CHROME_PREVIEW, token),
      import: (token) => ipcRenderer.invoke(IPC_CHANNELS.CHROME_IMPORT, token),
      state: () => ipcRenderer.invoke(IPC_CHANNELS.CHROME_STATE),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.CHROME_CLEAR),
      export: () => ipcRenderer.invoke(IPC_CHANNELS.CHROME_EXPORT),
    },
    onTrayAction: (listener) => subscribe<TrayActionEvent>(SYSTEM_EVENT_TRAY_ACTION, listener),
    onNotificationClick: (listener) =>
      subscribe<NotificationClickEvent>(SYSTEM_EVENT_NOTIFICATION_CLICK, listener),
    onWindowFocus: (listener) => subscribe<WindowFocusEvent>(SYSTEM_EVENT_WINDOW_FOCUS, listener),
  },
};

contextBridge.exposeInMainWorld("deepseekBot", api);

