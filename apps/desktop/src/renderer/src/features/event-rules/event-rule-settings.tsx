/**
 * Settings for one bot's local event rules (D20 desktop review/status).
 *
 * The user picks a bot and sees each rule's current flags (enabled or
 * disabled, and review when that flag is on). A pending review can be
 * approved or denied here. Approve and deny call the existing host methods:
 * approve starts one run, deny records one skip. State history for that bot
 * is listed newest first. This panel does not add a chat banner, change the
 * chat permission grant flow, or send device input.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { CustomSelect } from "../../components/custom-select.js";
import { eventLabel } from "../automation/automation-panel.js";
import { clearHostDown, noteHostFailure } from "../settings/host-down.js";
import { formatDateTime, noticeText, t, useLanguage, type Notice } from "../../i18n.js";

type Banner = { notice: Notice; error: boolean };

type EventRule = {
  id: string;
  botId: string;
  name: string;
  eventType: "run.failed" | "run.completed";
  enabled: boolean;
  review: boolean;
};

type PendingReview = {
  id: string;
  ruleId: string;
  at: string;
};

type StateRow = {
  id: string;
  ruleId: string;
  botId: string;
  state: "enabled" | "disabled" | "review";
  at: string;
};

const STATE_LABEL = {
  enabled: "eventrule.stateEnabled",
  disabled: "eventrule.stateDisabled",
  review: "eventrule.stateReview",
} as const;

/** Newest `at` first. Equal timestamps keep their previous order. */
export function newestFirst<T extends { at: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (left.row.at === right.row.at) return left.index - right.index;
      return left.row.at < right.row.at ? 1 : -1;
    })
    .map((item) => item.row);
}

/** Enabled or disabled, with review called out only when that flag is on. */
export function ruleStateLabel(rule: { enabled: boolean; review: boolean }): string {
  const base = rule.enabled ? t("eventrule.stateEnabled") : t("eventrule.stateDisabled");
  return rule.review ? t("eventrule.stateWithReview", [base]) : base;
}

