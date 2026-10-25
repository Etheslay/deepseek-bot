import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";

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
};

contextBridge.exposeInMainWorld("deepseekBot", api);
