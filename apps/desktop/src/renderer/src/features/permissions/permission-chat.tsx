/**
 * Chat authorization for the open bot.
 * Pending tool calls still go through permission.approval.decide.
 * The same card can grant or revoke one capability for this bot. Session
 * grants use the existing chat session, five uses and two hours. Per-action
 * capabilities stay on the once-only approval card.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  CAPABILITY_IDS,
  PERMISSION_METHODS,
  defaultPermissionMode,
  requiresPerActionApproval,
  type AppApproval,
  type CapabilityId,
  type CapabilityPolicy,
  type PermissionDecisionRequest,
  type PermissionGrant,
} from "@deepseek-bot/contracts";
import { t, useLanguage, type MessageKey } from "../../i18n.js";
import { CustomSelect } from "../../components/custom-select.js";
import { capabilityLabel } from "./capability-labels.js";

const SESSION_USES = 5;
const SESSION_MINUTES = 120;

const GRANT_SCOPE_LABEL_KEYS = {
  once: "permissions.scopeOnce",
  session: "shell.scopeSession",
  permanent: "permissions.scopePermanent",
} as const;

function isRevocableGrant(
  grant: PermissionGrant,
): grant is PermissionGrant & { scope: keyof typeof GRANT_SCOPE_LABEL_KEYS } {
  return grant.scope === "once" || grant.scope === "session" || grant.scope === "permanent";
}

function chatGrantCapabilities(policies: readonly CapabilityPolicy[]): CapabilityId[] {
  return CAPABILITY_IDS.filter((capability) => {
    if (requiresPerActionApproval(capability)) return false;
    const mode = policies.find((policy) => policy.capability === capability)?.mode;
    return (mode ?? defaultPermissionMode(capability)) === "ask";
  });
}

type GrantChoice = "once" | "session" | "permanent";
type CardChoice = GrantChoice | "deny";

export function approvalChoices(
  approval: Pick<AppApproval, "capabilities" | "sessionId">,
): GrantChoice[] {
  if (approval.capabilities.some((capability) => requiresPerActionApproval(capability))) {
    return ["once"];
  }
  if (approval.sessionId === null) return ["once", "permanent"];
  return ["once", "session", "permanent"];
}

export function approvalDecision(
  approval: Pick<AppApproval, "id" | "actionDigest">,
  choice: CardChoice,
): PermissionDecisionRequest {
  if (choice === "deny") {
    return {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "denied",
      scope: "once",
    };
  }
  if (choice === "session") {
    return {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "session",
      maxUses: SESSION_USES,
      ttlMinutes: SESSION_MINUTES,
    };
  }
  return {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision: "approved",
    scope: choice,
  };
}

/** Grant scopes are contract values; only their labels are localized (D22). */
const CHOICE_LABEL_KEYS: Record<CardChoice, MessageKey> = {
  once: "shell.scopeOnce",
  session: "shell.scopeSession",
  permanent: "shell.scopeAlwaysAllow",
  deny: "permissions.deny",
};

function choiceLabel(choice: CardChoice): string {
  return t(CHOICE_LABEL_KEYS[choice]);
}

function capabilityLine(capabilities: readonly CapabilityId[]): string {
  return capabilities.map(capabilityLabel).join(t("d22.listSeparator"));
}

export function PermissionChatCards(props: {
  botId: string;
  /**
   * D22: pending approvals drive the tray status dot and raise a system
   * notification, so the owner of the bot view needs this count.
   */
  onPendingCount?: (count: number) => void;
}): JSX.Element | null {
  // Each bot owns its component lifetime: a completed request from a closed
  // chat must never replace the next bot's approval cards or notices.
  return <BotPermissionChatCards key={props.botId} {...props} />;
}

/** Notices are stored as a message key, never as rendered text (D22). */
type Notice = { key: MessageKey; params?: readonly (string | number)[] };

