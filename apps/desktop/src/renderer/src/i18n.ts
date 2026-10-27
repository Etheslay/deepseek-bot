/**
 * Renderer i18n runtime (D22 bilingual).
 *
 * A module-level store rather than a React context so *any* module — services,
 * reducers, plain helpers — can call `t()` without prop drilling. The React
 * binding (`useLanguage`) is a `useSyncExternalStore` subscription: App.tsx
 * subscribes at the root, so a language switch re-renders the tree the same way
 * a theme switch does. Memoised leaves that render copy take an explicit
 * `lang` prop (see ChatMarkdown).
 *
 * The resolved preference is also pushed to the main process so the tray menu
 * and system notifications speak the same language.
 */
import { useSyncExternalStore } from "react";
import { localeTag, resolveLanguage } from "../../shared/i18n/locale.js";
import type { MessageKey } from "../../shared/i18n/messages/index.js";
import { translate } from "../../shared/i18n/translate.js";
import type { Language, LanguagePreference, TranslateParams } from "../../shared/i18n/types.js";

/** Re-exported so feature files import `MessageKey` next to `t` (D22). */
export type { MessageKey } from "../../shared/i18n/messages/index.js";

/** First-release default when the desktop locale is still unknown. */
const FALLBACK_LANGUAGE: Language = "zh";

let preference: LanguagePreference = "system";
let systemLocale = "";
let language: Language = FALLBACK_LANGUAGE;
const listeners = new Set<() => void>();

function currentLanguageValue(): Language {
  return language;
}

function recompute(): void {
  const next =
    systemLocale.length > 0
      ? resolveLanguage(preference, systemLocale)
      : preference === "system"
        ? FALLBACK_LANGUAGE
        : preference;
  if (next === language) {
    return;
  }
  language = next;
  for (const listener of listeners) {
    listener();
  }
}

function pushPreferenceToMain(pref: LanguagePreference): void {
  const bridge = window.deepseekBot;
  if (!bridge || !("i18n" in bridge)) {
    // Browser preview (headless evidence runs) and unit tests have no main process.
    return;
  }
  void bridge.i18n.setLanguage(pref).catch(() => undefined);
}

/** Called on boot with the persisted preference and `app.getLocale()`. */
export function configureI18n(input: {
  preference: LanguagePreference;
  systemLocale?: string;
}): void {
  preference = input.preference;
  if (input.systemLocale !== undefined && input.systemLocale.length > 0) {
    systemLocale = input.systemLocale;
  }
  recompute();
  pushPreferenceToMain(preference);
}

export function setLanguagePreference(pref: LanguagePreference): void {
  preference = pref;
  recompute();
  pushPreferenceToMain(pref);
}

export function languagePreference(): LanguagePreference {
  return preference;
}

export function currentLanguage(): Language {
  return language;
}

/**
 * A stored notice is a message key, never rendered text: a translated string kept
 * in state would still show the previous language after a switch (D22).
 */
export type Notice = {
  readonly key: MessageKey;
  readonly params?: TranslateParams;
};

export function noticeText(notice: Notice): string {
  return t(notice.key, notice.params ?? []);
}

export function t(key: MessageKey, params: TranslateParams = []): string {
  return translate(language, key, params);
}

/** Subscribe to language changes (root components re-render on switch). */
export function useLanguage(): Language {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    currentLanguageValue,
    currentLanguageValue,
  );
}

/* ------------------------------------------------------------------ *
 * Locale-aware formatting: dates, times and numbers go through Intl
 * with the active language instead of hand-rolled "今天 / 周一" strings.
 * ------------------------------------------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const tag = localeTag(language);
  const cacheKey = `${tag}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const next = new Intl.DateTimeFormat(tag, options);
  formatterCache.set(cacheKey, next);
  return next;
}

/** Anything the app stores timestamps as: epoch ms, Date or ISO string. */
export type DateInput = Date | number | string;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatTime(value: DateInput): string {
  return formatter({ hour: "2-digit", minute: "2-digit", hour12: false }).format(toDate(value));
}

export function formatDate(value: DateInput): string {
  return formatter({ month: "short", day: "numeric", weekday: "short" }).format(toDate(value));
}

export function formatDateTime(value: DateInput): string {
  return formatter({
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

export function formatFullDateTime(value: DateInput): string {
  return formatter({
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(localeTag(language)).format(value);
}
