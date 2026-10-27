/**
 * v0.5 chat feed cards (T5, FR-4/FR-7): renders the host-persisted dispatch
 * markers and delivery notices for the open bot. The host writes these rows
 * (chat_messages.meta) outside the UI's own message list, so the feed polls
 * chat.history + task.list on a light interval and renders them as centered
 * system-style lines — dispatches jump to the sender's session, notices jump
 * to the executor's session.
 */
import { useEffect, useState, type JSX } from "react";
import type { ChatHistoryRow, DesktopService } from "../../services/desktop-service.js";
import { useService } from "../../services/service-context.js";
import type { UiBot } from "../bots/use-bots.js";
import { t, useLanguage, type MessageKey } from "../../i18n.js";

const FEED_REFRESH_MS = 4_000;

const NOTICE_STATUS_KEYS: Record<string, MessageKey> = {
  queued: "runs.queued",
  running: "shell.toolRunning",
  done: "shell.toolCompleted",
  failed: "runs.statusFailed",
  cancelled: "runs.statusCancelled",
  skipped: "runs.nodeSkipped",
  interrupted: "runs.statusInterrupted",
};

function noticeStatusLabel(status: string): string {
  const key = NOTICE_STATUS_KEYS[status];
  return key === undefined ? status : t(key);
}

type FeedRow = ChatHistoryRow & {
  meta: NonNullable<ChatHistoryRow["meta"]>;
};

function sortKey(row: FeedRow): string {
  return `${row.at}-${row.id}`;
}

export function TaskFeedCards(props: {
  botId: string;
  bots: UiBot[];
  onOpenBot: (botKey: number) => void;
}): JSX.Element | null {
  useLanguage();
  const desktop: DesktopService = useService();
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [executorByTask, setExecutorByTask] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const pull = async (): Promise<void> => {
      try {
        const [history, tasksPage] = await Promise.all([
          desktop.chat.history(props.botId, 50),
          desktop.tasks.list({ limit: 100 }),
        ]);
        if (cancelled) return;
        setRows(
          history
            .filter((row): row is FeedRow => row.meta !== undefined)
            .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
        );
        setExecutorByTask(new Map(tasksPage.tasks.map((task) => [task.id, task.toBotId])));
      } catch {
        if (!cancelled) {
          setRows([]);
        }
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), FEED_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [desktop, props.botId]);

  if (rows.length === 0) {
    return null;
  }
  const botKeyById = new Map(props.bots.map((bot) => [bot.bot.id, bot.key]));
  const botNameById = new Map(props.bots.map((bot) => [bot.bot.id, bot.bot.name]));

  return (
    <div className="task-feed" aria-label={t("tasks.feedAria")}>
      {rows.map((row) => {
        if (row.meta.kind === "dispatch") {
          const senderKey = botKeyById.get(row.meta.fromBotId);
          const senderName = botNameById.get(row.meta.fromBotId) ?? t("tasks.feedOtherBots");
          return (
            <div className="dispatch-msg" key={row.id} role="note">
              <button
                type="button"
                className="dispatch-tag"
                title={t("shell.openSessionWith", [senderName])}
                onClick={() => {
                  if (senderKey !== undefined) props.onOpenBot(senderKey);
                }}
              >
                {t("tasks.feedDispatchFrom", [senderName])}
              </button>
              <span className="dispatch-text">{row.text}</span>
            </div>
          );
        }
        const statusLabel = noticeStatusLabel(row.meta.status);
        const executorId = executorByTask.get(row.meta.taskId);
        const executorKey = executorId === undefined ? undefined : botKeyById.get(executorId);
        const body = (
          <>
            <span className={`task-status task-status--${row.meta.status}`}>
              {statusLabel}
            </span>
            <span className="task-notice-text">{row.text}</span>
            {executorKey !== undefined && <span className="task-notice-go">{t("tasks.feedOpenExecutor")}</span>}
          </>
        );
        return executorKey === undefined ? (
          <div className="task-notice" key={row.id} role="status">
            {body}
          </div>
        ) : (
          <button
            type="button"
            className="task-notice clickable"
            key={row.id}
            role="status"
            onClick={() => props.onOpenBot(executorKey!)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
