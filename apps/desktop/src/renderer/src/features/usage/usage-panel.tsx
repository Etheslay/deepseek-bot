/**
 * 「用量与账单」token statistics (usage.summary).
 *
 * Reads aggregates only: the host records one row per finished turn, so this
 * panel never computes usage itself. Three views over the same window — a daily
 * trend, a model share ring with a legend, and a per-model table — plus the
 * totals above them.
 *
 * When any contributing turn had no usage block upstream, the response says
 * `totals.estimated`, and the page says so instead of presenting the number as
 * billed usage.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS, type UsageSummary } from "@deepseek-bot/contracts";
import { t, useLanguage } from "../../i18n.js";

type Scope = "bot" | "all";

const SERIES_COLORS = ["#6ea8ff", "#7fdbca", "#f5c66e", "#ff7b9c", "#9ae6a0", "#c3a6ff"];

/** Compact token counts: 12.3万 / 1.2M. */
function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function share(part: number, total: number): number {
  return total <= 0 ? 0 : Math.round((part / total) * 100);
}

/** Local "10-24" label from the YYYY-MM-DD bucket. */
function dayLabel(day: string): string {
  return day.slice(5).replace("-", "-");
}

interface TrendPoint {
  day: string;
  inputTokens: number;
  outputTokens: number;
}

const CHART = { width: 720, height: 240, left: 8, right: 8, top: 12, bottom: 26 };

/** Smooth path through the points (one cubic per segment). */
function smoothPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const c1 = from.x + (to.x - from.x) / 3;
    const c2 = from.x + (2 * (to.x - from.x)) / 3;
    path += ` C ${c1.toFixed(1)} ${from.y.toFixed(1)}, ${c2.toFixed(1)} ${to.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
  }
  return path;
}

/** Daily trend: grid, both series, date axis. */
function TrendChart(props: { points: ReadonlyArray<TrendPoint> }): JSX.Element | null {
  const points = props.points;
  if (points.length === 0) return null;
  const peak = Math.max(...points.map((point) => Math.max(point.inputTokens, point.outputTokens)), 1);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const xAt = (index: number): number =>
    CHART.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value: number): number => CHART.top + plotHeight - (value / peak) * plotHeight;

  const series = (key: "inputTokens" | "outputTokens"): ReadonlyArray<{ x: number; y: number }> =>
    points.map((point, index) => ({ x: xAt(index), y: yAt(point[key]) }));

  /* show every date for a week, otherwise only the ends and the middle */
  const labelIndexes =
    points.length <= 7
      ? points.map((_, index) => index)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <svg
      className="usage-trend"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={t("usage.daily")}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = CHART.top + plotHeight * fraction;
        return (
          <line
            key={fraction}
            x1={CHART.left}
            x2={CHART.width - CHART.right}
            y1={y}
            y2={y}
            className={fraction === 1 ? "usage-axis" : "usage-grid"}
          />
        );
      })}
      <path className="usage-line usage-line-input" d={smoothPath(series("inputTokens"))} />
      <path className="usage-line usage-line-output" d={smoothPath(series("outputTokens"))} />
      {points.length === 1 && (
        <>
          <circle cx={xAt(0)} cy={yAt(points[0]!.inputTokens)} r="3.5" className="usage-point usage-line-input" />
          <circle cx={xAt(0)} cy={yAt(points[0]!.outputTokens)} r="3.5" className="usage-point usage-line-output" />
        </>
      )}
      {labelIndexes.map((index) => (
        <text key={index} x={xAt(index)} y={CHART.height - 6} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="usage-axis-label">
          {dayLabel(points[index]!.day)}
        </text>
      ))}
    </svg>
  );
}

interface ShareRow {
  model: string;
  tokens: number;
}

/** Model share ring with its legend (percentage and absolute amount per model). */
function ShareCard(props: { rows: ReadonlyArray<ShareRow> }): JSX.Element | null {
  const rows = props.rows;
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  if (total <= 0) return null;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="usage-share">
      <svg className="usage-ring" viewBox="0 0 220 220" role="img" aria-label={t("usage.share")}>
        {rows.map((row, index) => {
          const length = (row.tokens / total) * circumference;
          const arc = (
            <circle
              key={row.model}
              cx="110"
              cy="110"
              r={radius}
              fill="none"
              strokeWidth="24"
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 110 110)"
            />
          );
          offset += length;
          return arc;
        })}
        <text x="110" y="106" textAnchor="middle" className="usage-ring-total">
          {compact(total)}
        </text>
        <text x="110" y="126" textAnchor="middle" className="usage-ring-unit">
          {t("usage.tokens")}
        </text>
      </svg>
      <ul className="usage-legend-list">
        {rows.map((row, index) => (
          <li key={row.model}>
            <i className="usage-dot" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
            <span className="usage-legend-name">{row.model}</span>
            <span className="usage-legend-pct">{share(row.tokens, total)}%</span>
            <span className="usage-legend-value">
              {compact(row.tokens)} {t("usage.tokens")}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
  const modelRows =
    summary === null
      ? []
      : summary.byModel.map((row) => ({ ...row, tokens: row.inputTokens + row.outputTokens }));

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

          {empty && <div className="usage-empty">{t("usage.empty")}</div>}

          {/*
           * The sections stay on screen with an empty state instead of vanishing:
           * a page whose charts disappear reads as "the feature is missing", not
           * "there is no data yet".
           */}
          <div className="settings-section-title">{t("usage.daily")}</div>
          <div className="settings-card usage-chart-card">
            <span className="usage-legend">
              <span className="usage-legend-item"><i className="usage-dot usage-dot-input" />{t("usage.input")}</span>
              <span className="usage-legend-item"><i className="usage-dot usage-dot-output" />{t("usage.output")}</span>
            </span>
            {summary.byDay.length === 0 ? (
              <div className="usage-chart-empty">{t("usage.empty")}</div>
            ) : (
              <TrendChart points={summary.byDay} />
            )}
          </div>

          <div className="settings-section-title">{t("usage.share")}</div>
          <div className="settings-card usage-pie-card">
            <ShareCard rows={modelRows.map((row) => ({ model: row.model, tokens: row.tokens }))} />
            {modelRows.length === 0 && <div className="usage-chart-empty">{t("usage.empty")}</div>}
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
                {modelRows.map((row, index) => (
                  <tr key={row.model}>
                    <td>
                      <i className="usage-dot" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
                      {row.model}
                    </td>
                    <td>{compact(row.inputTokens)}</td>
                    <td>{compact(row.outputTokens)}</td>
                    <td>{share(row.tokens, totalTokens)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {loading && totals === null && !error && <div className="usage-empty">…</div>}
    </div>
  );
}
