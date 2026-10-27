/**
 * Run list (D09 brief §2.1 run-list/): active + historical runs with status,
 * trigger, times and the workflow name/revision snapshot (FR-07). Roving
 * tabindex keeps switching runs fully keyboard operable (D9-13).
 */
import { useRef, useState, type JSX, type KeyboardEvent } from "react";
import type { Run } from "@deepseek-bot/contracts";
import { isRunTerminal } from "@deepseek-bot/contracts";
import { formatFullDateTime, t, type MessageKey } from "../../../i18n.js";

/**
 * Run status labels are message keys, not strings: a module-level Chinese table
 * would freeze the language at import time (D22). `runStatusLabel()` reads the
 * live catalogue instead, so a language switch re-renders correctly.
 */
const RUN_STATUS_LABEL_KEYS: Record<Run["status"], MessageKey> = {
  queued: "runs.queued",
  running: "runs.statusRunning",
  waiting_approval: "chat.awaitingApproval",
  cancelling: "runs.cancelling",
  succeeded: "runs.statusSucceeded",
  failed: "runs.statusFailed",
  cancelled: "runs.statusCancelled",
  interrupted: "runs.statusInterrupted",
};

export function runStatusLabel(status: Run["status"]): string {
  return t(RUN_STATUS_LABEL_KEYS[status]);
}

function formatTime(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  return formatFullDateTime(iso);
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
              {runStatusLabel(run.status)}
            </span>
            <span className="rm-run-name">{run.workflowSnapshot.name}</span>
          </span>
          <span className="rm-run-meta">
            {run.trigger.kind === "manual" ? t("runs.triggerManual") : t("runs.triggerScheduled")} ·{" "}
            {formatTime(run.createdAt)}
            {run.resumedFromRunId !== undefined ? t("runs.resumedSuffix") : ""}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="rm-run-list" role="region" aria-label={t("runs.runList")}>
      <div className="rm-list-head">{t("runs.runCountHeader", [runs.length])}</div>
      <ul className="rm-run-groups" ref={listRef} onKeyDown={onKeyDown} aria-label={t("runs.runListItems")}>
        {activeRuns.length > 0 && (
          <li className="rm-group-label" aria-hidden="true">
            {t("runs.active")}
          </li>
        )}
        {activeRuns.map((run, index) => renderItem(run, index))}
        {historyRuns.length > 0 && (
          <li className="rm-group-label" aria-hidden="true">
            {t("runs.history")}
          </li>
        )}
        {historyRuns.map((run, index) => renderItem(run, activeRuns.length + index))}
        {runs.length === 0 && <li className="rm-empty">{t("runs.noRuns")}</li>}
      </ul>
    </div>
  );
}