export function EventRuleSettings(): JSX.Element {
  useLanguage();
  const [bots, setBots] = useState<Array<{ id: string; name: string }> | null>(null);
  const [botId, setBotId] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void window.deepseekBot.host
      .call("bot.list", {})
      .then((response) => {
        if (!active) return;
        const available = METHOD_CONTRACTS["bot.list"].response
          .parse(response)
          .bots.filter((bot) => bot.archivedAt === null);
        setBots(available.map((bot) => ({ id: bot.id, name: bot.name })));
        setBotId((current) => current || available[0]?.id || "");
        clearHostDown();
      })
      .catch((error: unknown) => {
        if (active && !noteHostFailure(error)) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <div className="settings-section-title">{t("eventrule.sectionTitle")}</div>
      <div className="settings-card" data-testid="event-rule-settings">
        {bots === null ? (
          <p className={failed ? "form-error" : "settings-soon"} role={failed ? "alert" : "status"}>
            {failed ? t("eventrule.loadFailed") : t("eventrule.loading")}
          </p>
        ) : (
          <>
            <div className="settings-row">
              <span>{t("eventrule.botLabel")}</span>
              <CustomSelect
                value={botId}
                options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
                ariaLabel={t("eventrule.botLabel")}
                disabled={bots.length === 0}
                onChange={setBotId}
              />
            </div>
            {bots.length === 0 ? <p role="status">{t("eventrule.noBots")}</p> : null}
            {botId !== "" ? <EventRuleBotPanel key={botId} botId={botId} /> : null}
          </>
        )}
      </div>
    </>
  );
}

function EventRuleBotPanel(props: { botId: string }): JSX.Element {
  const { botId } = props;
  useLanguage();
  const alive = useRef(true);
  const ticket = useRef(0);
  const acting = useRef(false);
  const [rules, setRules] = useState<EventRule[] | null>(null);
  const [reviews, setReviews] = useState<PendingReview[] | null>(null);
  const [states, setStates] = useState<StateRow[] | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (token: number): Promise<void> => {
      try {
        const [rulesResponse, reviewsResponse, statesResponse] = await Promise.all([
          window.deepseekBot.host.call("eventRule.list", { botId }),
          window.deepseekBot.host.call("eventRule.review.list", { botId }),
          window.deepseekBot.host.call("eventRule.state.list", { botId }),
        ]);
        if (!alive.current || ticket.current !== token) return;
        const parsedRules = METHOD_CONTRACTS["eventRule.list"].response
          .parse(rulesResponse)
          .rules.filter((rule) => rule.botId === botId)
          .map((rule) => ({
            id: rule.id,
            botId: rule.botId,
            name: rule.name,
            eventType: rule.eventType,
            enabled: rule.enabled,
            review: rule.review,
          }));
        const parsedReviews = METHOD_CONTRACTS["eventRule.review.list"].response
          .parse(reviewsResponse)
          .items.map((item) => ({ id: item.id, ruleId: item.ruleId, at: item.at }));
        const parsedStates = newestFirst(
          METHOD_CONTRACTS["eventRule.state.list"].response
            .parse(statesResponse)
            .states.filter((row) => row.botId === botId)
            .map((row) => ({
              id: row.id,
              ruleId: row.ruleId,
              botId: row.botId,
              state: row.state,
              at: row.at,
            })),
        );
        setRules(parsedRules);
        setReviews(parsedReviews);
        setStates(parsedStates);
        setBanner((current) => (current?.notice.key === "eventrule.loadFailed" ? null : current));
      } catch {
        if (!alive.current || ticket.current !== token) return;
        setBanner((current) => {
          if (current !== null && current.notice.key !== "eventrule.loadFailed") return current;
          return { notice: { key: "eventrule.loadFailed" }, error: true };
        });
      }
    },
    [botId],
  );

  useEffect(() => {
    alive.current = true;
    void load(ticket.current);
    return () => {
      alive.current = false;
    };
  }, [load]);

  async function decide(reviewId: string, decision: "approve" | "deny"): Promise<void> {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    const token = ++ticket.current;
    const method = decision === "approve" ? "eventRule.review.approve" : "eventRule.review.deny";
    try {
      const response = await window.deepseekBot.host.call(method, { botId, id: reviewId });
      if (!alive.current || ticket.current !== token) return;
      METHOD_CONTRACTS[method].response.parse(response);
      setReviews((current) => (current ?? []).filter((item) => item.id !== reviewId));
      // No success banner: the row disappearing is the feedback (2026-11).
      setBanner(null);
      await load(token);
    } catch {
      if (!alive.current || ticket.current !== token) return;
      setBanner({ notice: { key: "eventrule.reviewFailed" }, error: true });
    } finally {
      acting.current = false;
      if (alive.current && ticket.current === token) setBusy(false);
    }
  }

  const ruleName = (ruleId: string): string =>
    rules?.find((rule) => rule.id === ruleId)?.name ?? t("eventrule.unknownRule");

  const loaded = rules !== null && reviews !== null && states !== null;

  return (
    <>
      {!loaded ? (
        <p
          className={banner?.error === true ? "form-error" : "settings-soon"}
          role={banner?.error === true ? "alert" : "status"}
        >
          {banner?.error === true ? noticeText(banner.notice) : t("eventrule.loading")}
        </p>
      ) : (
        <>
          <div className="automation-queue-title">{t("eventrule.rulesTitle")}</div>
          <div className="automation-rule-list" data-testid="event-rule-list">
            {rules.map((rule) => (
              <div
                className="automation-rule-row"
                key={rule.id}
                data-rule-id={rule.id}
                data-enabled={rule.enabled ? "true" : "false"}
                data-review={rule.review ? "true" : "false"}
              >
                <span className="automation-rule-label">
                  {t("eventrule.ruleSummary", [rule.name, eventLabel(rule.eventType)])}
                </span>
                <span className="automation-rule-state">{ruleStateLabel(rule)}</span>
              </div>
            ))}
          </div>
          {rules.length === 0 ? (
            <div className="automation-queue-empty" role="status">
              {t("eventrule.noRules")}
            </div>
          ) : null}

          <div className="automation-queue">
            <div className="automation-queue-title">{t("eventrule.reviewTitle")}</div>
            <div className="automation-queue-list" data-testid="event-rule-reviews">
              {reviews.map((item) => {
                const name = ruleName(item.ruleId);
                return (
                  <div className="automation-queue-row" key={item.id} data-review-id={item.id}>
                    <span className="automation-rule-label">
                      {t("eventrule.reviewSummary", [name, formatDateTime(item.at)])}
                    </span>
                    <span className="automation-rule-state">{t("eventrule.reviewTitle")}</span>
                    <span className="automation-rule-actions">
                      <button
                        className="pill-btn"
                        type="button"
                        disabled={busy}
                        aria-label={t("eventrule.approveItem", [name])}
                        onClick={() => void decide(item.id, "approve")}
                      >
                        {t("eventrule.approve")}
                      </button>
                      <button
                        className="pill-btn"
                        type="button"
                        disabled={busy}
                        aria-label={t("eventrule.denyItem", [name])}
                        onClick={() => void decide(item.id, "deny")}
                      >
                        {t("eventrule.deny")}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            {reviews.length === 0 ? (
              <div className="automation-queue-empty" role="status">
                {t("eventrule.reviewEmpty")}
              </div>
            ) : null}
          </div>

          <div className="automation-queue">
            <div className="automation-queue-title">{t("eventrule.historyTitle")}</div>
            <div className="automation-rule-list" data-testid="event-rule-history">
              {states.map((row) => (
                <div
                  className="automation-rule-row"
                  key={row.id}
                  data-state={row.state}
                  data-at={row.at}
                >
                  <span className="automation-rule-label">{ruleName(row.ruleId)}</span>
                  <span className="automation-rule-state">{t(STATE_LABEL[row.state])}</span>
                  <time dateTime={row.at}>{formatDateTime(row.at)}</time>
                </div>
              ))}
            </div>
            {states.length === 0 ? (
              <div className="automation-queue-empty" role="status">
                {t("eventrule.historyEmpty")}
              </div>
            ) : null}
          </div>

          {banner !== null ? (
            <p
              className={banner.error ? "form-error" : "settings-ok"}
              role={banner.error ? "alert" : "status"}
            >
              {noticeText(banner.notice)}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
