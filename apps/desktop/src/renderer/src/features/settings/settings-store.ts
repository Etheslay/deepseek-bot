/**
 * Settings persistence (D24 renderer slice, extended by D22): the renderer keeps
 * its own preferences in localStorage — theme, account name, accent color,
 * language and notification choices. Host-owned data (API key, bots) never
 * passes through here.
 *
 * D22 adds `deepseek-bot.settings.v2`: `language` (bilingual) and
 * `notifications` (system notification settings). v1 payloads are migrated on
 * read — the v1 default account name becomes the "not set" sentinel so an
 * English UI no longer shows a Chinese leftover.
 */
import { isLanguagePreference } from "../../../../shared/i18n/locale.js";
import type { LanguagePreference } from "../../../../shared/i18n/types.js";

export type NotificationPrefs = {
  /** Master switch for OS notifications. */
  enabled: boolean;
  /** Suppress notifications while the window is in the foreground. */
  onlyWhenUnfocused: boolean;
  /** Bot ids the user muted; these never raise a notification. */
  mutedBotIds: string[];
};

export type PersistedSettings = {
  theme: "dark" | "light";
  /** "" means "not set" — the UI shows the localized default name instead. */
  accountName: string;
  accent: string;
  language: LanguagePreference;
  notifications: NotificationPrefs;
};

/** Account name used when the user never set one (localized, never stored). */
export const UNSET_ACCOUNT_NAME = "";

export const DEFAULT_SETTINGS: PersistedSettings = {
  theme: "dark",
  accountName: UNSET_ACCOUNT_NAME,
  accent: "#6ea8ff",
  language: "system",
  notifications: { enabled: true, onlyWhenUnfocused: true, mutedBotIds: [] },
};

/** v1 wrote this literal default; migration turns it back into "not set". */
// i18n-ignore: migration sentinel — it must match the literal v1 stored value
const V1_DEFAULT_ACCOUNT_NAME = "本地用户";

const STORAGE_KEY = "deepseek-bot.settings.v2";
const LEGACY_STORAGE_KEY = "deepseek-bot.settings.v1";

/** Muted-bot list is capped so a stray payload cannot grow the store forever. */
export const MAX_MUTED_BOTS = 200;

function withDefaults(parsed: Partial<PersistedSettings>): PersistedSettings {
  const accountName =
    typeof parsed.accountName === "string" &&
    parsed.accountName.trim().length > 0 &&
    parsed.accountName !== V1_DEFAULT_ACCOUNT_NAME
      ? parsed.accountName
      : UNSET_ACCOUNT_NAME;
  return {
    theme: parsed.theme === "light" ? "light" : "dark",
    accountName,
    accent: isValidHex(parsed.accent) ? parsed.accent : DEFAULT_SETTINGS.accent,
    language: isLanguagePreference(parsed.language) ? parsed.language : DEFAULT_SETTINGS.language,
    notifications: normalizeNotifications(parsed.notifications),
  };
}

function readRaw(storage: Storage): string | null {
  const current = storage.getItem(STORAGE_KEY);
  if (current !== null) {
    return current;
  }
  return storage.getItem(LEGACY_STORAGE_KEY);
}

export function loadSettings(storage: Storage): PersistedSettings {
  try {
    const raw = readRaw(storage);
    if (raw === null) {
      return withDefaults({});
    }
    return withDefaults(JSON.parse(raw) as Partial<PersistedSettings>);
  } catch {
    return withDefaults({});
  }
}

function normalizeNotifications(value: unknown): NotificationPrefs {
  const fallback = { ...DEFAULT_SETTINGS.notifications };
  if (typeof value !== "object" || value === null) {
    return { ...fallback, mutedBotIds: [] };
  }
  const source = value as Partial<NotificationPrefs>;
  const muted = Array.isArray(source.mutedBotIds)
    ? [
        ...new Set(
          source.mutedBotIds
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id) => id.trim()),
        ),
      ].slice(0, MAX_MUTED_BOTS)
    : [];
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    onlyWhenUnfocused:
      typeof source.onlyWhenUnfocused === "boolean" ? source.onlyWhenUnfocused : fallback.onlyWhenUnfocused,
    mutedBotIds: muted,
  };
}

export function saveSettings(storage: Storage, settings: PersistedSettings): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // The v2 key is now authoritative; keeping the v1 copy around would let
    // stale preferences win if v2 were ever cleared by hand.
    if (storage.getItem(LEGACY_STORAGE_KEY) !== null) {
      storage.removeItem(LEGACY_STORAGE_KEY);
    }
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
