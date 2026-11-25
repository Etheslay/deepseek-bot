/**
 * Settings panel for the D16 permission model.
 *
 * The policy engine still stores a mode for every capability. This page lists
 * the computer actions that stay gated: local commands, connectors, MCP,
 * device input, and screen capture. Bot-to-bot messaging is not a permission.
 * Device input and screen capture stay ask or off. Workspace files and the
 * other in-app capabilities default to allow and are not listed.
 * Issued grants stay here so a person can revoke them.
 */
import { useCallback, useEffect, useState } from "react";
import {
  PERMISSION_METHODS,
  SETTINGS_SURFACE_CAPABILITIES,
  isPermissionModeAllowed,
  type CapabilityId,
  type PermissionMode,
} from "@deepseek-bot/contracts";
import { t, useLanguage, type MessageKey } from "../../i18n.js";
import { CustomSelect } from "../../components/custom-select.js";
import { capabilityLabel } from "./capability-labels.js";

/** Permission modes are contract data; only their labels are localized (D22). */
const MODE_LABEL_KEYS: Record<PermissionMode, MessageKey> = {
  allow: "permissions.modeAllow",
  ask: "permissions.modeAsk",
  deny: "permissions.modeDeny",
};

const MODES = ["allow", "ask", "deny"] as const satisfies readonly PermissionMode[];

const SURFACE = new Set<CapabilityId>(SETTINGS_SURFACE_CAPABILITIES);

/**
 * Every row on this page offers all three modes (allow / ask / deny); the
 * contract accepts allow for every capability, including screen capture and
 * device actions.
 */
function surfaceModes(capability: CapabilityId): PermissionMode[] {
  return MODES.filter((mode) => isPermissionModeAllowed(capability, mode));
}

function isMode(value: string): value is PermissionMode {
  return value === "allow" || value === "ask" || value === "deny";
}

type HostCall = (method: string, payload: unknown) => Promise<unknown>;

async function loadPermissionSettings(call: HostCall): Promise<{
  policies: { capability: CapabilityId; mode: PermissionMode }[];
}> {
  const policyResponse = await call("permission.policy.list", {});
  return {
    policies: PERMISSION_METHODS["permission.policy.list"].response.parse(policyResponse).policies,
  };
}

export function PermissionsPanel() {
  // Subscribes to the language store: the stored notice is a factory, so it only
  // re-translates when this component re-renders (D22).
  useLanguage();
  const [policies, setPolicies] = useState<
    { capability: CapabilityId; mode: PermissionMode }[] | null
  >(null);
  /**
   * The notice is stored as a factory, not a rendered string: a translated string
   * kept in state would still show the previous language after a switch (D22).
   */
  const [notice, setNotice] = useState<(() => string) | null>(null);
  const [noticeError, setNoticeError] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const snapshot = await loadPermissionSettings((method, payload) =>
      window.deepseekBot.host.call(method, payload),
    );
    setPolicies(snapshot.policies);
  }, []);

  useEffect(() => {
    void reload().catch(() => {
      setNoticeError(true);
      setNotice(() => () => t("permissions.loadFailed"));
    });
  }, [reload]);

  if (policies === null) {
    return (
      <div className="settings-card">
        <p className={noticeError ? "form-error" : "settings-soon"}>
          {notice !== null ? notice() : t("permissions.loading")}
        </p>
      </div>
    );
  }

  const savePolicy = (capability: CapabilityId, mode: PermissionMode): void => {
    if (!isPermissionModeAllowed(capability, mode)) return;
    // Show the choice immediately. Allow means later asks for this capability
    // are let through; the closed control must not stay on 每次询问.
    const snapshot = policies;
    setPolicies(
      policies.map((policy) => (policy.capability === capability ? { capability, mode } : policy)),
    );
    void window.deepseekBot.host
      .call("permission.policy.set", { capability, mode })
      .then(async (response) => {
        PERMISSION_METHODS["permission.policy.set"].response.parse(response);
        // No success line: the control already shows the stored mode (2026-11).
        setNotice(null);
        try {
          await reload();
        } catch {
          // The choice is already stored. Keep the label the person just picked.
        }
      })
      .catch(() => {
        setPolicies(snapshot);
        setNoticeError(true);
        setNotice(() => () => t("permissions.policySaveFailed"));
      });
  };

  return (
    <div className="settings-card">
      <div className="settings-row">
        <span>{t("permissions.capabilityPolicies")}</span>
      </div>
      {policies
        .filter((policy) => SURFACE.has(policy.capability))
        .map((policy) => {
          const choices = surfaceModes(policy.capability);
          return (
            <div className="settings-row" key={policy.capability}>
              <span>{capabilityLabel(policy.capability)}</span>
              {/* A native select cannot drop the Windows blue selection wash, so
                this uses the shared CustomSelect list. */}
              <CustomSelect
                value={policy.mode}
                options={choices.map((mode) => ({ value: mode, label: t(MODE_LABEL_KEYS[mode]) }))}
                ariaLabel={t("permissions.capabilityPolicy", [policy.capability])}
                disabled={choices.length < 2}
                onChange={(next) => {
                  if (isMode(next)) savePolicy(policy.capability, next);
                }}
              />
            </div>
          );
        })}
      {notice !== null ? (
        <p className={noticeError ? "form-error" : "settings-ok"}>{notice()}</p>
      ) : null}
    </div>
  );
}
