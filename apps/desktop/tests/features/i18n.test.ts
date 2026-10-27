import { describe, expect, it } from "vitest";
import {
  isLanguage,
  isLanguagePreference,
  languageFromLocale,
  localeTag,
  resolveLanguage,
} from "../../src/shared/i18n/locale.js";
import { MESSAGE_KEYS, MESSAGES } from "../../src/shared/i18n/messages/index.js";
import { placeholderSignature, translate } from "../../src/shared/i18n/translate.js";
import type { Message } from "../../src/shared/i18n/types.js";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

describe("language resolution", () => {
  it("follows the desktop locale only when the preference is system", () => {
    expect(resolveLanguage("system", "zh-CN")).toBe("zh");
    expect(resolveLanguage("system", "zh-TW")).toBe("zh");
    expect(resolveLanguage("system", "en-US")).toBe("en");
    expect(resolveLanguage("system", "fr-FR")).toBe("en");
    expect(resolveLanguage("system", "")).toBe("en");
    expect(resolveLanguage("zh", "en-US")).toBe("zh");
    expect(resolveLanguage("en", "zh-CN")).toBe("en");
  });

  it("treats any zh subtag as Chinese and anything else as English", () => {
    expect(languageFromLocale("zh")).toBe("zh");
    expect(languageFromLocale("ZH-Hans-CN")).toBe("zh");
    expect(languageFromLocale(" zh-CN ")).toBe("zh");
    expect(languageFromLocale("en")).toBe("en");
    expect(languageFromLocale("de-DE")).toBe("en");
    expect(languageFromLocale("chinese")).toBe("en");
  });

  it("maps languages to BCP 47 tags used by Intl", () => {
    expect(localeTag("zh")).toBe("zh-CN");
    expect(localeTag("en")).toBe("en-US");
  });

  it("guards the preference union used by IPC validation", () => {
    expect(isLanguage("zh")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguagePreference("system")).toBe(true);
    expect(isLanguagePreference("zh")).toBe(true);
    expect(isLanguagePreference("System")).toBe(false);
    expect(isLanguagePreference(null)).toBe(false);
  });
});

describe("translate", () => {
  const message: Message = { zh: "已删除分组「{0}」", en: 'Deleted group "{0}"' };

  it("substitutes positional parameters in both languages", () => {
    expect(translate("zh", "d22.language", [])).toBe("语言");
    expect(translate("en", "d22.language", [])).toBe("Language");
    expect(placeholderSignature(message.zh)).toBe("0");
  });

  it("leaves unknown placeholders untouched instead of blanking them", () => {
    expect(translate("zh", "d22.trayUnread", [])).toBe("{0} 条未读");
  });

  it("picks English count forms from the first numeric parameter", () => {
    expect(translate("en", "d22.chromeBookmarks", [1])).toBe("1 bookmark");
    expect(translate("en", "d22.chromeBookmarks", [3])).toBe("3 bookmarks");
    expect(translate("en", "d22.chromeBookmarks", [0])).toBe("0 bookmarks");
    expect(translate("en", "d22.chromeBookmarks", [])).toBe("{0} bookmarks");
    expect(translate("zh", "d22.chromeBookmarks", [3])).toBe("3 个书签");
  });

  it("returns the key for an unknown entry rather than throwing", () => {
    const bogus = translate("en", "d22.language" as never, []);
    expect(typeof bogus).toBe("string");
    expect(translate("en", "does.notExist" as never)).toBe("does.notExist");
  });
});

describe("message catalogue integrity", () => {
  it("is not empty", () => {
    expect(MESSAGE_KEYS.length).toBeGreaterThan(0);
  });

  it("gives every key Chinese and English text", () => {
    for (const key of MESSAGE_KEYS) {
      const entry = MESSAGES[key];
      expect(entry.zh, `${key} zh`).not.toBe("");
      if (typeof entry.en === "string") {
        expect(entry.en, `${key} en`).not.toBe("");
      } else {
        expect(entry.en.one, `${key} en.one`).not.toBe("");
        expect(entry.en.other, `${key} en.other`).not.toBe("");
      }
    }
  });

  it("keeps Chinese out of the English strings", () => {
    /** Language names are shown in their own language on purpose. */
    const intentional = new Set(["d22.languageZh", "d22.languageEn"]);
    const offenders: string[] = [];
    for (const key of MESSAGE_KEYS) {
      const entry = MESSAGES[key];
      if (intentional.has(key)) {
        continue;
      }
      const forms = typeof entry.en === "string" ? [entry.en] : [entry.en.one, entry.en.other];
      for (const form of forms) {
        if (CJK.test(form)) {
          offenders.push(`${key}: ${form}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses the same placeholders on both sides of every entry", () => {
    const mismatched: string[] = [];
    for (const key of MESSAGE_KEYS) {
      const entry = MESSAGES[key];
      const zh = placeholderSignature(entry.zh);
      const forms = typeof entry.en === "string" ? [entry.en] : [entry.en.one, entry.en.other];
      for (const form of forms) {
        if (placeholderSignature(form) !== zh) {
          mismatched.push(`${key}: zh=[${zh}] en=[${placeholderSignature(form)}]`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("keeps every placeholder referenced by both languages", () => {
    // Guards against an English form that drops a slot the call site fills in.
    // LaTeX in a message (e.g. `\frac{n(n+1)}{2}`) is intentionally untouched by
    // translate() when a call passes fewer params than the text has braces.
    const unused: string[] = [];
    for (const key of MESSAGE_KEYS) {
      const entry = MESSAGES[key];
      const zhSlots = new Set([...entry.zh.matchAll(/\{(\d+)\}/g)].map((m) => m[1]));
      const forms = typeof entry.en === "string" ? [entry.en] : [entry.en.one, entry.en.other];
      for (const form of forms) {
        for (const match of form.matchAll(/\{(\d+)\}/g)) {
          if (!zhSlots.has(match[1])) {
            unused.push(`${key}: {${match[1]}} only in en`);
          }
        }
      }
    }
    expect(unused).toEqual([]);
  });

  it("keys are namespaced by domain so the sweep stays auditable", () => {
    for (const key of MESSAGE_KEYS) {
      expect(key).toMatch(/^[a-z0-9]+\.[A-Za-z0-9]+$/);
    }
  });
});
