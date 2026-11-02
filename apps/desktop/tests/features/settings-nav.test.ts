// @vitest-environment jsdom
/**
 * Settings navigation: a flat list of the sections.
 *
 * An earlier pass grouped them under three small uppercase labels; the labels
 * were visual noise, so this pins the flat list — no group text. Voice is
 * the transcription-language section, not a path picker.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_SECTION_KEYS, SettingsNav } from "../../src/renderer/src/features/settings/settings-nav.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const roots: Root[] = [];

async function mount(
  active: (typeof SETTINGS_SECTION_KEYS)[number],
  onSelect = vi.fn(),
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(SettingsNav, { active, onSelect }));
  });
  return host;
}

beforeEach(() => {
  document.body.textContent = "";
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SettingsNav", () => {
  it("is one flat list of the sections, in reading order", async () => {
    const host = await mount("general");
    const items = [...host.querySelectorAll(".settings-nav-item")].map((node) => node.textContent);
    expect(items).toEqual(["通用", "语音", "电脑", "权限", "保险库", "用量与账单", "更新"]);
    expect(items).toHaveLength(SETTINGS_SECTION_KEYS.length);
  });

  it("renders no group labels or wrappers", async () => {
    const host = await mount("general");
    expect(host.querySelectorAll(".settings-nav-group").length).toBe(0);
    expect(host.querySelectorAll(".settings-nav-group-label").length).toBe(0);
    /* every item is a direct child of the nav, nothing in between */
    const nav = host.querySelector(".settings-nav");
    const childTags = [...(nav?.children ?? [])].map((node) => node.tagName);
    expect(childTags.every((tag) => tag === "BUTTON")).toBe(true);
  });

  it("marks the active section for assistive tech", async () => {
    const host = await mount("vault");
    const active = host.querySelector(".settings-nav-item.active");
    expect(active?.textContent).toBe("保险库");
    expect(active?.getAttribute("aria-current")).toBe("true");
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it("reports the clicked section by key", async () => {
    const onSelect = vi.fn();
    const host = await mount("general", onSelect);
    const items = [...host.querySelectorAll<HTMLButtonElement>(".settings-nav-item")];
    await act(async () => {
      items.find((item) => item.textContent === "用量与账单")?.click();
    });
    expect(onSelect).toHaveBeenCalledWith("usage");
  });

  it("follows the language switch", async () => {
    setLanguagePreference("en");
    const host = await mount("general");
    const items = [...host.querySelectorAll(".settings-nav-item")].map((node) => node.textContent);
    expect(items).toEqual(["General", "Voice", "Computer", "Permissions", "Vault", "Usage & Billing", "Updates"]);
    setLanguagePreference("zh");
  });
});
