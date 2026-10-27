/**
 * Language resolution (D22 bilingual). Pure helpers shared by main and
 * renderer so "跟随系统" means exactly the same thing on both sides.
 */
import type { Language, LanguagePreference } from "./types.js";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["zh", "en"];
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ["system", "zh", "en"];

/** BCP 47 tags used for Intl formatting (dates, times, weekdays, numbers). */
const LOCALE_TAG: Record<Language, string> = {
  zh: "zh-CN",
  en: "en-US",
};

export function isLanguage(value: unknown): value is Language {
  return value === "zh" || value === "en";
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "zh" || value === "en";
}

/**
 * Any locale whose primary subtag is `zh` renders Chinese; everything else
 * falls back to English. Empty/unknown input is treated as English so a
 * misreported locale never leaves the UI in a half-translated state.
 */
export function languageFromLocale(locale: string): Language {
  return /^zh(-|$)/i.test(locale.trim()) ? "zh" : "en";
}

export function resolveLanguage(
  preference: LanguagePreference,
  systemLocale: string,
): Language {
  if (preference === "zh" || preference === "en") {
    return preference;
  }
  return languageFromLocale(systemLocale);
}

export function localeTag(lang: Language): string {
  return LOCALE_TAG[lang];
}
