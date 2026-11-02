/**
 * Run detail — monitor tab (D09 brief §2.1 run-detail/): node status over the
 * contracts state machine, the event stream tail with dedupe counters and
 * snapshot/gap handling, cancel (cancelling → cancelled), the approvals of
 * this run, retryNode entries on failed attempts, and the transient
 * assistant.delta area (瞬态流 — no persistent sequence, never replayed).
 */
import type { JSX } from "react";
import type { AssistantDelta } from "@deepseek-bot/contracts";
import type { EventStreamState } from "../events/event-stream.js";
import {
  canCancelRun,
  retryableNodeRuns,
  type RunView,
} from "../events/run-view.js";
import { ApprovalCard } from "../approvals/approval-card.js";
import type { ApprovalBaseline } from "../events/run-view.js";
import { runStatusLabel } from "../run-list/run-list.js";
import { formatTime, t, type MessageKey } from "../../../i18n.js";

const NODE_STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  pending: "runs.nodePending",
  running: "runs.statusRunning",
  waiting_approval: "chat.awaitingApproval",
  succeeded: "runs.statusSucceeded",
  failed: "runs.statusFailed",
  cancelled: "runs.statusCancelled",
  skipped: "runs.nodeSkipped",
  interrupted: "runs.statusInterrupted",
};

function nodeStatusLabel(status: string): string {
  const key = NODE_STATUS_LABEL_KEYS[status];
  return key === undefined ? status : t(key);
}

