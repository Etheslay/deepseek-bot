/**
 * 任务页签 (v0.5 T5, FR-6): dispatched-task list with status filter, relay
 * chain coordinates (跳 x/y) and the human cancel button. Rows are plain
 * buttons with roving tabindex like the run list, and every terminal row is
 * inert — only queued/running tasks can be cancelled.
 */
import { useMemo, useState, type JSX } from "react";
import type { Bot, Task, TaskStatus } from "@deepseek-bot/contracts";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "执行中",
  done: "已完成",
  failed: "已失败",
  cancelled: "已取消",
  skipped: "已跳过",
  interrupted: "已中断",
};

const FILTERS: Array<{ value: TaskStatus | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "执行中" },
  { value: "done", label: "已完成" },
  { value: "failed", label: "已失败" },
  { value: "skipped", label: "已跳过" },
  { value: "interrupted", label: "已中断" },
];

export function TaskList(props: {
  tasks: Task[];
  bots: Bot[];
  onCancel: (taskId: string) => void;
  cancelBusyId?: string | null;
}): JSX.Element {
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const nameOf = useMemo(() => {
    const byId = new Map(props.bots.map((bot) => [bot.id, bot.name]));
    return (botId: string): string => byId.get(botId) ?? botId.slice(0, 8);
  }, [props.bots]);
  const visible = props.tasks.filter(
    (task) => filter === "all" || task.status === filter,
  );

  return (
    <div className="task-list" role="tabpanel" aria-label="派发任务列表">
      <div className="task-filters" role="group" aria-label="按状态过滤">
        {FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={"task-filter" + (filter === entry.value ? " active" : "")}
            aria-pressed={filter === entry.value}
            onClick={() => setFilter(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="task-empty">当前没有任务。</div>
      ) : (
        <ul className="task-rows">
          {visible.map((task) => {
            const cancellable = task.status === "queued" || task.status === "running";
            const busy = props.cancelBusyId === task.id;
            return (
              <li className="task-row" key={task.id}>
                <span className={`task-status task-status--${task.status}`}>
                  {TASK_STATUS_LABELS[task.status]}
                </span>
                {task.chainTotal > 1 && (
                  <span
                    className="task-hop"
                    title={`接力链第 ${task.chainIndex + 1} 跳，共 ${task.chainTotal} 跳`}
                  >
                    跳 {task.chainIndex + 1}/{task.chainTotal}
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
                    {busy ? "取消中…" : task.status === "running" ? "中断回合" : "取消"}
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
