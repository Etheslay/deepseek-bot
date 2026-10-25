/**
 * Approval card (D09 brief §2.1 approvals/, FR-06): shows the EXACT action
 * parameters — actionDigest + the target resource — so the operator sees
 * what will happen before allowing it. Allow/deny call approval.decide;
 * expired, generation-stale and already-decided approvals show their refusal
 * reason and the buttons stay disabled (one-shot consumption, no replay).
 */
import { useState, type JSX } from "react";
import type { ApprovalBaseline } from "../events/run-view.js";
import { approvalDecidable, approvalTtlLabel, APPROVAL_TTL_COPY } from "../events/run-view.js";

const DECISION_LABELS: Record<string, string> = {
  approved: "已允许",
  denied: "已拒绝",
  expired: "已过期",
};

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
          ? "已允许（审批一次消费，等待执行）"
          : "已拒绝（stop-descendants，后继不再执行）",
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
      return "已失效（启动代次绑定）";
    }
    if (invalidReason === "expired") {
      return "已过期";
    }
    if (resolved !== undefined) {
      return `${DECISION_LABELS[resolved.decision] ?? resolved.decision}（一次消费，不可重放）`;
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
      aria-label={`审批 ${approval.id}`}
    >
      <div className="rm-approval-head">
        <span className="rm-approval-title">审批请求</span>
        <span className="rm-approval-ttl">{stateLine()}</span>
      </div>
      <dl className="rm-approval-params">
        <div className="rm-param">
          <dt>动作摘要（actionDigest）</dt>
          <dd className="rm-digest" title={approval.actionDigest}>
            {shortDigest(approval.actionDigest)}
          </dd>
        </div>
        <div className="rm-param">
          <dt>目标资源（将执行的写操作）</dt>
          <dd className="rm-resource">{approval.resource}</dd>
        </div>
        <div className="rm-param">
          <dt>有效期至</dt>
          <dd>
            {new Date(approval.expiresAt).toLocaleString()}（默认 {APPROVAL_TTL_COPY}）
          </dd>
        </div>
        <div className="rm-param">
          <dt>所属运行 / 节点</dt>
          <dd>
            run {approval.runId.slice(0, 8)} · nodeRun {approval.nodeRunId.slice(0, 8)}
          </dd>
        </div>
      </dl>
      <div className="rm-approval-actions" role="group" aria-label="审批操作">
        <button
          type="button"
          className="primary-btn rm-approve-btn"
          disabled={!decidable}
          onClick={() => void decide("approved")}
        >
          允许
        </button>
        <button
          type="button"
          className="danger-btn rm-deny-btn"
          disabled={!decidable}
          onClick={() => void decide("denied")}
        >
          拒绝
        </button>
        <span className="rm-approval-note" role="status">
          {note ?? (resolved ? `决定时间：${new Date(resolved.resolvedAt).toLocaleString()}` : "")}
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
  return (
    <button
      type="button"
      className="rm-inbox-item"
      onClick={() => onOpen(approval.runId)}
    >
      <span className="rm-inbox-state">
        {baseline.resolved
          ? (DECISION_LABELS[baseline.resolved.decision] ?? baseline.resolved.decision)
          : baseline.invalidReason === "generation"
            ? "已失效（代次）"
            : baseline.invalidReason === "expired"
              ? "已过期"
              : "待决定"}
      </span>
      <span className="rm-inbox-res">{approval.resource}</span>
      <span className="rm-inbox-run">run {approval.runId.slice(0, 8)}</span>
    </button>
  );
}
