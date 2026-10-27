/**
 * System notification policy (D22).
 *
 * The renderer owns the decision — it knows the persisted settings, which bot is
 * muted, whether the window is in the foreground and what just happened — and
 * only the actual raising of the notice happens in main. Pure parts are exported
 * for tests; `notifyUser` is the one side-effecting entry point.
 *
 * Defaults are deliberately quiet: master switch on, but only when the window is
 * not focused, so an operator watching the app never gets a duplicate of what is
 * already on screen.
 */
import { t } from "../../i18n.js";
import type { NotificationPrefs } from "../settings/settings-store.js";
import type { NotificationRequest } from "../../../../shared/system-integration.js";

export type NotifyKind = "reply" | "approval" | "missed" | "test";

export type NotifyInput = {
  kind: NotifyKind;
  botId: string | null;
  botName: string;
  /** Count for the missed-schedule case. */
  count?: number;
  icon?: string | null;
};

export type NotifyContext = {
  focused: boolean;
  /** Monotonic clock in ms, injected so tests stay deterministic. */
  now: () => number;
  /** Last raise per (botId|kind), used for throttling. */
  lastRaised: Map<string, number>;
};

/** Two notices of the same kind for the same bot closer than this collapse. */
export const NOTIFY_THROTTLE_MS = 5_000;

export function notificationRequest(input: NotifyInput): NotificationRequest {
  switch (input.kind) {
    case "reply":
      return {
        botId: input.botId,
        title: t("d22.notifyReplyTitle", [input.botName]),
        body: "",
        icon: input.icon ?? null,
        silent: false,
      };
    case "approval":
      return {
        botId: input.botId,
        title: t("d22.notifyApprovalTitle", [input.botName]),
        body: t("d22.notifyApprovalBody"),
        icon: input.icon ?? null,
        silent: false,
      };
    case "missed":
      return {
        botId: null,
        title: t("d22.notifyMissedTitle"),
        body: t("d22.notifyMissedBody", [input.count ?? 0]),
        icon: null,
        silent: false,
      };
    case "test":
      return {
        botId: null,
        title: t("d22.notifyTestTitle"),
        body: t("d22.notifyTestBody"),
        icon: input.icon ?? null,
        silent: false,
      };
  }
}

/** Pure gate: settings × focus × per-bot mute × throttle. */
export function shouldNotify(
  prefs: NotificationPrefs,
  input: NotifyInput,
  context: NotifyContext,
): boolean {
  if (!prefs.enabled) {
    return false;
  }
  if (input.botId !== null && prefs.mutedBotIds.includes(input.botId)) {
    return false;
  }
  if (input.kind === "test") {
    // The test button is an explicit user action: enabled + unmuted is enough,
    // focus and throttle do not apply to it.
    return true;
  }
  if (prefs.onlyWhenUnfocused && context.focused) {
    return false;
  }
  const key = `${input.botId ?? "app"}|${input.kind}`;
  const last = context.lastRaised.get(key);
  if (last !== undefined && context.now() - last < NOTIFY_THROTTLE_MS) {
    return false;
  }
  context.lastRaised.set(key, context.now());
  return true;
}

export type NotifyResult =
  | { sent: false; reason: "gated" | "no-bridge" }
  | { sent: true; outcome: { shown: boolean; reason: string | null } };

/** Raises one notice through the preload bridge (no-op in a plain browser). */
export async function notifyUser(
  prefs: NotificationPrefs,
  input: NotifyInput,
  context: NotifyContext,
): Promise<NotifyResult> {
  if (!shouldNotify(prefs, input, context)) {
    return { sent: false, reason: "gated" };
  }
  const bridge = typeof window === "undefined" ? undefined : window.deepseekBot;
  if (!bridge || !("system" in bridge)) {
    return { sent: false, reason: "no-bridge" };
  }
  try {
    const outcome = await bridge.system.notifications.show(notificationRequest(input));
    return { sent: true, outcome };
  } catch {
    return { sent: false, reason: "gated" };
  }
}

/** Focus tracking source: main pushes real window focus, DOM visibility is the fallback. */
export function createFocusTracker(): {
  isFocused: () => boolean;
  attach: (bridge?: { system?: { onWindowFocus: (l: (e: { focused: boolean }) => void) => () => void } } | null) => () => void;
} {
  let focused = typeof document === "undefined" ? true : document.visibilityState === "visible";
  return {
    isFocused: () => focused,
    attach: (bridge) => {
      const onVisibility = (): void => {
        focused = document.visibilityState === "visible";
      };
      document.addEventListener("visibilitychange", onVisibility);
      const offBridge = bridge?.system?.onWindowFocus((event) => {
        focused = event.focused;
      });
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        offBridge?.();
      };
    },
  };
}
