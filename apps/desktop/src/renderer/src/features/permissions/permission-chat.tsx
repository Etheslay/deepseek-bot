/**
 * Chat authorization cards for pending D16 approvals.
 * Lists permission.approval.list for the open bot and decides through
 * permission.approval.decide. Once / session / permanent follow the contract:
 * per-action capabilities and missing sessions cannot take a longer grant.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  PERMISSION_METHODS,
  requiresPerActionApproval,
  type AppApproval,
  type CapabilityId,
  type PermissionDecisionRequest,
} from "@deepseek-bot/contracts";
import { t, useLanguage, type MessageKey } from "../../i18n.js";
import { capabilityLabel } from "./capability-labels.js";

const SESSION_USES = 5;
const SESSION_MINUTES = 120;

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = useRef(true);
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const response = await window.deepseekBot.host.call("permission.approval.list", { botId });
    const parsed = PERMISSION_METHODS["permission.approval.list"].response.parse(response);
    if (!active.current || sequence !== loadSequence.current) return;
    setApprovals(
      parsed.approvals.filter(
        (approval) => approval.status === "pending" && approval.botId === botId,
      ),
    );
    setNotice((current) =>
      current?.key === "permissions.approvalListLoadFailed" ? null : current,
    );
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

  if ((approvals === null || approvals.length === 0) && notice === null) return null;

  return (
    <div className="permission-chat-cards">
      {approvals?.map((approval) => {
        const choices = approvalChoices(approval);
        const preview = approval.tool === "mcp_call"
          ? { connectorName: approval.params.connectorName, endpoint: approval.params.endpoint, toolName: approval.params.toolName, arguments: approval.params.arguments }
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
    </div>
  );
}
