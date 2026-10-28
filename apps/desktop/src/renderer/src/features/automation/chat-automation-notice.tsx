/**
 * Chat automation status notice (D20').
 *
 * One collapsible bar between the chat header and the message list, fed
 * entirely by the existing trusted eventRule read methods: missed triggers
 * (skipped and duplicate records), recent rule state changes, and pending
 * review items. Renderer-only visibility — nothing is written to
 * chat_messages, history replay is unaffected, and the rule engine, its
 * dedup and the review queue are untouched. Approve/deny stays in the
 * settings panel; the bar only jumps there.
 */
import { useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { formatDateTime, t, useLanguage } from "../../i18n.js";

type EventRule = { id: string; name: string };
type MissedRecord = {
  id: string;
  ruleId: string;
  outcome: "skipped" | "duplicate";
  reason: string;
  at: string;
};
type StateRow = { id: string; ruleId: string; state: "enabled" | "disabled" | "review"; at: string };

type NoticeData = {
  rules: EventRule[];
  missed: MissedRecord[];
  states: StateRow[];
  pending: number;
};

const POLL_INTERVAL_MS = 20_000;

/** Host-written record reasons are stable English constants (runtime/
 * event-rules.ts); map them for display and keep unknown ones — including
 * embedded error details — verbatim. Data itself is never rewritten. */
type NoticeReasonKey =
  | "eventrule.noticeReasonRuleDisabled"
  | "eventrule.noticeReasonReviewDenied"
  | "eventrule.noticeReasonDuplicate"
  | "eventrule.noticeReasonSourceRunAuto";

const REASON_KEYS: ReadonlyMap<string, NoticeReasonKey> = new Map([
  ["rule disabled", "eventrule.noticeReasonRuleDisabled"],
  ["review denied", "eventrule.noticeReasonReviewDenied"],
  ["duplicate event", "eventrule.noticeReasonDuplicate"],
  ["source run was started by an event rule", "eventrule.noticeReasonSourceRunAuto"],
]);
const TRIGGER_FAILED_PREFIX = "event rule trigger failed: ";

export function noticeReasonText(reason: string): string {
  if (reason.startsWith(TRIGGER_FAILED_PREFIX)) {
    return t("eventrule.noticeReasonTriggerFailed", [reason.slice(TRIGGER_FAILED_PREFIX.length)]);
  }
  const key = REASON_KEYS.get(reason);
  return key === undefined ? reason : t(key);
}

const STATE_KEYS = {
  enabled: "eventrule.stateEnabled",
  disabled: "eventrule.stateDisabled",
  review: "eventrule.stateReview",
} as const;

export function ChatAutomationNotice(props: {
  botId: string;
  onOpenAutomation: () => void;
}): JSX.Element | null {
  useLanguage();
  const [data, setData] = useState<NoticeData | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const botId = props.botId;
    if (botId === "") {
      return;
    }
    let alive = true;
    let token = 0;
    const load = async (): Promise<void> => {
      const current = ++token;
      try {
        const [rulesRes, recordsRes, statesRes, reviewRes] = await Promise.all([
          window.deepseekBot.host.call("eventRule.list", { botId }),
          window.deepseekBot.host.call("eventRule.record.list", { botId, limit: 10 }),
          window.deepseekBot.host.call("eventRule.state.list", { botId, limit: 10 }),
          window.deepseekBot.host.call("eventRule.review.list", { botId, limit: 10 }),
        ]);
        if (!alive || current !== token) return;
        const rules = METHOD_CONTRACTS["eventRule.list"].response
          .parse(rulesRes)
          .rules.map((rule) => ({ id: rule.id, name: rule.name }));
        const missed = METHOD_CONTRACTS["eventRule.record.list"].response
          .parse(recordsRes)
          .records.flatMap((record) =>
            record.outcome === "started"
              ? []
              : [
                  {
                    id: record.id,
                    ruleId: record.ruleId,
                    outcome: record.outcome,
                    reason: record.reason,
                    at: record.at,
                  },
                ],
          );
        const states = METHOD_CONTRACTS["eventRule.state.list"].response
          .parse(statesRes)
          .states.map((row) => ({ id: row.id, ruleId: row.ruleId, state: row.state, at: row.at }));
        const pending = METHOD_CONTRACTS["eventRule.review.list"].response.parse(reviewRes).items
          .length;
        setData({
          rules,
          missed: missed.slice(0, 5),
          states: states.slice(0, 5),
          pending,
        });
      } catch {
        // Silent degradation: keep the last good snapshot — freshness recovers
        // on the next poll; with no data yet the bar simply stays hidden.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [props.botId]);

  if (data === null || data.rules.length === 0) {
    return null;
  }
  if (data.missed.length === 0 && data.states.length === 0 && data.pending === 0) {
    return null;
  }
  const ruleName = (ruleId: string): string =>
    data.rules.find((rule) => rule.id === ruleId)?.name ?? t("eventrule.unknownRule");

  return (
    <div className="automation-notice" data-testid="chat-automation-notice">
      <button
        type="button"
        className="automation-notice-toggle"
        aria-expanded={expanded}
        aria-controls="chat-automation-notice-body"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="automation-notice-title">⚡ {t("eventrule.noticeTitle")}</span>
        <span className="automation-notice-summary">
          {data.missed.length > 0 && (
            <span>{t("eventrule.noticeSummaryMissed", [data.missed.length])}</span>
          )}
          {data.pending > 0 && (
            <span>{t("eventrule.noticeSummaryPending", [data.pending])}</span>
          )}
          {data.states.length > 0 && (
            <span>{t("eventrule.noticeSummaryStates", [data.states.length])}</span>
          )}
        </span>
        <span className="automation-notice-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div
          className="automation-notice-body"
          id="chat-automation-notice-body"
          role="region"
          aria-label={t("eventrule.noticeTitle")}
        >
          {data.pending > 0 && (
            <button
              type="button"
              className="automation-notice-row automation-notice-jump"
              onClick={props.onOpenAutomation}
            >
              <span className="automation-notice-main">
                {t("eventrule.noticePendingLine", [data.pending])}
              </span>
              <span className="automation-notice-meta">{t("eventrule.noticeOpenSettings")}</span>
            </button>
          )}
          {data.states.map((row) => (
            <div className="automation-notice-row" key={row.id} data-state={row.state}>
              <span className="automation-notice-main">
                {t("eventrule.noticeStateTo", [ruleName(row.ruleId), t(STATE_KEYS[row.state])])}
              </span>
              <time className="automation-notice-meta" dateTime={row.at}>
                {formatDateTime(row.at)}
              </time>
            </div>
          ))}
          {data.missed.map((record) => (
            <div className="automation-notice-row" key={record.id} data-outcome={record.outcome}>
              <span className="automation-notice-main">
                {record.outcome === "skipped"
                  ? t("eventrule.noticeRecordSkipped")
                  : t("eventrule.noticeRecordDuplicate")}
                {" · "}
                {ruleName(record.ruleId)}
                {" · "}
                {noticeReasonText(record.reason)}
              </span>
              <time className="automation-notice-meta" dateTime={record.at}>
                {formatDateTime(record.at)}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
