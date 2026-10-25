/**
 * Run list (D09 brief §2.1 run-list/): active + historical runs with status,
 * trigger, times and the workflow name/revision snapshot (FR-07). Roving
 * tabindex keeps switching runs fully keyboard operable (D9-13).
 */
import { useRef, useState, type JSX, type KeyboardEvent } from "react";
import type { Run } from "@deepseek-bot/contracts";
import { isRunTerminal } from "@deepseek-bot/contracts";

export const RUN_STATUS_LABELS: Record<Run["status"], string> = {
  queued: "排队中",
  running: "运行中",
  waiting_approval: "等待审批",
  cancelling: "取消中",
  succeeded: "已成功",
  failed: "已失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

function formatTime(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  return new Date(iso).toLocaleString();
}

export function RunList(props: {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}): JSX.Element {
  const { runs, selectedRunId, onSelect } = props;
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const activeRuns = runs.filter((run) => !isRunTerminal(run.status));
  const historyRuns = runs.filter((run) => isRunTerminal(run.status));

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = Math.min(Math.max(focusIndex + delta, 0), runs.length - 1);
    setFocusIndex(next);
    const item = listRef.current?.children[next]?.querySelector("button");
    if (item instanceof HTMLElement) {
      item.focus();
    }
  };

  const renderItem = (run: Run, index: number): JSX.Element => {
    const selected = run.id === selectedRunId;
    return (
      <li key={run.id}>
        <button
          type="button"
          className={"rm-run-item" + (selected ? " selected" : "")}
          aria-current={selected ? "true" : undefined}
          tabIndex={index === focusIndex ? 0 : -1}
          onClick={() => {
            setFocusIndex(index);
            onSelect(run.id);
          }}
        >
          <span className="rm-run-line">
            <span className={`rm-status rm-status--${run.status}`}>
              {RUN_STATUS_LABELS[run.status]}
            </span>
            <span className="rm-run-name">{run.workflowSnapshot.name}</span>
          </span>
          <span className="rm-run-meta">
            {run.trigger.kind === "manual" ? "手动" : "定时"} ·{" "}
            {formatTime(run.createdAt)}
            {run.resumedFromRunId !== undefined ? " · 恢复运行" : ""}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="rm-run-list" role="region" aria-label="运行列表">
      <div className="rm-list-head">运行（{runs.length}）</div>
      <ul className="rm-run-groups" ref={listRef} onKeyDown={onKeyDown} aria-label="运行条目">
        {activeRuns.length > 0 && (
          <li className="rm-group-label" aria-hidden="true">
            活跃
          </li>
        )}
        {activeRuns.map((run, index) => renderItem(run, index))}
        {historyRuns.length > 0 && (
          <li className="rm-group-label" aria-hidden="true">
            历史
          </li>
        )}
        {historyRuns.map((run, index) => renderItem(run, activeRuns.length + index))}
        {runs.length === 0 && <li className="rm-empty">暂无运行</li>}
      </ul>
    </div>
  );
}
