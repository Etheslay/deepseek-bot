/**
 * Settings persistence (D24 renderer slice): the renderer keeps its own
 * preferences in localStorage — theme, account name, accent color, update
 * dismissal. Host-owned data (API key, bots) never passes through here.
 */
export type PersistedSettings = {
  theme: "dark" | "light";
  accountName: string;
  accent: string;
};

export const DEFAULT_SETTINGS: PersistedSettings = {
  theme: "dark",
  accountName: "本地用户",
  accent: "#6ea8ff",
};

const STORAGE_KEY = "deepseek-bot.settings.v1";

export function loadSettings(storage: Storage): PersistedSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      theme: parsed.theme === "light" ? "light" : "dark",
      accountName:
        typeof parsed.accountName === "string" && parsed.accountName.trim().length > 0
          ? parsed.accountName
          : DEFAULT_SETTINGS.accountName,
      accent: isValidHex(parsed.accent) ? parsed.accent : DEFAULT_SETTINGS.accent,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: Storage, settings: PersistedSettings): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode / quota: preferences stay session-only.
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function isValidHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export const ACCENT_PRESETS = [
  "#6ea8ff", // 蓝（默认）
  "#2dd4a7", // 青绿
  "#ec4899", // 粉
  "#f59e0b", // 琥珀
  "#a78bfa", // 紫
  "#94a3b8", // 石墨
] as const;