function BotPermissionChatCards(props: {
  botId: string;
  onPendingCount?: (count: number) => void;
}): JSX.Element | null {
  const { botId, onPendingCount } = props;
  // Re-renders on a language switch: the stored notice is a message key.
  useLanguage();
  const [approvals, setApprovals] = useState<AppApproval[] | null>(null);
  const [grants, setGrants] = useState<PermissionGrant[] | null>(null);
  const [policies, setPolicies] = useState<CapabilityPolicy[] | null>(null);
  const [selected, setSelected] = useState<CapabilityId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [grantNotice, setGrantNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const active = useRef(true);
  const loadSequence = useRef(0);
  const eligible = useMemo(
    () => (policies === null ? [] : chatGrantCapabilities(policies)),
    [policies],
  );

  useEffect(() => {
    setSelected((current) =>
      current !== null && eligible.includes(current) ? current : (eligible[0] ?? null),
    );
  }, [eligible]);

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const [approvalResult, grantResult, policyResult] = await Promise.allSettled([
      window.deepseekBot.host.call("permission.approval.list", { botId }),
      window.deepseekBot.host.call("permission.grant.list", { botId }),
      window.deepseekBot.host.call("permission.policy.list", {}),
    ]);
    if (!active.current || sequence !== loadSequence.current) return;
    if (approvalResult.status === "fulfilled") {
      try {
        const parsed = PERMISSION_METHODS["permission.approval.list"].response.parse(
          approvalResult.value,
        );
        setApprovals(
          parsed.approvals.filter(
            (approval) => approval.status === "pending" && approval.botId === botId,
          ),
        );
        setNotice((current) =>
          current?.key === "permissions.approvalListLoadFailed" ? null : current,
        );
      } catch {
        setNotice({ key: "permissions.approvalListLoadFailed" });
      }
    } else {
      setNotice({ key: "permissions.approvalListLoadFailed" });
    }
    if (grantResult.status === "fulfilled" && policyResult.status === "fulfilled") {
      try {
        const parsedGrants = PERMISSION_METHODS["permission.grant.list"].response.parse(
          grantResult.value,
        );
        const parsedPolicies = PERMISSION_METHODS["permission.policy.list"].response.parse(
          policyResult.value,
        );
        setGrants(
          parsedGrants.grants.filter(
            (grant) => grant.botId === botId && grant.revokedAt === null && isRevocableGrant(grant),
          ),
        );
        setPolicies(parsedPolicies.policies);
        setGrantNotice((current) =>
          current?.key === "permissions.chatGrantLoadFailed" ? null : current,
        );
      } catch {
        setGrantNotice({ key: "permissions.chatGrantLoadFailed" });
      }
    } else {
      setGrantNotice({ key: "permissions.chatGrantLoadFailed" });
    }
  }, [botId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice({ key: "permissions.approvalListLoadFailed" });
      });
    };
    run();
    const timer = setInterval(run, 4_000);
    return () => {
      active.current = false;
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    onPendingCount?.(approvals?.length ?? 0);
  }, [approvals, onPendingCount]);

  const choose = (approval: AppApproval, choice: CardChoice): void => {
    setBusyId(approval.id);
    void window.deepseekBot.host
      .call("permission.approval.decide", approvalDecision(approval, choice))
      .then((response) => {
        PERMISSION_METHODS["permission.approval.decide"].response.parse(response);
        if (!active.current) return;
        setNotice(
          choice === "deny"
            ? { key: "permissions.denied" }
            : { key: "permissions.approvedLine", params: [choiceLabel(choice)] },
        );
        return load();
      })
      .catch(() => {
        if (active.current) setNotice({ key: "permissions.decisionFailed" });
      })
      .finally(() => {
        if (active.current) setBusyId(null);
      });
  };

  const grantCapability = (scope: "session" | "permanent"): void => {
    if (selected === null || grantBusy) return;
    const capability = selected;
    setGrantBusy(true);
    void window.deepseekBot.host
      .call("permission.grant.issue", { botId, capability, scope })
      .then((response) => {
        PERMISSION_METHODS["permission.grant.issue"].response.parse(response);
        if (!active.current) return;
        setGrantNotice({
          key: "permissions.chatGrantIssued",
          params: [capabilityLabel(capability)],
        });
        return load();
      })
      .catch(() => {
        if (active.current) setGrantNotice({ key: "permissions.chatGrantFailed" });
      })
      .finally(() => {
        if (active.current) setGrantBusy(false);
      });
  };

  const revokeGrant = (grantId: string): void => {
    if (grantBusy) return;
    setGrantBusy(true);
    void window.deepseekBot.host
      .call("permission.grant.revoke", { grantId })
      .then((response) => {
        PERMISSION_METHODS["permission.grant.revoke"].response.parse(response);
        if (!active.current) return;
        setGrantNotice({ key: "permissions.grantRevoked" });
        return load();
      })
      .catch(() => {
        if (active.current) setGrantNotice({ key: "permissions.revokeFailed" });
      })
      .finally(() => {
        if (active.current) setGrantBusy(false);
      });
  };

  const showGrant = grants !== null && policies !== null;
  if (
    (approvals === null || approvals.length === 0) &&
    notice === null &&
    !showGrant &&
    grantNotice === null
  ) {
    return null;
  }

  return (
    <div className="permission-chat-cards">
      {approvals?.map((approval) => {
        const choices = approvalChoices(approval);
        const preview =
          approval.tool === "mcp_call"
            ? {
                connectorName: approval.params.connectorName,
                endpoint: approval.params.endpoint,
                toolName: approval.params.toolName,
                arguments: approval.params.arguments,
              }
            : approval.params;
        return (
          <div
            key={approval.id}
            className="choice-card"
            role="group"
            aria-label={t("permissions.approvalFor", [approval.tool])}
          >
            <div className="choice-question">{t("permissions.allowQuestion")}</div>
            <p className="choice-answered">{t("permissions.requestLine", [approval.tool])}</p>
            <p className="choice-answered">
              {t("permissions.capabilitiesLine", [capabilityLine(approval.capabilities)])}
            </p>
            <p className="choice-answered">{t("permissions.pendingParamsLabel")}</p>
            <pre className="permission-params" aria-label={t("permissions.pendingParamsAria")}>
              {JSON.stringify(preview, null, 2)}
            </pre>
            <p className="choice-answered">{t("permissions.onceGrant", [approval.expiresAt])}</p>
            {choices.includes("session") ? (
              <p className="choice-answered">
                {t("permissions.sessionGrant", [SESSION_USES, SESSION_MINUTES / 60])}
              </p>
            ) : null}
            {choices.includes("permanent") ? (
              <p className="choice-answered">{t("permissions.permanentGrant")}</p>
            ) : null}
            <div className="choice-options">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="choice-option"
                  disabled={busyId === approval.id}
                  onClick={() => choose(approval, choice)}
                >
                  {choiceLabel(choice)}
                </button>
              ))}
              <button
                type="button"
                className="choice-option"
                disabled={busyId === approval.id}
                onClick={() => choose(approval, "deny")}
              >
                {choiceLabel("deny")}
              </button>
            </div>
          </div>
        );
      })}
      {notice !== null ? <p className="sys-line">{t(notice.key, notice.params ?? [])}</p> : null}
      {showGrant ? (
        <section
          className="permission-chat-grant choice-card"
          aria-label={t("permissions.chatGrantTitle")}
        >
          <div className="choice-question">{t("permissions.chatGrantTitle")}</div>
          {selected !== null ? (
            <>
              <CustomSelect
                className="permission-chat-grant-capability"
                value={selected}
                options={eligible.map((capability) => ({
                  value: capability,
                  label: capabilityLabel(capability),
                }))}
                ariaLabel={t("permissions.chatGrantCapability")}
                disabled={grantBusy}
                onChange={(next) => {
                  if ((CAPABILITY_IDS as readonly string[]).includes(next)) {
                    setSelected(next as CapabilityId);
                  }
                }}
              />
              <p className="choice-answered">
                {t("permissions.sessionGrant", [SESSION_USES, SESSION_MINUTES / 60])}
              </p>
              <p className="choice-answered">{t("permissions.permanentGrant")}</p>
              <div className="choice-options">
                <button
                  type="button"
                  className="choice-option"
                  data-scope="session"
                  disabled={grantBusy}
                  onClick={() => grantCapability("session")}
                >
                  {t("permissions.chatGrantSession")}
                </button>
                <button
                  type="button"
                  className="choice-option"
                  data-scope="permanent"
                  disabled={grantBusy}
                  onClick={() => grantCapability("permanent")}
                >
                  {t("permissions.chatGrantPermanent")}
                </button>
              </div>
            </>
          ) : null}
          {grants?.filter(isRevocableGrant).map((grant) => (
            <div className="choice-options" key={grant.id}>
              <p className="choice-answered">
                {capabilityLabel(grant.capability)} · {t(GRANT_SCOPE_LABEL_KEYS[grant.scope])}
              </p>
              <button
                type="button"
                className="choice-option"
                data-grant-id={grant.id}
                disabled={grantBusy}
                onClick={() => revokeGrant(grant.id)}
              >
                {t("permissions.revoke")}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {grantNotice !== null ? (
        <p className="sys-line">{t(grantNotice.key, grantNotice.params ?? [])}</p>
      ) : null}
    </div>
  );
}
