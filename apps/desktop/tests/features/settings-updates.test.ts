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
    saveSettings(storage, { theme: "light", accountName: "Destinyian", accent: "#ec4899" });
    const loaded = loadSettings(storage);
    expect(loaded).toEqual({ theme: "light", accountName: "Destinyian", accent: "#ec4899" });
  });

  it("falls back to defaults on corrupt payloads", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem("deepseek-bot.settings.v1", "{not json");
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects invalid themes, names and accents", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      "deepseek-bot.settings.v1",
      JSON.stringify({ theme: "neon", accountName: "  ", accent: "red" }),
    );
    const loaded = loadSettings(storage);
    expect(loaded.theme).toBe("dark");
    expect(loaded.accountName).toBe(DEFAULT_SETTINGS.accountName);
    expect(loaded.accent).toBe(DEFAULT_SETTINGS.accent);
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