export function RunDetail(props: {
  view: RunView;
  stream: EventStreamState | null;
  transient: AssistantDelta[];
  onDecide: (
    baseline: ApprovalBaseline,
    decision: "approved" | "denied",
  ) => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: (nodeRunId: string) => Promise<void>;
  onAdvance: () => Promise<void>;
  onReconnect: () => Promise<void>;
  onRebuild: () => void;
  /** Fixture playback controls only apply when runs come from the fixture. */
  fixturePlayback: boolean;
}): JSX.Element {
  const {
    view,
    stream,
    transient,
    onDecide,
    onCancel,
    onRetry,
    onAdvance,
    onReconnect,
    onRebuild,
    fixturePlayback,
  } = props;

  const cancellable = canCancelRun(view);
  const retryables = retryableNodeRuns(view);
  const retryableIds = new Set(retryables.map((entry) => entry.nodeRunId));

  return (
    <div className="rm-detail">
      <header className="rm-detail-head">
        <span className={`rm-status rm-status--${view.status}`}>
          {runStatusLabel(view.status)}
        </span>
        <span className="rm-detail-title">
          {view.run.workflowSnapshot.name}
          <code className="rm-run-id">run {view.run.id.slice(0, 8)}</code>
        </span>
        <button
          type="button"
          className="danger-btn rm-cancel-btn"
          disabled={!cancellable}
          title={cancellable ? t("runs.cancelTransitionHint") : t("runs.cancelUnavailable")}
          onClick={() => void onCancel()}
        >
          {t("permissions.cancelRun")}
        </button>
      </header>

      {view.failure !== null && (
        <p className="rm-failure" role="alert">
          {t("runs.runFailed", [view.failure.errorCode, view.failure.reason])}
        </p>
      )}
      {view.status === "interrupted" && (
        <p className="rm-interrupted" role="alert">
          {t("runs.runInterrupted")}{view.interruptedReason ?? t("runs.hostProcessExited")}
        </p>
      )}
      {view.illegalTransitions.length > 0 && (
        <p className="rm-illegal" role="alert">
          {t("runs.illegalTransitions", [
            view.illegalTransitions.length,
            view.illegalTransitions
              .slice(0, 2)
              .map((item) => `（${item.entity} ${item.from} → ${item.to} @seq${item.sequence}）`)
              .join(""),
          ])}
        </p>
      )}

      {view.approvals.length > 0 && (
        <section className="rm-section" aria-label={t("runs.approval")}>
          <h4>{t("runs.approval")}</h4>
          {view.approvals.map((baseline) => (
            <ApprovalCard
              key={baseline.approval.id}
              baseline={baseline}
              onDecide={onDecide}
            />
          ))}
        </section>
      )}

      <section className="rm-section" aria-label={t("runs.nodeStatus")}>
        <h4>{t("runs.nodeStatusSection")}</h4>
        <ul className="rm-nodes">
          {view.nodes.map((node) => (
            <li key={node.nodeId} className="rm-node">
              <div className="rm-node-head">
                <span className="rm-node-id">{node.nodeId}</span>
                <span className="rm-node-type">
                  {node.type === "approval" ? t("runs.approvalNode") : t("runs.botNode")}
                </span>
              </div>
              {node.runs.length === 0 && (
                <p className="rm-sub">{t("runs.nodeNotStarted")}</p>
              )}
              {node.runs.map((attempt) => (
                <div key={attempt.nodeRunId} className="rm-attempt">
                  <span className={`rm-status rm-status--${attempt.status}`}>
                    {nodeStatusLabel(attempt.status)}
                  </span>
                  <span className="rm-attempt-meta">
                    {t("runs.attemptMeta", [attempt.attempt, formatTime(attempt.lastChangedAt)])}
                  </span>
                  {attempt.reason !== null && (
                    <span className="rm-attempt-reason">{attempt.reason}</span>
                  )}
                  {retryableIds.has(attempt.nodeRunId) && (
                    <button
                      type="button"
                      className="pill-btn"
                      onClick={() => void onRetry(attempt.nodeRunId)}
                    >
                      {t("runs.retryNode")}
                    </button>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className="rm-section" aria-label={t("runs.eventStream")}>
        <h4>
          {t("runs.eventStream")}
          {stream !== null && (
            <span className="rm-stream-meta">
              {t("runs.streamDedupeMeta", [stream.duplicatesDropped, stream.lastSequence ?? "—"])}
            </span>
          )}
        </h4>
        {stream?.snapshotRequired === true && stream.rebuildCount === 0 && (
          <p className="rm-snapshot-note" role="alert">
            {stream.gap !== null
              ? t("runs.eventGapDetected", [stream.gap.missingFrom, stream.gap.missingTo])
              : t("runs.rangeBeyondRetention")}
            {t("runs.snapshotRequiredNote")}
            <button type="button" className="rm-link-btn" onClick={onRebuild}>
              {t("runs.rebuildFromSnapshot")}
            </button>
            。
          </p>
        )}
        <ol className="rm-timeline">
          {view.timeline.map((entry) => (
            <li key={`${entry.sequence}-${entry.type}`} className="rm-timeline-item">
              <span className="rm-timeline-seq">#{entry.sequence}</span>
              <span className="rm-timeline-time">
                {formatTime(entry.timestamp)}
              </span>
              <span className="rm-timeline-type">{entry.type}</span>
              <span className="rm-timeline-summary">{entry.summary}</span>
            </li>
          ))}
        </ol>
        {transient.length > 0 && (
          <div className="rm-transient" aria-label={t("runs.transientStream")}>
            <span className="rm-transient-label">
              {t("runs.transientStream")}
            </span>
            <p className="rm-transient-text">
              {transient.map((delta) => delta.textDelta ?? "").join("")}
            </p>
          </div>
        )}
      </section>

      {fixturePlayback && (
        <section className="rm-section rm-controls" aria-label={t("runs.fixtureControls")}>
          <h4>{t("runs.fixtureReplay")}</h4>
          <div className="rm-controls-row">
            <button type="button" className="pill-btn" onClick={() => void onAdvance()}>
              {t("runs.advanceStep")}
            </button>
            <button type="button" className="pill-btn" onClick={() => void onReconnect()}>
              {t("runs.simulateReconnect")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
