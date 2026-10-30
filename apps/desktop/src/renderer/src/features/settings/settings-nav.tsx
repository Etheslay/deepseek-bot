/**
 * Settings navigation.
 *
 * A flat list of the seven sections. An earlier pass put them under three group
 * labels (基础 / 权限与数据 / 用量与系统); the labels were small uppercase text that
 * added visual noise without helping, so the list is flat again. The component
 * stays extracted because App.tsx no longer has to carry the section list and
 * the keys are a closed union.
 */
import type { JSX } from "react";
import { t, useLanguage } from "../../i18n.js";

/** The seven settings sections, in reading order. */
export const SETTINGS_SECTION_KEYS = [
  "general",
  "computer",
  "voice",
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
    { key: "computer", label: t("shell.computer") },
    { key: "voice", label: t("shell.voiceSection") },
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
