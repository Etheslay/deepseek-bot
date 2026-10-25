import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { HOST_EVENT_MISSED, IPC_CHANNELS } from "../shared/ipc-channels.js";

export type HostMissedNotice = {
  scheduleId: string;
  workflowId: string;
  occurrenceUtc: string;
  reason: string;
};

export type HostCallErrorShape = {
  code: string;
  message: string;
  retryable: boolean;
};

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
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
    /** Scheduler skip-and-notify notices (FR-08); returns an unsubscribe. */
    onMissed: (listener: (notices: HostMissedNotice[]) => void) => () => void;
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
  host: {
    call: (method, payload) => ipcRenderer.invoke(IPC_CHANNELS.HOST_CALL, method, payload),
    onMissed: (listener) => {
      const handler = (_event: IpcRendererEvent, notices: HostMissedNotice[]): void =>
        listener(notices);
      ipcRenderer.on(HOST_EVENT_MISSED, handler);
      return () => ipcRenderer.removeListener(HOST_EVENT_MISSED, handler);
    },
  },
};

contextBridge.exposeInMainWorld("deepseekBot", api);
