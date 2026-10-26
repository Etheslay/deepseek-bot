export {};

type DesktopBridge = {
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
  settings: {
    saveKey: (key: string) => Promise<{ configured: boolean }>;
  };
  updates: {
    check: () => Promise<{
      available: boolean;
      version: string | null;
      downloading: boolean;
      readyToInstall: boolean;
      error: string | null;
    }>;
    downloadInstall: () => Promise<{
      available: boolean;
      version: string | null;
      downloading: boolean;
      readyToInstall: boolean;
      error: string | null;
    }>;
  };
  knowledge: {
    importFile: () => Promise<
      { ok: true; text: string } | { ok: false; code: "format" | "size" | "empty" | "encoding" | "cancelled" | "read" }
    >;
  };
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    deepseekBot: DesktopBridge;
  }
}

