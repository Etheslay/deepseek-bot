import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ServiceProvider } from "./services/service-context";
import { configureI18n } from "./i18n.js";
import { loadSettings } from "./features/settings/settings-store.js";
import "./styles.css";

const rootEl = document.getElementById("root");

/**
 * Language is settled before the first paint so the UI never flashes the wrong
 * locale: the persisted preference plus the desktop locale from main decide it.
 * In a plain browser (the headless evidence runs) there is no preload bridge, so
 * `navigator.language` stands in for the desktop locale.
 */
async function resolveSystemLocale(): Promise<string> {
  try {
    const info = await window.deepseekBot.getAppInfo();
    if (info.locale.length > 0) {
      return info.locale;
    }
  } catch {
    // Preload unavailable or failed — fall through to the browser locale.
  }
  return navigator.language;
}

async function boot(container: HTMLElement): Promise<void> {
  const settings = loadSettings(window.localStorage);
  const systemLocale = await resolveSystemLocale();
  configureI18n({ preference: settings.language, systemLocale });
  createRoot(container).render(
    <StrictMode>
      <ServiceProvider>
        <App />
      </ServiceProvider>
    </StrictMode>,
  );
}

if (!rootEl) {
  throw new Error("Root element #root not found");
}
void boot(rootEl);
