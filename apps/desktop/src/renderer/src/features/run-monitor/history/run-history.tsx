/**
 * Run history tab (D09 brief §2.1 history/, FR-07): the immutable workflow
 * version snapshot, bot snapshots, artifacts with checksums, and the Harness
 * sessionId entry per node attempt. Interrupted runs show the interruption
 * reason and a pointer to the recovery run (`resumedFromRunId`).
 */
import type { JSX } from "react";
import type { RunView } from "../events/run-view.js";
import { RUN_STATUS_LABELS } from "../run-list/run-list.js";

function formatBytes(size: number): string {
  return `${size} B`;
}

export function RunHistory(props: {
  view: RunView;
  onOpenRun: (runId: string) => void;
}): JSX.Element {
  const { view, onOpenRun } = props;
  const run = view.run;
  const snapshot = run.workflowSnapshot;
  const resumedFrom = run.resumedFromRunId;

  return (
    <div className="rm-history">
      <section className="rm-history-section" aria-label="版本快照">
        <h4>版本快照（workflowSnapshot）</h4>
        <dl className="rm-kv">
          <div className="rm-kv-row">
            <dt>名称</dt>
            <dd>{snapshot.name}</dd>
          </div>
          <div className="rm-kv-row">
            <dt>工作流 / 版本</dt>
            <dd>
              {snapshot.id.slice(0, 8)} · {snapshot.revision.slice(0, 8)}
            </dd>
          </div>
          <div className="rm-kv-row">
            <dt>schemaVersion</dt>
            <dd>{snapshot.schemaVersion}</dd>
          </div>
          <div className="rm-kv-row">
            <dt>节点 / 边</dt>
            <dd>
              {snapshot.nodes.length} 节点 · {snapshot.edges.length} 边
            </dd>
          </div>
          <div className="rm-kv-row">
            <dt>触发</dt>
            <dd>
              {run.trigger.kind === "manual" ? "手动" : "定时"} ·{" "}
              {new Date(run.createdAt).toLocaleString()}
            </dd>
          </div>
          <div className="rm-kv-row">
            <dt>结束</dt>
            <dd>
              {run.finishedAt !== null
                ? `${new Date(run.finishedAt).toLocaleString()}（${RUN_STATUS_LABELS[run.status]}）`
                : "未结束"}
            </dd>
          </div>
        </dl>
        {run.botSnapshots.length > 0 && (
          <p className="rm-sub">
            Bot 快照：{run.botSnapshots.map((bot) => bot.name).join("、")}
          </p>
        )}
      </section>

      <section className="rm-history-section" aria-label="产物">
        <h4>产物（Artifact）</h4>
        {view.artifacts.length === 0 && <p className="rm-sub">暂无产物</p>}
        {view.artifacts.length > 0 && (
          <table className="rm-artifact-table">
            <thead>
              <tr>
                <th scope="col">路径</th>
                <th scope="col">类型</th>
                <th scope="col">大小</th>
                <th scope="col">sha256</th>
              </tr>
            </thead>
            <tbody>
              {view.artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td>{artifact.relativePath}</td>
                  <td>{artifact.mediaType}</td>
                  <td>{formatBytes(artifact.size)}</td>
                  <td className="rm-digest" title={artifact.checksum.value}>
                    {artifact.checksum.value.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rm-history-section" aria-label="Harness 会话定位">
        <h4>Harness 会话定位</h4>
        <ul className="rm-session-list">
          {view.nodes.flatMap((node) =>
            node.runs
              .filter((attempt) => attempt.sessionId !== null)
              .map((attempt) => (
                <li key={attempt.nodeRunId}>
                  节点 {node.nodeId}（第 {attempt.attempt} 次）：
                  <code className="rm-session-id">{attempt.sessionId}</code>
                </li>
              )),
          )}
        </ul>
        <p className="rm-sub">
          会话定位入口仅展示 ID；跳转到真实 Harness 会话在 D12 集成后提供。
        </p>
      </section>

      {(resumedFrom !== undefined || view.status === "interrupted") && (
        <section className="rm-history-section" aria-label="中断与恢复">
          <h4>中断与恢复</h4>
          {view.status === "interrupted" && (
            <p className="rm-sub">
              中断原因：{view.interruptedReason ?? "Host 进程退出"}。恢复将以新 Run
              关联 resumedFromRunId，原运行不会回到 running。
            </p>
          )}
          {resumedFrom !== undefined && (
            <p className="rm-sub">
              本运行恢复自{" "}
              <button
                type="button"
                className="rm-link-btn"
                onClick={() => onOpenRun(resumedFrom)}
              >
                run {resumedFrom.slice(0, 8)}
              </button>
              （resumedFromRunId）。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
