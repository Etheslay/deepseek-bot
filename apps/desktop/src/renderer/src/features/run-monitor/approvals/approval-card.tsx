/**
 * Approval card (D09 brief §2.1 approvals/, FR-06): shows the EXACT action
 * parameters — actionDigest + the target resource — so the operator sees
 * what will happen before allowing it. Allow/deny call approval.decide;
 * expired, generation-stale and already-decided approvals show their refusal
 * reason and the buttons stay disabled (one-shot consumption, no replay).
 */
import { useState, type JSX } from "react";
import type { ApprovalBaseline } from "../events/run-view.js";
import {
  approvalDecidable,
  approvalDecisionFromStatus,
  approvalTtlCopy,
  approvalTtlLabel,
} from "../events/run-view.js";
import { formatFullDateTime, t } from "../../../i18n.js";

/** Resolved decisions are contract data; only the label is localized (D22). */
function decisionLabel(decision: string): string {
  switch (decision) {
    case "approved":
      return t("runs.approved");
    case "denied":
      return t("permissions.denied");
    case "expired":
      return t("runs.expired");
    default:
      return decision;
  }
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…${digest.slice(-8)}`;
}

export function ApprovalCard(props: {
  baseline: ApprovalBaseline;
  onDecide: (
    baseline: ApprovalBaseline,
    decision: "approved" | "denied",
  ) => Promise<void>;
}): JSX.Element {
  const { baseline, onDecide } = props;
  const { approval, resolved, invalidReason } = baseline;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const decidable = approvalDecidable(baseline) && !busy;

  const decide = async (decision: "approved" | "denied"): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await onDecide(baseline, decision);
      setNote(
        decision === "approved"
          ? t("runs.approvedAwaitingExecution")
          : t("runs.deniedStopDescendants"),
      );
    } catch (error) {
      // Refusals are informative: consumed / expired / generation-stale.
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const stateLine = (): string => {
    if (invalidReason === "generation") {
      return t("runs.invalidatedByGeneration");
    }
    if (invalidReason === "expired") {
      return t("runs.expired");
    }
    if (resolved !== undefined) {
      return t("runs.decidedOnceNoReplay", [decisionLabel(resolved.decision)]);
    }
    // Host-backed runs expose only the terminal status; derive the same
    // one-shot copy instead of showing a live countdown on a decided approval.
    const settled = approvalDecisionFromStatus(approval.status);
    if (settled !== undefined) {
      return t("runs.decidedOnceNoReplay", [decisionLabel(settled)]);
    }
    return approvalTtlLabel(baseline);
  };

  return (
    <div
      className={
        "rm-approval-card" +
        (approvalDecidable(baseline) ? " pending" : " settled")
      }
      role="group"
      aria-label={t("runs.approvalAriaLabel", [approval.id])}
    >
      <div className="rm-approval-head">
        <span className="rm-approval-title">{t("runs.approvalRequest")}</span>
        <span className="rm-approval-ttl">{stateLine()}</span>
      </div>
      <dl className="rm-approval-params">
        <div className="rm-param">
          <dt>{t("runs.actionDigestLabel")}</dt>
          <dd className="rm-digest" title={approval.actionDigest}>
            {shortDigest(approval.actionDigest)}
          </dd>
        </div>
        <div className="rm-param">
          <dt>{t("runs.targetResource")}</dt>
          <dd className="rm-resource">{approval.resource}</dd>
        </div>
        <div className="rm-param">
          <dt>{t("runs.validUntil")}</dt>
          <dd>
            {t("runs.expiresAtWithDefaultTtl", [formatFullDateTime(approval.expiresAt), approvalTtlCopy()])}
          </dd>
        </div>
        <div className="rm-param">
          <dt>{t("runs.owningRunNode")}</dt>
          <dd>
            run {approval.runId.slice(0, 8)} · nodeRun {approval.nodeRunId.slice(0, 8)}
          </dd>
        </div>
      </dl>
      <div className="rm-approval-actions" role="group" aria-label={t("runs.approvalActions")}>
        <button
          type="button"
          className="primary-btn rm-approve-btn"
          disabled={!decidable}
          onClick={() => void decide("approved")}
        >
          {t("runs.allow")}
        </button>
        <button
          type="button"
          className="danger-btn rm-deny-btn"
          disabled={!decidable}
          onClick={() => void decide("denied")}
        >
          {t("permissions.deny")}
        </button>
        <span className="rm-approval-note" role="status">
          {note ?? (resolved ? t("runs.decidedAt", [formatFullDateTime(resolved.resolvedAt)]) : "")}
        </span>
      </div>
    </div>
  );
}

/** Inbox summary row for approvals of runs other than the selected one. */
export function ApprovalInboxItem(props: {
  baseline: ApprovalBaseline;
  onOpen: (runId: string) => void;
}): JSX.Element {
  const { baseline, onOpen } = props;
  const { approval } = baseline;
  const settled = approvalDecisionFromStatus(approval.status);
  return (
    <button
      type="button"
      className="rm-inbox-item"
      onClick={() => onOpen(approval.runId)}
    >
      <span className="rm-inbox-state">
        {baseline.resolved
          ? decisionLabel(baseline.resolved.decision)
          : settled !== undefined
            ? decisionLabel(settled)
            : baseline.invalidReason === "generation"
              ? t("runs.invalidatedGeneration")
              : baseline.invalidReason === "expired"
                ? t("runs.expired")
                : t("runs.pendingDecision")}
      </span>
      <span className="rm-inbox-res">{approval.resource}</span>
      <span className="rm-inbox-run">run {approval.runId.slice(0, 8)}</span>
    </button>
  );
}
