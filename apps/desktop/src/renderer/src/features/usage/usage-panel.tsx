/**
 * 「用量与账单」token statistics (usage.summary).
 *
 * Reads aggregates only: the host records one row per finished turn, so this
 * panel never computes usage itself. Three views over the same window — a model
 * table, a daily trend line and a model share ring — plus the totals.
 *
 * When any contributing turn had no usage block upstream, the response says
 * `totals.estimated`, and the page says so instead of presenting the number as
 * billed usage.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS, type UsageSummary } from "@deepseek-bot/contracts";
import { t, useLanguage } from "../../i18n.js";

type Scope = "bot" | "all";

const RING_COLORS = ["#6ea8ff", "#7fdbca", "#f5c66e", "#ff7b9c", "#9ae6a0", "#c3a6ff"];

/** Compact token counts: 12.3万 / 1.2M. */
function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function share(part: number, total: number): number {
  return total <= 0 ? 0 : Math.round((part / total) * 100);
}

/** Line chart over the daily series; null when there is nothing to draw. */
function TrendChart(props: { points: ReadonlyArray<{ day: string; inputTokens: number; outputTokens: number }> }): JSX.Element | null {
  const points = props.points;
  if (points.length === 0) return null;
  const peak = Math.max(...points.map((point) => Math.max(point.inputTokens, point.outputTokens)), 1);
  const plot = (key: "inputTokens" | "outputTokens"): string =>
    points
      .map((point, index) => {
        const x = points.length === 1 ? 150 : (index / (points.length - 1)) * 300;
        const y = 92 - (point[key] / peak) * 80;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg className="usage-trend" viewBox="0 0 300 100" role="img" aria-label={t("usage.daily")} preserveAspectRatio="none">
      <line x1="0" y1="92" x2="300" y2="92" className="usage-axis" />
      <polyline className="usage-line usage-line-input" points={plot("inputTokens")} />
      <polyline className="usage-line usage-line-output" points={plot("outputTokens")} />
    </svg>
  );
}

/** Model share ring; each arc is a dashed stroke segment. */
function ShareRing(props: { rows: ReadonlyArray<{ model: string; tokens: number }> }): JSX.Element | null {
  const rows = props.rows;
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  if (total <= 0) return null;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg className="usage-ring" viewBox="0 0 140 140" role="img" aria-label={t("usage.share")}>
      {rows.map((row, index) => {
        const length = (row.tokens / total) * circumference;
        const arc = (
          <circle
            key={row.model}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            strokeWidth="14"
            stroke={RING_COLORS[index % RING_COLORS.length]}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          />
        );
        offset += length;
        return arc;
      })}
      <text x="70" y="66" textAnchor="middle" className="usage-ring-total">
        {compact(total)}
      </text>
      <text x="70" y="82" textAnchor="middle" className="usage-ring-unit">
        {t("usage.tokens")}
      </text>
    </svg>
  );
}

export function UsagePanel(props: { botId: string | null }): JSX.Element {
  useLanguage();
  const [days, setDays] = useState<7 | 30>(30);
  const [scope, setScope] = useState<Scope>("bot");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const payload: { days: number; botId?: string } = { days };
      if (scope === "bot" && props.botId !== null) payload.botId = props.botId;
      const response = await window.deepseekBot.host.call("usage.summary", payload);
      setSummary(METHOD_CONTRACTS["usage.summary"].response.parse(response));
      setError(false);
    } catch {
      setSummary(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [days, scope, props.botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = summary?.totals ?? null;
  const empty = summary !== null && totals !== null && totals.turns === 0;
  const totalTokens = totals === null ? 0 : totals.inputTokens + totals.outputTokens;

  return (
    <div className="usage-panel">
      <div className="usage-controls">
        <div className="usage-range" role="group" aria-label={t("usage.daily")}>
          {([7, 30] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={"usage-chip" + (days === value ? " active" : "")}
              onClick={() => setDays(value)}
            >
              {value}d
            </button>
          ))}
        </div>
        <div className="usage-range" role="group" aria-label={t("usage.allBots")}>
          {(["bot", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={"usage-chip" + (scope === value ? " active" : "")}
              onClick={() => setScope(value)}
              disabled={value === "bot" && props.botId === null}
            >
              {value === "bot" ? t("usage.thisBot") : t("usage.allBots")}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="usage-error" role="status">{t("usage.loadFailed")}</div>}

      {summary !== null && totals !== null && (
        <>
          <div className="usage-cards">
            {[
              { key: "total", label: t("usage.totalLine"), value: totalTokens },
              { key: "input", label: t("usage.input"), value: totals.inputTokens },
              { key: "output", label: t("usage.output"), value: totals.outputTokens },
              { key: "turns", label: t("usage.turns"), value: totals.turns },
            ].map((card) => (
              <div className="usage-card" key={card.key}>
                <span className="usage-card-value">{compact(card.value)}</span>
                <span className="usage-card-label">{card.label}</span>
              </div>
            ))}
          </div>

          {totals.estimated && (
            <div className="usage-note" role="note" title={t("usage.estimatedHint")}>
              {t("usage.estimated")} · {t("usage.estimatedHint")}
            </div>
          )}

          {empty ? (
            <div className="usage-empty">{t("usage.empty")}</div>
          ) : (
            <>
              <div className="settings-section-title">{t("usage.daily")}</div>
              <div className="settings-card usage-chart-card">
                <span className="usage-legend">
                  <span className="usage-legend-item"><i className="usage-dot usage-dot-input" />{t("usage.input")}</span>
                  <span className="usage-legend-item"><i className="usage-dot usage-dot-output" />{t("usage.output")}</span>
                </span>
                <TrendChart points={summary.byDay} />
                <div className="usage-axis-labels">
                  <span>{summary.byDay[0]?.day.slice(5) ?? ""}</span>
                  <span>{summary.byDay[summary.byDay.length - 1]?.day.slice(5) ?? ""}</span>
                </div>
              </div>

              <div className="settings-section-title">{t("usage.byModel")}</div>
              <div className="settings-card usage-table-card">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>{t("usage.modelColumn")}</th>
                      <th>{t("usage.input")}</th>
                      <th>{t("usage.output")}</th>
                      <th>{t("usage.share")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byModel.map((row, index) => (
                      <tr key={row.model}>
                        <td>
                          <i className="usage-dot" style={{ background: RING_COLORS[index % RING_COLORS.length] }} />
                          {row.model}
                        </td>
                        <td>{compact(row.inputTokens)}</td>
                        <td>{compact(row.outputTokens)}</td>
                        <td>{share(row.inputTokens + row.outputTokens, totalTokens)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="usage-share-wrap">
                  <ShareRing
                    rows={summary.byModel.map((row) => ({ model: row.model, tokens: row.inputTokens + row.outputTokens }))}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {loading && totals === null && !error && <div className="usage-empty">…</div>}
    </div>
  );
}
