/**
 * Settings navigation.
 *
 * Six flat entries read as an undifferentiated list, so they are grouped the way
 * the page is actually used: the basics you set once, the access you grant, and
 * the windows onto usage and updates. Grouping is presentation only — the same
 * six sections, same keys, same handler.
 */
import type { JSX } from "react";
import { t, useLanguage } from "../../i18n.js";

/** The six settings sections. */
export const SETTINGS_SECTION_KEYS = [
  "general",
  "computer",
  "permissions",
  "vault",
  "usage",
  "updates",
] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTION_KEYS)[number];

interface NavGroup {
  readonly label: string;
  readonly items: ReadonlyArray<{ readonly key: SettingsSectionKey; readonly label: string }>;
}

export function settingsNavGroups(): ReadonlyArray<NavGroup> {
  return [
    {
      label: t("shell.navGroupBasics"),
      items: [
        { key: "general", label: t("shell.general") },
        { key: "computer", label: t("shell.computer") },
      ],
    },
    {
      label: t("shell.navGroupAccess"),
      items: [
        { key: "permissions", label: t("d24.permissionsSection") },
        { key: "vault", label: t("shell.vault") },
      ],
    },
    {
      label: t("shell.navGroupUsage"),
      items: [
        { key: "usage", label: t("shell.usageAndBilling") },
        { key: "updates", label: t("shell.updates") },
      ],
    },
  ];
}

export function SettingsNav(props: {
  active: SettingsSectionKey;
  onSelect: (key: SettingsSectionKey) => void;
}): JSX.Element {
  useLanguage();
  return (
    <aside className="settings-nav" aria-label={t("shell.settingsSections")}>
      {settingsNavGroups().map((group) => (
        <div className="settings-nav-group" key={group.label}>
          <div className="settings-nav-group-label">{group.label}</div>
          {group.items.map((item) => (
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
        </div>
      ))}
    </aside>
  );
}
