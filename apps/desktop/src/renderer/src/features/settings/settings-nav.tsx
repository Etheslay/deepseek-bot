/**
 * Settings navigation.
 *
 * A flat list of the settings sections. An earlier pass put them under three
 * group labels; the labels were small uppercase text that added visual noise
 * without helping, so the list is flat. Voice chooses the transcription
 * language only. The app ships its own whisper.cpp build, so there is no
 * path or model picker.
 */
import type { JSX } from "react";
import { t, useLanguage } from "../../i18n.js";

/** Settings sections, in reading order. */
export const SETTINGS_SECTION_KEYS = [
  "general",
  "voice",
  "computer",
  "permissions",
  "vault",
  "usage",
  "updates",
] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTION_KEYS)[number];

/** Label for each section, in the current language. */
export function settingsNavItems(): ReadonlyArray<{ readonly key: SettingsSectionKey; readonly label: string }> {
  return [
    { key: "general", label: t("shell.general") },
    { key: "voice", label: t("shell.voice") },
    { key: "computer", label: t("shell.computer") },
    { key: "permissions", label: t("d24.permissionsSection") },
    { key: "vault", label: t("shell.vault") },
    { key: "usage", label: t("shell.usageAndBilling") },
    { key: "updates", label: t("shell.updates") },
  ];
}

export function SettingsNav(props: {
  active: SettingsSectionKey;
  onSelect: (key: SettingsSectionKey) => void;
}): JSX.Element {
  useLanguage();
  return (
    <aside className="settings-nav" aria-label={t("shell.settingsSections")}>
      {settingsNavItems().map((item) => (
        <button
          key={item.key}
          type="button"
          className={"settings-nav-item" + (props.active === item.key ? " active" : "")}
          aria-current={props.active === item.key ? "true" : undefined}
          onClick={() => props.onSelect(item.key)}
        >
          {item.label}
        </button>
      ))}
    </aside>
  );
}
