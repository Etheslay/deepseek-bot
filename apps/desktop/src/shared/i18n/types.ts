/**
 * i18n value types shared by the renderer, the main process and the message
 * catalogues (D22). Kept dependency-free: no React, no DOM, no Electron.
 */

/** UI languages shipped by the product. Anything else resolves to English. */
export type Language = "zh" | "en";

/** User-facing choice; `system` follows the desktop locale reported by main. */
export type LanguagePreference = "system" | Language;

/**
 * English text is either a plain string or a two-form count pattern. When the
 * form is an object, the **first numeric parameter** of the call selects the
 * form (`1` → `one`, everything else → `other`); Chinese has no such inflection.
 */
export type MessageForm = string | { readonly one: string; readonly other: string };

export type Message = {
  readonly zh: string;
  readonly en: MessageForm;
};

/** Positional substitutions referenced as `{0}`, `{1}`, … inside a message. */
export type TranslateParams = readonly (string | number)[];
