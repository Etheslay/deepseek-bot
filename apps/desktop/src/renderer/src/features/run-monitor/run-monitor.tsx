/**
 * Run monitor shell (D09): 运行列表 + 详情（监控/历史）+ 审批收件箱。
 *
 * Data flow mirrors the contract model: `run.list` for the sidebar, a
 * snapshot baseline (`run.get` + service views) plus `events.subscribe`
 * (runId + afterSequence) for the detail; dedupe/gap/snapshotRequired
 * handling lives in events/event-stream.ts, statuses fold through
 * events/run-view.ts against the contracts state machines. All run state is
 * fixture playback (夹具回放) — no real engine, backend approvals,
 * persistence or scheduling.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import type { AssistantDelta, Run, Task } from "@deepseek-bot/contracts";
import { useService } from "../../services/service-context.js";
import { useBots } from "../bots/use-bots.js";
import { ServiceError } from "../../services/desktop-service.js";
import {
  applySubscribeResult,
  initEventStream,
  rebuildFromSnapshot,
  resumeFrom,
  type EventStreamState,
} from "./events/event-stream.js";
import { buildRunView, type ApprovalBaseline, type RunView } from "./events/run-view.js";
import { RunList } from "./run-list/run-list.js";
import { RunDetail } from "./run-detail/run-detail.js";
import { RunHistory } from "./history/run-history.js";
import { ApprovalInboxItem } from "./approvals/approval-card.js";
import { TaskList, taskStatusLabel } from "./tasks/task-list.js";
import { t } from "../../i18n.js";

type SnapshotData = Awaited<ReturnType<ReturnType<typeof useService>["runs"]["snapshot"]>>;

const TASK_REFRESH_MS = 4_000;

export function RunMonitor(props: { onClose: () => void }): JSX.Element {
  const desktop = useService();
  const runs = desktop.runs;
  const bots = useBots(0);

  const [runList, setRunList] = useState<Run[]>([]);
  const [inbox, setInbox] = useState<ApprovalBaseline[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [stream, setStream] = useState<EventStreamState | null>(null);
  const [transient, setTransient] = useState<AssistantDelta[]>([]);
  const [tab, setTab] = useState<"monitor" | "history" | "tasks">("monitor");
  const [notice, setNotice] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const refreshList = useCallback(async (): Promise<void> => {
    const page = await runs.list();
    setRunList(page.runs);
    setInbox(await runs.listApprovals());
  }, [runs]);

  /** Subscribe from `afterSequence` and merge into the stream. */
  const subscribeInto = useCallback(
    async (runId: string, state: EventStreamState): Promise<EventStreamState> => {
      const response = await runs.subscribe(runId, state.lastSequence ?? 0);
      return applySubscribeResult(state, response).state;
    },
    [runs],
  );

  const openRun = useCallback(
    async (runId: string): Promise<void> => {
      setSelectedRunId(runId);
      setTab("monitor");
      setNotice(null);
      const snap = await runs.snapshot(runId);
      setSnapshot(snap);
      let state = initEventStream(runId);
      state = await subscribeInto(runId, state);
      setStream(state);
      setTransient(await runs.pullTransient(runId));
    },
    [runs, subscribeInto],
  );

  /** Re-pull snapshot + incremental events after an action or script step. */
  const refreshRun = useCallback(async (): Promise<void> => {
    if (selectedRunId === null) {
      return;
    }
    const snap = await runs.snapshot(selectedRunId);
    setSnapshot(snap);
    if (stream !== null) {
      setStream(await subscribeInto(selectedRunId, stream));
    }
    const drained = await runs.pullTransient(selectedRunId);
    setTransient((previous) => [...previous, ...drained]);
    await refreshList();
  }, [selectedRunId, runs, stream, subscribeInto, refreshList]);

  useEffect(() => {
    void (async () => {
      await refreshList();
    })();
  }, [refreshList]);

  // v0.5 任务页签: pull task.list on a light interval while the tab is
  // visible (the host pushes no task events to the renderer yet).
  const refreshTasks = useCallback(async (): Promise<void> => {
    try {
      const page = await desktop.tasks.list({ limit: 100 });
      setTasks(page.tasks);
    } catch {
      setTasks([]);
    }
  }, [desktop]);

  useEffect(() => {
    if (tab !== "tasks") {
      return;
    }
    void refreshTasks();
    const timer = setInterval(() => void refreshTasks(), TASK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [tab, refreshTasks]);

  const onCancelTask = useCallback(
    async (taskId: string): Promise<void> => {
      setCancelBusyId(taskId);
      try {
        const task = await desktop.tasks.cancel(taskId);
        setNotice(
          task.status === "cancelled"
            ? t("tasks.cancelledNotice")
            : t("tasks.movedToNotice", [taskStatusLabel(task.status)]),
        );
        await refreshTasks();
      } catch (error) {
        handleError(error, t("tasks.cancelFailed"));
      } finally {
        setCancelBusyId(null);
      }
    },
    [desktop, refreshTasks],
  );

  useEffect(() => {
    if (runList.length > 0 && selectedRunId === null) {
      const preferred =
        runList.find((run) => run.status === "waiting_approval") ??
        runList.find((run) => run.status === "running") ??
        runList[0]!;
      void openRun(preferred.id);
    }
  }, [runList, selectedRunId, openRun]);

  const handleError = (error: unknown, fallback: string): void => {
    if (error instanceof ServiceError) {
      setNotice(`${error.code}：${error.message}`);
      return;
    }
    setNotice(error instanceof Error ? error.message : fallback);
  };

  const onDecide = async (
    baseline: ApprovalBaseline,
    decision: "approved" | "denied",
  ): Promise<void> => {
    try {
      await runs.decideApproval({
        approvalId: baseline.approval.id,
        decision,
        expectedActionDigest: baseline.approval.actionDigest,
      });
      await refreshRun();
    } catch (error) {
      handleError(error, t("runs.approvalActionFailed"));
      // Refresh anyway so consumed/expired state is reflected.
      try {
        await refreshRun();
      } catch {
        /* the primary error is already surfaced */
      }
      throw error;
    }
  };

  const onCancel = async (): Promise<void> => {
    if (selectedRunId === null) {
      return;
    }
    try {
      const run = await runs.cancel(selectedRunId);
      setNotice(
        run.status === "cancelling"
          ? t("runs.cancelRequested")
          : t("runs.alreadyTerminal", [run.status]),
      );
      await refreshRun();
    } catch (error) {
      handleError(error, t("runs.cancelFailed"));
    }
  };

  const onRetry = async (nodeRunId: string): Promise<void> => {
    try {
      const spawned = await runs.retryNode(nodeRunId);
      setNotice(
        t("runs.retryNodeNotice", [spawned.nodeId, spawned.attempt]),
      );
      await refreshRun();
    } catch (error) {
      handleError(error, t("runs.retryFailed"));
    }
  };

  const onAdvance = async (): Promise<void> => {
    if (selectedRunId === null) {
      return;
    }
    try {
      await runs.advanceScenario(selectedRunId);
      await refreshRun();
    } catch (error) {
      handleError(error, t("runs.fixtureReplayFailed"));
    }
  };

  const onReconnect = async (): Promise<void> => {
    if (selectedRunId === null || stream === null) {
      return;
    }
    if (stream.lastSequence === null) {
      setNotice(t("runs.noReplayableEvents"));
      return;
    }
    try {
      // Simulate the crash-reconnect consumer: it had processed through
      // lastSequence - 1 when the connection dropped, reconnects with
      // afterSequence from there and the host replays the tail.
      const resumeAt = stream.lastSequence - 1;
      const resumed = resumeFrom(stream, resumeAt);
      setStream(await subscribeInto(selectedRunId, resumed));
      setNotice(t("runs.reconnectedAfterSequence", [resumeAt]));
    } catch (error) {
      handleError(error, t("runs.reconnectFailed"));
    }
  };

  const onRebuild = (): void => {
    if (stream === null) {
      return;
    }
    setStream(rebuildFromSnapshot(stream));
    setNotice(t("runs.rebuiltFromRunGetSnapshot"));
  };

  const view: RunView | null =
    snapshot !== null && stream !== null
      ? buildRunView(
          snapshot,
          stream.events,
          stream.rebuildCount > 0 ? "snapshot" : "events",
        )
      : null;

  const otherApprovals = inbox.filter(
    (baseline) => baseline.approval.runId !== selectedRunId,
  );

  return (
    <div className="rm-shell">
      <header className="rm-top">
        <span className="rm-title">{t("shell.runMonitorApprovals")}</span>
        <span className="rm-badge">{t("runs.fixtureReplayBadge")}</span>
        <button
          type="button"
          className="ghost-btn rm-close-btn"
          aria-label={t("runs.closeMonitor")}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      {notice !== null && (
        <div className="rm-notice" role="status">
          {notice}
        </div>
      )}
      <div className="rm-body">
        <aside className="rm-side">
          <RunList
            runs={runList}
            selectedRunId={selectedRunId}
            onSelect={(runId) => void openRun(runId)}
          />
          {otherApprovals.length > 0 && (
            <div className="rm-inbox" aria-label={t("runs.approvalInbox")}>
              <div className="rm-list-head">{t("runs.otherRunsApprovals")}</div>
              {otherApprovals.map((baseline) => (
                <ApprovalInboxItem
                  key={baseline.approval.id}
                  baseline={baseline}
                  onOpen={(runId) => void openRun(runId)}
                />
              ))}
            </div>
          )}
        </aside>
        <main className="rm-main" aria-live="polite">
        {tab === "tasks" ? (
          <>
            <div className="rm-tabs" role="tablist" aria-label={t("runs.monitorViewAria")}>
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="rm-tab"
                onClick={() => setTab("monitor")}
              >
                {t("runs.tabMonitor")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="rm-tab"
                onClick={() => setTab("history")}
              >
                {t("runs.history")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected
                className="rm-tab active"
                onClick={() => setTab("tasks")}
              >
                {t("tasks.tabLabel")}
              </button>
            </div>
            <TaskList
              tasks={tasks}
              bots={bots.bots.map((bot) => bot.bot)}
              onCancel={(taskId) => void onCancelTask(taskId)}
              cancelBusyId={cancelBusyId}
            />
          </>
        ) : view === null ? (
          <div className="rm-empty">{t("runs.loadingRun")}</div>
          ) : (
            <>
              <div className="rm-tabs" role="tablist" aria-label={t("runs.detailsView")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "monitor"}
                  className={"rm-tab" + (tab === "monitor" ? " active" : "")}
                  onClick={() => setTab("monitor")}
                >
                  {t("runs.tabMonitor")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "history"}
                  className={"rm-tab" + (tab === "history" ? " active" : "")}
                  onClick={() => setTab("history")}
                >
                  {t("runs.history")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={false}
                  className="rm-tab"
                  onClick={() => setTab("tasks")}
                >
                  {t("tasks.tabLabel")}
                </button>
              </div>
              {tab === "monitor" ? (
                <RunDetail
                  view={view}
                  stream={stream}
                  transient={transient}
                  onDecide={onDecide}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onAdvance={onAdvance}
                  onReconnect={onReconnect}
                  onRebuild={onRebuild}
                />
              ) : (
                <RunHistory
                  view={view}
                  onOpenRun={(runId) => void openRun(runId)}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
