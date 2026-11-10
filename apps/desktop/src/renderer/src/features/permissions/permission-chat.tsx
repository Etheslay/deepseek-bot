/**
 * Chat authorization for the open bot, Grok-style (参考图二/图三):
 * each pending request is one card — capability header, bot name, scope
 * note, the exact parameter preview and three actions 从不 / 始终允许 /
 * 允许一次. Per-action capabilities (exec.shell, screen.capture, …) only
 * ever offer 从不 / 允许一次: the contract forbids lasting grants for
 * them. Once decided, the card disappears and only a left-aligned status
 * line remains ({bot} 本次可以… / 已始终允许… / 已拒绝…); the session scope
 * remains a contract value (approvalDecision) but is no longer a card
 * button. Proactive grants, policy edits and revocation live in
 * Settings → Permissions.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { pinSlotOrder, useTimelineTimes } from "../chat/timeline.js";
import {
  PERMISSION_METHODS,
  requiresPerActionApproval,
  type AppApproval,
  type CapabilityId,
  type PermissionDecisionRequest,
} from "@deepseek-bot/contracts";
import { t, useLanguage, type MessageKey } from "../../i18n.js";
import { capabilityGlyph, capabilityLabel } from "./capability-labels.js";

const SESSION_USES = 5;
const SESSION_MINUTES = 120;

type GrantChoice = "once" | "session" | "permanent";
type CardChoice = GrantChoice | "deny";

export function approvalChoices(
  approval: Pick<AppApproval, "capabilities">,
): GrantChoice[] {
  if (approval.capabilities.some((capability) => requiresPerActionApproval(capability))) {
    return ["once"];
  }
  return ["once", "permanent"];
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

function capabilityLine(capabilities: readonly CapabilityId[]): string {
  return capabilities.map(capabilityLabel).join(t("d22.listSeparator"));
}

export function PermissionChatCards(props: {
  botId: string;
  /** Grok-style card copy names the bot (图二/图三). */
  botName: string;
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

type ResolvedCard = { approval: AppApproval; choice: CardChoice };

function ApprovalCard(props: {
  approval: AppApproval;
  botName: string;
  order: number;
  busy?: boolean;
  onDecide?: (approval: AppApproval, choice: CardChoice) => void;
  onDismiss?: (approvalId: string) => void;
}): JSX.Element {
  const { approval, botName, order, busy, onDecide, onDismiss } = props;
  const capabilities = capabilityLine(approval.capabilities);
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
    <div className="approval-card" style={{ order }} aria-label={t("permissions.approvalFor", [approval.tool])}>
      <div className="approval-head">
        <span className="approval-glyph" aria-hidden="true">
          {capabilityGlyph(approval.capabilities)}
        </span>
        <span className="approval-cap">{capabilities}</span>
        {onDismiss !== undefined && (
          <button
            type="button"
            className="approval-close"
            aria-label={t("permissions.dismissApproval")}
            onClick={() => onDismiss(approval.id)}
          >
            ×
          </button>
        )}
      </div>
      <p className="approval-title">
        {t("permissions.allowTitle", [botName, capabilities])}
      </p>
      <p className="approval-bot">{botName}</p>
      <pre className="permission-params" aria-label={t("permissions.pendingParamsAria")}>
        {JSON.stringify(preview, null, 2)}
      </pre>
      {onDecide !== undefined && (
        <div className="approval-actions" role="group" aria-label={t("permissions.approvalFor", [approval.tool])}>
          <button
            type="button"
            className="approval-btn ghost"
            disabled={busy === true}
            onClick={() => onDecide(approval, "deny")}
          >
            {t("permissions.never")}
          </button>
          {approvalChoices(approval).includes("permanent") && (
            <button
              type="button"
              className="approval-btn dark"
              disabled={busy === true}
              onClick={() => onDecide(approval, "permanent")}
            >
              {t("permissions.alwaysAllow")}
            </button>
          )}
          <button
            type="button"
            className="approval-btn light"
            disabled={busy === true}
            onClick={() => onDecide(approval, "once")}
          >
            {t("permissions.allowOnce")}
          </button>
        </div>
      )}
    </div>
  );
}

