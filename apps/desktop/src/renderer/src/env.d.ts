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
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
    onMissed: (listener: (notices: unknown[]) => void) => () => void;
  };
  /** D22: mirror the UI language into the main process (tray, notifications). */
  i18n: {
    setLanguage: (preference: LanguagePreference) => Promise<void>;
  };
};

declare global {
  interface Window {
    deepseekBot: DesktopBridge;
  }
}

