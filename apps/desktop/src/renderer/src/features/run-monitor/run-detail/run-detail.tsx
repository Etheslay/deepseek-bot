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
import { RUN_STATUS_LABELS } from "../run-list/run-list.js";

const NODE_STATUS_LABELS: Record<string, string> = {
  pending: "待运行",
  running: "运行中",
  waiting_approval: "等待审批",
  succeeded: "已成功",
  failed: "已失败",
  cancelled: "已取消",
  skipped: "已跳过",
  interrupted: "已中断",
};

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
  } = props;

  const cancellable = canCancelRun(view);
  const retryables = retryableNodeRuns(view);
  const retryableIds = new Set(retryables.map((entry) => entry.nodeRunId));

  return (
    <div className="rm-detail">
      <header className="rm-detail-head">
        <span className={`rm-status rm-status--${view.status}`}>
          {RUN_STATUS_LABELS[view.status]}
        </span>
        <span className="rm-detail-title">
          {view.run.workflowSnapshot.name}
          <code className="rm-run-id">run {view.run.id.slice(0, 8)}</code>
        </span>
        <button
          type="button"
          className="danger-btn rm-cancel-btn"
          disabled={!cancellable}
          title={cancellable ? "状态走 cancelling → cancelled" : "当前状态不可取消"}
          onClick={() => void onCancel()}
        >
          取消运行
        </button>
      </header>

      {view.failure !== null && (
        <p className="rm-failure" role="alert">
          运行失败（{view.failure.errorCode}）：{view.failure.reason}
        </p>
      )}
      {view.status === "interrupted" && (
        <p className="rm-interrupted" role="alert">
          运行中断：{view.interruptedReason ?? "Host 进程退出"}。恢复将以新 Run
          关联 resumedFromRunId，在「历史」标签可查看关联。
        </p>
      )}
      {view.illegalTransitions.length > 0 && (
        <p className="rm-illegal" role="alert">
          拒绝了 {view.illegalTransitions.length} 个非法状态迁移
          {view.illegalTransitions
            .slice(0, 2)
            .map(
              (item) =>
                `（${item.entity} ${item.from} → ${item.to} @seq${item.sequence}）`,
            )}
          ；契约状态机见 contracts/status.ts。
        </p>
      )}

      {view.approvals.length > 0 && (
        <section className="rm-section" aria-label="审批">
          <h4>审批</h4>
          {view.approvals.map((baseline) => (
            <ApprovalCard
              key={baseline.approval.id}
              baseline={baseline}
              onDecide={onDecide}
            />
          ))}
        </section>
      )}

      <section className="rm-section" aria-label="节点状态">
        <h4>节点状态（契约状态机）</h4>
        <ul className="rm-nodes">
          {view.nodes.map((node) => (
            <li key={node.nodeId} className="rm-node">
              <div className="rm-node-head">
                <span className="rm-node-id">{node.nodeId}</span>
                <span className="rm-node-type">
                  {node.type === "approval" ? "审批节点" : "Bot 节点"}
                </span>
              </div>
              {node.runs.length === 0 && (
                <p className="rm-sub">尚未启动（pending）</p>
              )}
              {node.runs.map((attempt) => (
                <div key={attempt.nodeRunId} className="rm-attempt">
                  <span className={`rm-status rm-status--${attempt.status}`}>
                    {NODE_STATUS_LABELS[attempt.status] ?? attempt.status}
                  </span>
                  <span className="rm-attempt-meta">
                    第 {attempt.attempt} 次 · {new Date(attempt.lastChangedAt).toLocaleTimeString()}
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
                      重试节点（新 attempt）
                    </button>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className="rm-section" aria-label="事件流">
        <h4>
          事件流
          {stream !== null && (
            <span className="rm-stream-meta">
              · 去重丢弃 {stream.duplicatesDropped} · lastSequence{" "}
              {stream.lastSequence ?? "—"}
            </span>
          )}
        </h4>
        {stream?.snapshotRequired === true && stream.rebuildCount === 0 && (
          <p className="rm-snapshot-note" role="alert">
            {stream.gap !== null
              ? `检测到事件缺口 seq ${stream.gap.missingFrom}–${stream.gap.missingTo}；`
              : "请求范围超出事件保留窗口；"}
            按契约返回 snapshotRequired——不假装补齐，
            <button type="button" className="rm-link-btn" onClick={onRebuild}>
              按快照重建视图
            </button>
            。
          </p>
        )}
        {stream !== null && stream.rebuildCount > 0 && (
          <p className="rm-sub">
            已按快照重建 {stream.rebuildCount} 次；保留窗口外的历史事件不可回放，
            新事件继续按 afterSequence 增量合并。
          </p>
        )}
        <ol className="rm-timeline">
          {view.timeline.map((entry) => (
            <li key={`${entry.sequence}-${entry.type}`} className="rm-timeline-item">
              <span className="rm-timeline-seq">#{entry.sequence}</span>
              <span className="rm-timeline-time">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="rm-timeline-type">{entry.type}</span>
              <span className="rm-timeline-summary">{entry.summary}</span>
            </li>
          ))}
        </ol>
        {transient.length > 0 && (
          <div className="rm-transient" aria-label="瞬态流">
            <span className="rm-transient-label">
              瞬态流 assistant.delta（streamId/chunkIndex，不占持久 sequence，不重放）
            </span>
            <p className="rm-transient-text">
              {transient.map((delta) => delta.textDelta ?? "").join("")}
            </p>
          </div>
        )}
      </section>

      <section className="rm-section rm-controls" aria-label="夹具回放控制">
        <h4>夹具回放（非真实引擎）</h4>
        <div className="rm-controls-row">
          <button type="button" className="pill-btn" onClick={() => void onAdvance()}>
            推进下一步
          </button>
          <button type="button" className="pill-btn" onClick={() => void onReconnect()}>
            模拟断线重连（afterSequence 增量补齐）
          </button>
        </div>
        <p className="rm-sub">
          事件由 D03 契约夹具剧本生成；真实引擎（D06）、后端审批拦截（D08）、持久化（D04）未接入。
        </p>
      </section>
    </div>
  );
}
