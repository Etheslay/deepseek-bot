export {};

type LanguagePreference = "system" | "zh" | "en";

type DesktopBridge = {
  getAppInfo: () => Promise<{
    name: string;
    version: string;
    platform: string;
    locale: string;
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
      | { ok: true; title: string; text: string }
      | { ok: false; code: "format" | "size" | "empty" | "encoding" | "cancelled" | "read" }
    >;
  };
  voice: {
    pickFile: (
      kind: "bin" | "model",
    ) => Promise<{ ok: true; path: string } | { ok: false; code: "cancelled" }>;
  };
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
    onMissed: (listener: (notices: unknown[]) => void) => () => void;
  };
  /** D22: mirror the UI language into the main process (tray, notifications). */
  i18n: {
    setLanguage: (preference: LanguagePreference) => Promise<void>;
  };
  /** D22: OS integration surface (tray state push, notifications, Chrome import). */
  system: {
    tray: { sync: (payload: unknown) => Promise<void> };
    notifications: { show: (request: unknown) => Promise<{ shown: boolean; reason: string | null }> };
    chrome: {
      scan: () => Promise<unknown>;
      preview: (token: string) => Promise<unknown>;
      import: (token: string) => Promise<unknown>;
      state: () => Promise<unknown>;
      clear: () => Promise<{ cleared: boolean }>;
      export: () => Promise<unknown>;
    };
    onTrayAction: (listener: (event: { kind: "bot"; botId: string } | { kind: "settings" }) => void) => () => void;
    onNotificationClick: (listener: (event: { botId: string | null }) => void) => () => void;
    onWindowFocus: (listener: (event: { focused: boolean }) => void) => () => void;
  };
};

declare global {
  interface Window {
    deepseekBot: DesktopBridge;
  }
}

