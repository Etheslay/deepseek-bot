/**
 * Context circle (TASK_CONTEXT_METER.md): a small ring at the composer that
 * shows how much of the model context the bot's chat session already fills.
 * Hover speaks the percentage; ≥80% turns the ring to the warning tone
 * because that is where the Host starts folding older history. Pure display
 * — it carries no switch and never gates a send.
 */
import { type JSX } from "react";
import { t } from "../../i18n.js";
import type { ContextUsageView } from "../../services/desktop-service.js";

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ContextRing(props: { usage: ContextUsageView | null }): JSX.Element {
  const { usage } = props;
  const percent = Math.max(0, Math.min(100, usage?.percent ?? 0));
  const warn = percent >= 80;
  return (
    <span
      className={"context-ring" + (warn ? " warn" : "")}
      data-testid="context-ring"
      title={t("shell.contextUsed", [String(percent)])}
      aria-label={t("shell.contextUsed", [String(percent)])}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle className="context-ring-track" cx="10" cy="10" r={RING_RADIUS} />
        <circle
          className="context-ring-fill"
          cx="10"
          cy="10"
          r={RING_RADIUS}
          strokeDasharray={`${(percent / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 10 10)"
        />
      </svg>
      {percent > 0 && <span className="context-ring-value">{percent}</span>}
    </span>
  );
}