function BotPermissionChatCards(props: {
  botId: string;
  botName: string;
  onPendingCount?: (count: number) => void;
}): JSX.Element | null {
  const { botId, botName, onPendingCount } = props;
  // Re-renders on a language switch: the stored notice is a message key.
  useLanguage();
  const [approvals, setApprovals] = useState<AppApproval[] | null>(null);
  const [resolved, setResolved] = useState<ResolvedCard[]>([]);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = useRef(true);
  const loadSequence = useRef(0);
  const noticeAt = useRef<number | null>(null);
  const times = useTimelineTimes();

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    try {
      const response = await window.deepseekBot.host.call("permission.approval.list", { botId });
      if (!active.current || sequence !== loadSequence.current) return;
      const parsed = PERMISSION_METHODS["permission.approval.list"].response.parse(response);
      setApprovals(
        parsed.approvals.filter(
          (approval) => approval.status === "pending" && approval.botId === botId,
        ),
      );
      setNotice((current) =>
        current?.key === "permissions.approvalListLoadFailed" ? null : current,
      );
    } catch {
      if (!active.current || sequence !== loadSequence.current) return;
      setNotice({ key: "permissions.approvalListLoadFailed" });
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

  const pendingVisible = (approvals ?? []).filter(
    (approval) => approval.status === "pending" && !hidden.includes(approval.id),
  );

  useEffect(() => {
    onPendingCount?.(pendingVisible.length);
  }, [pendingVisible, onPendingCount]);

  const choose = (approval: AppApproval, choice: CardChoice): void => {
    setBusyId(approval.id);
    void window.deepseekBot.host
      .call("permission.approval.decide", approvalDecision(approval, choice))
      .then((response) => {
        PERMISSION_METHODS["permission.approval.decide"].response.parse(response);
        if (!active.current) return;
        // 图三：the card settles in place under a centred status line.
        setResolved((prev) => [...prev, { approval, choice }]);
        setHidden((prev) => [...prev, approval.id]);
        return load();
      })
      .catch(() => {
        if (active.current) setNotice({ key: "permissions.decisionFailed" });
      })
      .finally(() => {
        if (active.current) setBusyId(null);
      });
  };

  const dismiss = (approvalId: string): void => {
    setHidden((prev) => [...prev, approvalId]);
    setResolved((prev) => prev.filter((card) => card.approval.id !== approvalId));
  };

  const noticeAnchor = (): number => {
    if (noticeAt.current === null) noticeAt.current = Date.now();
    return noticeAt.current;
  };

  if (
    (approvals === null || pendingVisible.length === 0) &&
    resolved.length === 0 &&
    notice === null
  ) {
    return null;
  }

  return (
    <div className="permission-chat-cards">
      {pendingVisible.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          botName={botName}
          order={pinSlotOrder(times, Date.parse(approval.createdAt))}
          busy={busyId === approval.id}
          onDecide={choose}
          onDismiss={dismiss}
        />
      ))}
      {resolved.map(({ approval, choice }) => (
        <p
          key={approval.id}
          className="sys-line"
          style={{ order: pinSlotOrder(times, Date.parse(approval.createdAt)) }}
        >
          {choice === "deny"
            ? t("permissions.grantedDeniedLine", [botName, capabilityLine(approval.capabilities)])
            : choice === "permanent"
              ? t("permissions.grantedPermanentLine", [
                  botName,
                  capabilityLine(approval.capabilities),
                ])
              : t("permissions.grantedOnceLine", [
                  botName,
                  capabilityLine(approval.capabilities),
                ])}
        </p>
      ))}
      {notice !== null ? (
        <p className="sys-line" style={{ order: pinSlotOrder(times, noticeAnchor()) }}>
          {t(notice.key, notice.params ?? [])}
        </p>
      ) : null}
    </div>
  );
}
