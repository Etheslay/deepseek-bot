/**
 * Settings panel for the D16 permission model: per-capability policy
 * (始终允许 / 每次询问 / 从不允许) plus issued grant records with revoke.
 * Reads and writes go through `permission.policy.*` and `permission.grant.*`.
 */
import { useCallback, useEffect, useState } from "react";
import {
  PERMISSION_METHODS,
  isPermissionModeAllowed,
  type CapabilityId,
  type PermissionGrant,
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

const SCOPE_LABEL_KEYS = {
  once: "permissions.scopeOnce",
  session: "shell.scopeSession",
  permanent: "permissions.scopePermanent",
} as const satisfies Record<string, MessageKey>;

const MODES = ["allow", "ask", "deny"] as const satisfies readonly PermissionMode[];

type IssuedGrant = PermissionGrant & { scope: keyof typeof SCOPE_LABEL_KEYS };

function isIssuedGrant(grant: PermissionGrant): grant is IssuedGrant {
  return grant.scope === "once" || grant.scope === "session" || grant.scope === "permanent";
}

function allowedModes(capability: CapabilityId): PermissionMode[] {
  return MODES.filter((mode) => isPermissionModeAllowed(capability, mode));
}

function isMode(value: string): value is PermissionMode {
  return value === "allow" || value === "ask" || value === "deny";
}

type HostCall = (method: string, payload: unknown) => Promise<unknown>;

async function loadPermissionSettings(call: HostCall): Promise<{
  policies: { capability: CapabilityId; mode: PermissionMode }[];
  grants: IssuedGrant[];
}> {
  const [policyResponse, grantResponse] = await Promise.all([
    call("permission.policy.list", {}),
    call("permission.grant.list", {}),
  ]);
  return {
    policies: PERMISSION_METHODS["permission.policy.list"].response.parse(policyResponse).policies,
    grants: PERMISSION_METHODS["permission.grant.list"].response
      .parse(grantResponse)
      .grants.filter(isIssuedGrant),
  };
}

function grantUsage(grant: IssuedGrant): string {
  if (grant.revokedAt !== null) return t("permissions.revoked");
  const limit = grant.maxUses === null ? t("permissions.noLimit") : String(grant.maxUses);
  return t("permissions.grantUsage", [grant.uses, limit]);
}

export function PermissionsPanel() {
  // Subscribes to the language store: the stored notice is a factory, so it only
  // re-translates when this component re-renders (D22).
  useLanguage();
  const [policies, setPolicies] = useState<
    { capability: CapabilityId; mode: PermissionMode }[] | null
  >(null);
  const [grants, setGrants] = useState<IssuedGrant[]>([]);
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
    setGrants(snapshot.grants);
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
    void window.deepseekBot.host
      .call("permission.policy.set", { capability, mode })
      .then((response) => {
        PERMISSION_METHODS["permission.policy.set"].response.parse(response);
        setNoticeError(false);
        setNotice(
          () => () => t("permissions.policySaved", [capabilityLabel(capability), t(MODE_LABEL_KEYS[mode])]),
        );
        return reload();
      })
      .catch(() => {
        setNoticeError(true);
        setNotice(() => () => t("permissions.policySaveFailed"));
      });
  };

  return (
    <div className="settings-card">
      <div className="settings-row">
        <span>{t("permissions.capabilityPolicies")}</span>
        <span className="settings-soon">{t("permissions.policyHint")}</span>
      </div>
      {policies.map((policy) => {
        const choices = allowedModes(policy.capability);
        return (
          <div className="settings-row" key={policy.capability}>
            <span>{capabilityLabel(policy.capability)}</span>
            {/* A native <select> cannot drop the Windows blue selection wash, so
                this uses the app's own list, styled like the choice card. */}
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
      <div className="settings-row">
        <span>{t("permissions.issuedGrants")}</span>
        <span className="settings-soon">
          {grants.length === 0 ? t("permissions.none") : t("permissions.grantCount", [grants.length])}
        </span>
      </div>
      {grants.map((grant) => (
        <div className="settings-row" key={grant.id}>
          <span>
            {capabilityLabel(grant.capability)} · {t(SCOPE_LABEL_KEYS[grant.scope])} ·{" "}
            {grantUsage(grant)}
          </span>
          {grant.revokedAt === null ? (
            <button
              type="button"
              className="pill-btn"
              onClick={() => {
                void window.deepseekBot.host
                  .call("permission.grant.revoke", { grantId: grant.id })
                  .then((response) => {
                    PERMISSION_METHODS["permission.grant.revoke"].response.parse(response);
                    setNoticeError(false);
                    setNotice(() => () => t("permissions.grantRevoked"));
                    return reload();
                  })
                  .catch(() => {
                    setNoticeError(true);
                    setNotice(() => () => t("permissions.revokeFailed"));
                  });
              }}
            >
              {t("permissions.revoke")}
            </button>
          ) : null}
        </div>
      ))}
      {notice !== null ? (
        <p className={noticeError ? "form-error" : "settings-ok"}>{notice()}</p>
      ) : null}
    </div>
  );
}
