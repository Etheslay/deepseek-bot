/**
 * Bot-exchange feed (the D05 消息往来 notices, now on real dispatch data):
 *
 * - Executor panel: a dispatch marker renders as 「消息来自 <sender>」.
 * - Coordinator panel: task.list synthesizes the mirror side — 「已发消息给
 *   <executor>」 while the turn runs, 「消息来自 <executor>」 once it settles,
 *   status notices when it fails or is cancelled.
 * - The instruction and the reply stay out of these one-line notices. Clicking
 *   either bot opens the pair transcript (current bot and that bot).
 * - Both panels end with a centered 「N 条消息往来：A 和 B」 row per peer,
 *   counted from the same real tasks (never demo data).
 *
 * The feed polls chat.history + task.list on a light interval; the host owns
 * what lands in each session (dispatch markers, task notices).
 */
import { useEffect, useState, type JSX } from "react";
import type { ChatHistoryRow, DesktopService } from "../../services/desktop-service.js";
import { useService } from "../../services/service-context.js";
import type { UiBot } from "../bots/use-bots.js";
import { Avatar } from "../avatars/avatar.js";
import { t, useLanguage } from "../../i18n.js";

const FEED_REFRESH_MS = 4_000;

type TaskView = Awaited<ReturnType<DesktopService["tasks"]["list"]>>["tasks"][number];
type FeedRow = ChatHistoryRow & { meta: NonNullable<ChatHistoryRow["meta"]> };

type FeedItem =
  | { kind: "incoming"; at: string; fromBotId: string; text: string }
  | { kind: "sent"; at: string; toBotId: string; text: string; status: TaskView["status"] }
  | { kind: "received"; at: string; fromBotId: string; text: string }
  | { kind: "receipt"; at: string; status: TaskView["status"]; text: string };

const ACTIVE_STATUSES: ReadonlySet<TaskView["status"]> = new Set(["queued", "running"]);

function taskMoment(task: TaskView): string {
  return task.finishedAt ?? task.startedAt ?? task.createdAt;
}

export function statusLabel(status: TaskView["status"]): string {
  const keys: Record<TaskView["status"], string> = {
    queued: "runs.queued",
    running: "shell.toolRunning",
    done: "shell.toolCompleted",
    failed: "runs.statusFailed",
    cancelled: "runs.statusCancelled",
    skipped: "runs.nodeSkipped",
    interrupted: "runs.statusInterrupted",
  };
  return t(keys[status] as Parameters<typeof t>[0]);
}

/**
 * Merge the two sources into one chronological item list for this panel.
 * `task_notice` history rows are skipped: every state they announce is
 * synthesized from the task rows themselves, so nothing renders twice.
 */
