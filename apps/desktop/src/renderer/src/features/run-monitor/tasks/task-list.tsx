/**
 * 任务页签 (v0.5 T5, FR-6): dispatched-task list with status filter, relay
 * chain coordinates (跳 x/y) and the human cancel button. Rows are plain
 * buttons with roving tabindex like the run list, and every terminal row is
 * inert — only queued/running tasks can be cancelled.
 */
import { useMemo, useState, type JSX } from "react";
import type { Bot, Task, TaskStatus } from "@deepseek-bot/contracts";
import { t, useLanguage, type MessageKey } from "../../../i18n.js";

/* Status labels live in module tables, so they are read through accessors (D22). */
const TASK_STATUS_KEYS: Record<TaskStatus, MessageKey> = {
  queued: "runs.queued",
  running: "shell.toolRunning",
  done: "shell.toolCompleted",
  failed: "runs.statusFailed",
  cancelled: "runs.statusCancelled",
  skipped: "runs.nodeSkipped",
  interrupted: "runs.statusInterrupted",
};

export function taskStatusLabel(status: TaskStatus): string {
  return t(TASK_STATUS_KEYS[status]);
}

const FILTERS: Array<{ value: TaskStatus | "all"; labelKey: MessageKey }> = [
  { value: "all", labelKey: "tasks.filterAll" },
  { value: "queued", labelKey: "runs.queued" },
  { value: "running", labelKey: "shell.toolRunning" },
  { value: "done", labelKey: "shell.toolCompleted" },
  { value: "failed", labelKey: "runs.statusFailed" },
  { value: "skipped", labelKey: "runs.nodeSkipped" },
  { value: "interrupted", labelKey: "runs.statusInterrupted" },
];

export function TaskList(props: {
  tasks: Task[];
  bots: Bot[];
  onCancel: (taskId: string) => void;
  cancelBusyId?: string | null;
}): JSX.Element {
  useLanguage();
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const nameOf = useMemo(() => {
    const byId = new Map(props.bots.map((bot) => [bot.id, bot.name]));
    return (botId: string): string => byId.get(botId) ?? botId.slice(0, 8);
  }, [props.bots]);
  const visible = props.tasks.filter(
    (task) => filter === "all" || task.status === filter,
  );

  return (
    <div className="task-list" role="tabpanel" aria-label={t("tasks.listAria")}>
      <div className="task-filters" role="group" aria-label={t("tasks.filterAria")}>
        {FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={"task-filter" + (filter === entry.value ? " active" : "")}
            aria-pressed={filter === entry.value}
            onClick={() => setFilter(entry.value)}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="task-empty">{t("tasks.empty")}</div>
      ) : (
        <ul className="task-rows">
          {visible.map((task) => {
            const cancellable = task.status === "queued" || task.status === "running";
            const busy = props.cancelBusyId === task.id;
            return (
              <li className="task-row" key={task.id}>
                <span className={`task-status task-status--${task.status}`}>
                  {taskStatusLabel(task.status)}
                </span>
                {task.chainTotal > 1 && (
                  <span
                    className="task-hop"
                    title={t("tasks.chainHopTitle", [task.chainIndex + 1, task.chainTotal])}
                  >
                    {t("tasks.chainHopShort", [task.chainIndex + 1, task.chainTotal])}
                  </span>
                )}
                <span className="task-route">
                  {nameOf(task.fromBotId)} → {nameOf(task.toBotId)}
                </span>
                <span className="task-instruction" title={task.instruction}>
                  {task.instruction}
                </span>
                {task.resultSummary && (
                  <span className="task-summary" title={task.resultSummary}>
                    {task.resultSummary}
                  </span>
                )}
                {cancellable ? (
                  <button
                    type="button"
                    className="pill-btn task-cancel"
                    disabled={busy}
                    onClick={() => props.onCancel(task.id)}
                  >
                    {busy ? t("tasks.cancelling") : task.status === "running" ? t("tasks.cancelAction") : t("shell.cancel")}
                  </button>
                ) : (
                  <span className="task-done-note" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
