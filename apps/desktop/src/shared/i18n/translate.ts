/**
 * Catalogue lookup for the shared i18n runtime (D22).
 *
 * Messages are `{0}`-parameterised strings; English entries may be two-form
 * count patterns. `translate` is pure and framework-free so both the renderer
 * and the Electron main process read from the same catalogue.
 */
import { MESSAGES, type MessageKey } from "./messages/index.js";
import type { Language, Message, MessageForm, TranslateParams } from "./types.js";

/** Replace `{0}`, `{1`, … with positional params; unknown placeholders stay. */
function interpolate(template: string, params: TranslateParams): string {
  if (params.length === 0) {
    return template;
  }
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = params[Number(index)];
    return value === undefined ? match : String(value);
  });
}

/**
 * Count forms are driven by the first numeric param — the catalogue is authored
 * that way (`t("tray.unread", [3])`). Non-numeric or missing counts use `other`.
 */
function selectForm(form: MessageForm, params: TranslateParams): string {
  if (typeof form === "string") {
    return form;
  }
  const first = params.find((value) => typeof value === "number");
  return first === 1 ? form.one : form.other;
}

export function translate(
  lang: Language,
  key: MessageKey,
  params: TranslateParams = [],
): string {
  const message: Message | undefined = MESSAGES[key];
  if (message === undefined) {
    return key;
  }
  return interpolate(lang === "zh" ? message.zh : selectForm(message.en, params), params);
}

/** Placeholder indices referenced by a message, as a sorted signature. */
export function placeholderSignature(template: string): string {
  const found = [...template.matchAll(/\{(\d+)\}/g)].map((m) => m[1]);
  return [...new Set(found)].sort().join(",");
}

/** Placeholders of an entry across both languages (count forms merged). */
export function entrySignature(message: Message): { zh: string; en: string } {
  const en =
    typeof message.en === "string"
      ? placeholderSignature(message.en)
      : `${placeholderSignature(message.en.one)}|${placeholderSignature(message.en.other)}`;
  return { zh: placeholderSignature(message.zh), en };
}