export function buildFeedItems(
  myBotId: string,
  history: FeedRow[],
  tasks: TaskView[],
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const row of history) {
    if (row.meta.kind === "dispatch") {
      items.push({ kind: "incoming", at: row.at, fromBotId: row.meta.fromBotId, text: row.text });
    }
  }
  for (const task of tasks) {
    if (task.fromBotId !== myBotId && task.toBotId !== myBotId) {
      continue;
    }
    if (task.fromBotId === myBotId) {
      items.push({
        kind: "sent",
        at: taskMoment(task),
        toBotId: task.toBotId,
        text: task.instruction,
        status: task.status,
      });
      if (task.status === "done" && task.resultSummary !== null && task.resultSummary !== "") {
        items.push({
          kind: "received",
          at: taskMoment(task),
          fromBotId: task.toBotId,
          text: task.resultSummary,
        });
      }
    }
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Per-peer exchange counts over the merged items (both directions). */
export function countExchanges(
  myBotId: string,
  items: FeedItem[],
): Array<{ otherBotId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const other =
      item.kind === "incoming" || item.kind === "received"
        ? item.fromBotId
        : item.kind === "sent"
          ? item.toBotId
          : undefined;
    if (other === undefined || other === myBotId) continue;
    counts.set(other, (counts.get(other) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([otherBotId, count]) => ({ otherBotId, count }))
    .sort((a, b) => (a.otherBotId < b.otherBotId ? -1 : 1));
}

export function TaskFeedCards(props: {
  botId: string;
  bots: UiBot[];
  /** Open the pair transcript between this panel's bot and `botKey`. */
  onOpenExchange: (botKey: number) => void;
}): JSX.Element | null {
  useLanguage();
  const desktop: DesktopService = useService();
  const [items, setItems] = useState<FeedItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pull = async (): Promise<void> => {
      try {
        const [history, tasksPage] = await Promise.all([
          desktop.chat.history(props.botId, 50),
          desktop.tasks.list({ limit: 100 }),
        ]);
        if (cancelled) return;
        setItems(buildFeedItems(props.botId, history.filter((row): row is FeedRow => row.meta !== undefined), tasksPage.tasks));
      } catch {
        if (!cancelled) {
          setItems([]);
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

  if (items.length === 0) {
    return null;
  }
  const botKeyById = new Map(props.bots.map((bot) => [bot.bot.id, bot.key]));
  const botNameById = new Map(props.bots.map((bot) => [bot.bot.id, bot.bot.name]));
  const nameOf = (botId: string): string => botNameById.get(botId) ?? t("tasks.feedOtherBots");

  const chip = (botId: string, size: number, exchangeKey: number | undefined): JSX.Element => {
    const other = props.bots.find((bot) => bot.bot.id === botId);
    const exchangeBot = props.bots.find((bot) => bot.key === exchangeKey);
    const exchangeName = exchangeBot?.bot.name ?? nameOf(botId);
    return (
      <button
        type="button"
        className="summary-bot"
        title={t("shell.viewExchangesWith", [exchangeName])}
        onClick={() => {
          if (exchangeKey !== undefined) props.onOpenExchange(exchangeKey);
        }}
      >
        <Avatar avatar={other?.avatar ?? { kind: "mono" }} variant="inline" size={size} />
        <span>{nameOf(botId)}</span>
      </button>
    );
  };

  return (
    <div className="task-feed" aria-label={t("tasks.feedAria")}>
      {items.map((item, index) => {
        if (item.kind === "incoming" || item.kind === "received") {
          const exchangeKey = botKeyById.get(item.fromBotId);
          return (
            <div className="deliver-notice" key={`${item.kind}-${index}`} role="status">
              <span className="deliver-label">{t("shell.messageFrom")}</span>
              {chip(item.fromBotId, 18, exchangeKey)}
            </div>
          );
        }
        if (item.kind === "sent") {
          const exchangeKey = botKeyById.get(item.toBotId);
          if (ACTIVE_STATUSES.has(item.status) || item.status === "done") {
            // The message left this bot. The notice stays a single line whether
            // the reply has landed; the text itself opens with the peer chip.
            return (
              <div className="deliver-notice" key={`sent-${index}`} role="status">
                <span className="deliver-label">{t("shell.sentTo")}</span>
                {chip(item.toBotId, 18, exchangeKey)}
              </div>
            );
          }
          return (
            <div className="task-notice" key={`sent-${index}`} role="status">
              <span className={`task-status task-status--${item.status}`}>{statusLabel(item.status)}</span>
              {chip(item.toBotId, 18, exchangeKey)}
            </div>
          );
        }
        return (
          <div className="task-notice" key={`note-${index}`} role="status">
            <span className={`task-status task-status--${item.status}`}>{statusLabel(item.status)}</span>
          </div>
        );
      })}
      {countExchanges(props.botId, items).map(({ otherBotId, count }) => {
        const exchangeKey = botKeyById.get(otherBotId);
        return (
          <div className="chat-summary" key={`count-${otherBotId}`}>
            <span className="chat-summary-label">{t("shell.exchangeCount", [count])}</span>
            {chip(props.botId, 16, exchangeKey)}
            <span className="summary-and">{t("shell.and")}</span>
            {chip(otherBotId, 16, exchangeKey)}
          </div>
        );
      })}
    </div>
  );
}
