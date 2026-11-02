// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceLanguageSettings } from "../../src/renderer/src/features/settings/voice-language-settings.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const roots: Root[] = [];

async function mount(
  value: "zh" | "en",
  onChange = vi.fn(),
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(VoiceLanguageSettings, { value, onChange }));
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
});

describe("VoiceLanguageSettings", () => {
  it("offers Chinese and English and defaults the visible choice to Chinese", async () => {
    const host = await mount("zh");
    expect(host.textContent).toContain("转写语言");
    expect(host.textContent).toContain("中文");
    expect(host.querySelector("[data-value='zh']")).not.toBeNull();
    expect(host.textContent).not.toContain("whisper");
  });

  it("reports English when that option is chosen", async () => {
    const onChange = vi.fn();
    const host = await mount("zh", onChange);
    const trigger = host.querySelector<HTMLButtonElement>(".custom-select-trigger");
    await act(async () => {
      trigger?.click();
    });
    const english = [...document.body.querySelectorAll<HTMLButtonElement>(".custom-select-item")].find(
      (item) => item.dataset.value === "en",
    );
    await act(async () => {
      english?.click();
    });
    expect(onChange).toHaveBeenCalledWith("en");
  });
});
