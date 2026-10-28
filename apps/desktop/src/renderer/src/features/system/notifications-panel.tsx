/**
 * Notification settings (D22, FR-19).
 *
 * Three switches the user can actually act on: the master enable, "only when the
 * window is not focused" (the default, so an operator watching the app never gets
 * a duplicate of what is already on screen) and a per-bot mute list. Raising the
 * notice itself is main's job; this panel only owns preferences plus a test
 * button that reports the real outcome, including "this system has no
 * notification channel".
 */
import { useEffect, useState, type JSX } from "react";
import { t } from "../../i18n.js";
import type { NotificationPrefs } from "../settings/settings-store.js";

export type NotificationBot = { id: string; name: string };

export function SettingsSwitch(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="settings-row">
      <span>
        {props.label}
        {props.hint !== undefined && <em className="settings-hint">{props.hint}</em>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={"settings-switch" + (props.checked ? " on" : "")}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="settings-switch-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

export function NotificationSettingsPanel(props: {
  prefs: NotificationPrefs;
  bots: readonly NotificationBot[];
  onChange: (next: NotificationPrefs) => void;
  onTest: () => Promise<{ shown: boolean; reason: string | null }>;
}): JSX.Element {
  const [testState, setTestState] = useState<{ shown: boolean; reason: string | null } | null>(null);

  useEffect(() => {
    if (testState === null) {
      return;
    }
    const timer = setTimeout(() => setTestState(null), 4_000);
    return () => clearTimeout(timer);
  }, [testState]);

  const muted = new Set(props.prefs.mutedBotIds);

  const toggleBot = (id: string, on: boolean): void => {
    const next = new Set(props.prefs.mutedBotIds);
    if (on) {
      next.delete(id);
    } else {
      next.add(id);
    }
    props.onChange({ ...props.prefs, mutedBotIds: [...next] });
  };

  return (
    <div className="notification-settings" data-testid="notification-settings">
      <SettingsSwitch
        checked={props.prefs.enabled}
        onChange={(enabled) => props.onChange({ ...props.prefs, enabled })}
        label={t("d22.notifyEnabled")}
        hint={t("d22.notifyEnabledHint")}
      />
      <SettingsSwitch
        checked={props.prefs.onlyWhenUnfocused}
        onChange={(onlyWhenUnfocused) => props.onChange({ ...props.prefs, onlyWhenUnfocused })}
        label={t("d22.notifyOnlyUnfocused")}
      />
      <div className="settings-row">
        <span>{t("d22.notifyTest")}</span>
        <span className="key-input-wrap">
          <span className="settings-soon">
            {testState === null
              ? t("d22.notifyTestHint")
              : testState.shown
                ? t("d22.notifyTestSent")
                : testState.reason === "unsupported"
                  ? t("d22.notifyUnsupported")
                  : t("d22.notifyTestSkipped")}
          </span>
          <button
            type="button"
            className="pill-btn"
            disabled={!props.prefs.enabled}
            onClick={() => {
              void props.onTest().then(setTestState);
            }}
          >
            {t("d22.notifyTest")}
          </button>
        </span>
      </div>
      <div className="settings-row settings-row-stack">
        <span>{t("d22.notifyPerBot")}</span>
        {props.bots.length === 0 ? (
          <span className="settings-soon">{t("d22.notifyNoBots")}</span>
        ) : (
          <ul className="notify-bot-list" aria-label={t("d22.notifyPerBot")}>
            {props.bots.map((bot) => {
              // White and aria-checked mean mute is on. Black means it is off.
              const isMuted = muted.has(bot.id);
              return (
                <li key={bot.id} className="notify-bot">
                  <span className="notify-bot-name">{bot.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isMuted}
                    aria-label={`${bot.name} ${t("d22.notifyMute")}`}
                    className={isMuted ? "notify-mute-switch on" : "notify-mute-switch"}
                    onClick={() => toggleBot(bot.id, isMuted)}
                  >
                    <span className="notify-mute-knob" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
