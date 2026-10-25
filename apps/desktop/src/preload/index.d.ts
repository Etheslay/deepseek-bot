import type { DesktopBridge } from "./index.js";

declare global {
  interface Window {
    deepseekBot: DesktopBridge;
  }
}

export {};
