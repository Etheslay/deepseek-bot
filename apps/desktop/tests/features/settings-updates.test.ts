// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  DEFAULT_SETTINGS,
  isValidHex,
  loadSettings,
  saveSettings,
} from "../../src/renderer/src/features/settings/settings-store.js";
import { compareVersions } from "../../src/shared/versions.js";

describe("settings persistence", () => {
  it("round-trips through localStorage", () => {
    const storage = window.localStorage;
    storage.clear();
    saveSettings(storage, {
      ...DEFAULT_SETTINGS,
      theme: "light",
      accountName: "Destinyian",
      accent: "#ec4899",
    });
    const loaded = loadSettings(storage);
    expect(loaded).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "light",
      accountName: "Destinyian",
      accent: "#ec4899",
    });
  });

  it("falls back to defaults on corrupt payloads", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem("deepseek-bot.settings.v2", "{not json");
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects invalid themes, names and accents", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      "deepseek-bot.settings.v2",
      JSON.stringify({ theme: "neon", accountName: "  ", accent: "red" }),
    );
    const loaded = loadSettings(storage);
    expect(loaded.theme).toBe("dark");
    expect(loaded.accountName).toBe(DEFAULT_SETTINGS.accountName);
    expect(loaded.accent).toBe(DEFAULT_SETTINGS.accent);
  });

  it("migrates a v1 payload onto the v2 defaults", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      "deepseek-bot.settings.v1",
      JSON.stringify({ theme: "light", accountName: "Etheslay", accent: "#2dd4a7" }),
    );
    const loaded = loadSettings(storage);
    expect(loaded.theme).toBe("light");
    expect(loaded.accountName).toBe("Etheslay");
    expect(loaded.accent).toBe("#2dd4a7");
    // D22 additions fall back rather than guessing.
    expect(loaded.language).toBe("system");
    expect(loaded.notifications).toEqual({
      enabled: true,
      onlyWhenUnfocused: true,
      mutedBotIds: [],
    });
    // Saving promotes the payload and retires the legacy key.
    saveSettings(storage, loaded);
    expect(storage.getItem("deepseek-bot.settings.v1")).toBeNull();
    expect(storage.getItem("deepseek-bot.settings.v2")).not.toBeNull();
  });

  it("turns the v1 default account name into the unset sentinel", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem("deepseek-bot.settings.v1", JSON.stringify({ accountName: "本地用户" }));
    expect(loadSettings(storage).accountName).toBe(DEFAULT_SETTINGS.accountName);
  });

  it("validates the D22 language and notification fields", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      "deepseek-bot.settings.v2",
      JSON.stringify({
        language: "fr",
        notifications: { enabled: "yes", onlyWhenUnfocused: false, mutedBotIds: ["a", "", 7, "a", "b"] },
      }),
    );
    const loaded = loadSettings(storage);
    expect(loaded.language).toBe("system");
    expect(loaded.notifications.enabled).toBe(true);
    expect(loaded.notifications.onlyWhenUnfocused).toBe(false);
    expect(loaded.notifications.mutedBotIds).toEqual(["a", "b"]);
  });

  it("drops a notification blob that is not an object at all", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem("deepseek-bot.settings.v2", JSON.stringify({ notifications: "on" }));
    expect(loadSettings(storage).notifications).toEqual(DEFAULT_SETTINGS.notifications);
  });

  it("presets are all valid hex", () => {
    for (const preset of ACCENT_PRESETS) {
      expect(isValidHex(preset)).toBe(true);
    }
  });
});

describe("update version comparison", () => {
  it("orders patch, minor and major correctly", () => {
    expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  });

  it("tolerates uneven segment counts", () => {
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.1", "0.1")).toBeGreaterThan(0);
  });
});
