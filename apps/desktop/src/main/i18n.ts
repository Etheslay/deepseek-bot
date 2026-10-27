/**
 * Main-process i18n state (D22).
 *
 * The renderer owns the persisted preference; main keeps a mirror so the tray
 * menu and system notifications are built in the same language the UI uses.
 * Until the renderer syncs, main follows the desktop locale.
 */
import { resolveLanguage } from "../shared/i18n/locale.js";
import type { MessageKey } from "../shared/i18n/messages/index.js";
import { translate } from "../shared/i18n/translate.js";
import type { Language, LanguagePreference, TranslateParams } from "../shared/i18n/types.js";

let systemLocale = "";
let preference: LanguagePreference = "system";
let language: Language = resolveLanguage("system", "zh-CN");
const listeners = new Set<() => void>();

function recompute(): void {
  const next = resolveLanguage(preference, systemLocale);
  if (next === language) {
    return;
  }
  language = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Called once at startup with `app.getLocale()`. */
export function initMainLocale(locale: string): void {
  systemLocale = locale;
  recompute();
}

/** IPC entry point: renderer tells main which preference the user picked. */
export function setMainLanguagePreference(pref: LanguagePreference): void {
  preference = pref;
  recompute();
}

export function mainLanguage(): Language {
  return language;
}

export function tr(key: MessageKey, params: TranslateParams = []): string {
  return translate(language, key, params);
}

/** Rebuild the tray menu / re-issue native strings when the language flips. */
export function onMainLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
