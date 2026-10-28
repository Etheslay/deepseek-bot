// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotificationSettingsPanel } from "../../src/renderer/src/features/system/notifications-panel.js";
import type { NotificationPrefs } from "../../src/renderer/src/features/settings/settings-store.js";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
});

async function renderPanel(
  prefs: NotificationPrefs,
  onChange: (next: NotificationPrefs) => void,
): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(NotificationSettingsPanel, {
        prefs,
        bots: [
          { id: "b1", name: "Alpha" },
          { id: "b2", name: "Beta" },
        ],
        onChange,
        onTest: async () => ({ shown: true, reason: null }),
      }),
    );
  });
  return container;
}

describe("per-bot mute switches", () => {
  it("shows an unlabeled toggle and leaves the other notification rows in place", async () => {
    const container = await renderPanel(
      { enabled: true, onlyWhenUnfocused: true, mutedBotIds: ["b1"] },
      () => undefined,
    );

    expect(container.textContent).toContain("仅窗口不在前台时提醒");
    expect(container.textContent).toContain("发送测试通知");
    expect(container.textContent).toContain("按 Bot 静音");
    expect(container.textContent).not.toContain("取消静音");

    const muteSwitches = [...container.querySelectorAll<HTMLButtonElement>(".notify-mute-switch")];
    expect(muteSwitches.map((button) => button.textContent?.trim())).toEqual(["", ""]);
    expect(muteSwitches.map((button) => button.childElementCount)).toEqual([1, 1]);
    expect(muteSwitches.map((button) => button.firstElementChild?.className)).toEqual([
      "notify-mute-knob",
      "notify-mute-knob",
    ]);
    expect(muteSwitches.every((button) => !button.classList.contains("settings-switch"))).toBe(true);
    expect(muteSwitches.map((button) => button.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(muteSwitches.map((button) => button.classList.contains("on"))).toEqual([true, false]);
    expect(muteSwitches.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Alpha 静音",
      "Beta 静音",
    ]);
    const shared = [...container.querySelectorAll<HTMLButtonElement>(".settings-switch")];
    expect(shared).toHaveLength(2);
    expect(shared.map((button) => button.textContent?.trim())).toEqual(["", ""]);
    expect(shared.map((button) => button.firstElementChild?.className)).toEqual([
      "settings-switch-knob",
      "settings-switch-knob",
    ]);
    expect(container.querySelector(".notify-bot-state")).toBeNull();
  });

  it("still toggles mutedBotIds when the unlabeled switch is clicked", async () => {
    const changes: NotificationPrefs[] = [];
    const container = await renderPanel(
      { enabled: true, onlyWhenUnfocused: true, mutedBotIds: ["b1"] },
      (next) => changes.push(next),
    );
    const [alpha, beta] = [...container.querySelectorAll<HTMLButtonElement>(".notify-mute-switch")];
    if (alpha === undefined || beta === undefined) {
      throw new Error("missing mute switches");
    }

    await act(async () => {
      alpha.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      beta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(changes.map((prefs) => prefs.mutedBotIds)).toEqual([[], ["b1", "b2"]]);
    expect(changes.every((prefs) => prefs.enabled && prefs.onlyWhenUnfocused)).toBe(true);
  });
});
