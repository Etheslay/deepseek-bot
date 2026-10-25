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
  host: {
    call: (method: string, payload: unknown) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    deepseekBot: DesktopBridge;
  }
}

