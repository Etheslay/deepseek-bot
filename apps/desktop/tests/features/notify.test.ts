// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  NOTIFY_THROTTLE_MS,
  notificationRequest,
  shouldNotify,
} from "../../src/renderer/src/features/system/notify.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";
import { DEFAULT_SETTINGS } from "../../src/renderer/src/features/settings/settings-store.js";

const prefs = DEFAULT_SETTINGS.notifications;

function context(focused: boolean, clock = { value: 0 }) {
  return {
    focused,
    now: () => clock.value,
    lastRaised: new Map<string, number>(),
    clock,
  };
}

describe("notification gating", () => {
  beforeEach(() => {
    setLanguagePreference("zh");
  });

  it("is off entirely when the master switch is off", () => {
    const ctx = context(false);
    expect(
      shouldNotify({ ...prefs, enabled: false }, { kind: "reply", botId: "b1", botName: "Alpha" }, ctx),
    ).toBe(false);
  });

  it("stays quiet while the window is focused, by default", () => {
    const focused = context(true);
    expect(shouldNotify(prefs, { kind: "reply", botId: "b1", botName: "Alpha" }, focused)).toBe(false);
    const away = context(false);
    expect(shouldNotify(prefs, { kind: "reply", botId: "b1", botName: "Alpha" }, away)).toBe(true);
  });

  it("can be switched to notify even in the foreground", () => {
    const ctx = context(true);
    expect(
      shouldNotify(
        { ...prefs, onlyWhenUnfocused: false },
        { kind: "approval", botId: "b1", botName: "Alpha" },
        ctx,
      ),
    ).toBe(true);
  });

  it("respects the per-bot mute list but never mutes app-level notices", () => {
    const muted = { ...prefs, mutedBotIds: ["b1"] };
    const base = context(false);
    expect(shouldNotify(muted, { kind: "reply", botId: "b1", botName: "Alpha" }, base)).toBe(false);
    expect(shouldNotify(muted, { kind: "reply", botId: "b2", botName: "Beta" }, base)).toBe(true);
    expect(shouldNotify(muted, { kind: "missed", botId: null, botName: "", count: 2 }, base)).toBe(true);
  });

  it("throttles repeated notices of the same kind per bot", () => {
    const ctx = context(false, { value: 1_000 });
    const input = { kind: "reply" as const, botId: "b1", botName: "Alpha" };
    expect(shouldNotify(prefs, input, ctx)).toBe(true);
    ctx.clock.value += NOTIFY_THROTTLE_MS - 1;
    expect(shouldNotify(prefs, input, ctx)).toBe(false);
    ctx.clock.value += 2;
    expect(shouldNotify(prefs, input, ctx)).toBe(true);
    // A different kind is a different notice, not a duplicate.
    expect(shouldNotify(prefs, { ...input, kind: "approval" }, ctx)).toBe(true);
  });

  it("lets the explicit test notice through even while focused", () => {
    const ctx = context(true);
    expect(shouldNotify(prefs, { kind: "test", botId: null, botName: "" }, ctx)).toBe(true);
  });
});

describe("notification copy", () => {
  it("titles a reply with the bot name in the active language", () => {
    setLanguagePreference("zh");
    expect(notificationRequest({ kind: "reply", botId: "b1", botName: "小助手" }).title).toBe(
      "小助手 已回复",
    );
    setLanguagePreference("en");
    expect(notificationRequest({ kind: "reply", botId: "b1", botName: "Alpha" }).title).toBe(
      "Alpha replied",
    );
    setLanguagePreference("zh");
  });

  it("describes an approval wait and a missed schedule", () => {
    setLanguagePreference("en");
    const approval = notificationRequest({ kind: "approval", botId: "b1", botName: "Alpha" });
    expect(approval.title).toBe("Alpha needs approval");
    expect(approval.body).toBe("An action is waiting for your decision");
    const missed = notificationRequest({ kind: "missed", botId: null, botName: "", count: 2 });
    expect(missed.botId).toBeNull();
    expect(missed.body).toContain("2 occurrences");
    setLanguagePreference("zh");
  });

  it("keeps app-level notices free of a bot id", () => {
    const test = notificationRequest({ kind: "test", botId: null, botName: "" });
    expect(test.botId).toBeNull();
    expect(test.icon).toBeNull();
  });
});
