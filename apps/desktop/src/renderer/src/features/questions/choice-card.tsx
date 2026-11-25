/**
 * Shared choice card (D14 seed card + live ask_user clarification cards).
 *
 * One card, one answer. An answered card stays exactly where it was and keeps
 * its rows: the row the person picked is marked, everything else dims out
 * (`is-answered`). It deliberately does not collapse into a single ✓ line —
 * that line used to swallow free-text answers and read like an option the card
 * had offered. When the answer came from the composer instead of a row, no row
 * is marked and the card only dims. While an answer is in flight or the
 * composer owes the card a clarification, every row locks; a closed question
 * keeps its rows disabled with one expiry note. Rows are real buttons with
 * theme-variable colors and a visible focus ring.
 */
import type { JSX } from "react";
import { t } from "../../i18n.js";

export type ChoiceOption = { id: string; label: string };

export type ChoiceCardProps = {
  question: string;
  options: ChoiceOption[];
  /** Trailing fallback row ("其他，我说明" / forced D); clicks report it like any option. */
  fallback?: ChoiceOption | null;
  /** Set once the card is answered; the collapsed row shows this text only. */
  answered?: string | undefined;
  /** Locks every row (answer in flight / awaiting composer clarification). */
  disabled?: boolean;
  /** The question closed (expired or cancelled); rows render greyed out. */
  expired?: boolean;
  /** Note shown under the rows while locked (e.g. "answer in the composer"). */
  hint?: string | null;
  /** Timeline slot. The card stays there when later messages arrive. */
  order?: number;
  onChoose?: (option: ChoiceOption) => void;
};

const EXPIRED_NOTE = t("questions.expiredHint");

export function ChoiceCard({
  question,
  options,
  fallback,
  answered,
  disabled,
  expired,
  hint,
  order,
  onChoose,
}: ChoiceCardProps): JSX.Element {
  const rows = fallback ? [...options, fallback] : options;
  const isAnswered = answered !== undefined;
  /**
   * Rows normally survive the answer (the card dims, the picked row stays
   * marked). When the rows are gone — an answered request restored after a
   * reload only knows its text — fall back to a neutral line so the answer is
   * still readable, without the ✓ that made free text look like an option.
   */
  const onlyText = isAnswered && rows.length === 0;
  return (
    <div
      className={"choice-card" + (isAnswered ? " is-answered" : "")}
      role="group"
      aria-label={question}
      style={order === undefined ? undefined : { order }}
    >
      <div className="choice-question">{question}</div>
      {onlyText ? (
        <div className="choice-answered is-free" role="status" title={answered}>
          <span className="choice-answered-text">{answered}</span>
        </div>
      ) : (
      <div className="choice-options">
        {rows.map((option) => {
          const locked = isAnswered || disabled === true || expired === true;
          // Only a row the person actually picked is marked; a free-text
          // answer matches nothing (2026-11).
          const chosen = isAnswered && option.label === answered;
          return (
            <button
              key={option.id}
              type="button"
              className={
                "choice-option" +
                (option.id === fallback?.id ? " choice-other" : "") +
                (chosen ? " is-chosen" : "")
              }
              disabled={locked}
              aria-disabled={locked || undefined}
              aria-current={chosen || undefined}
              title={option.label}
              onClick={() => onChoose?.(option)}
            >
              <span className="choice-key" aria-hidden="true">
                {option.id}
              </span>
              <span className="choice-label">{option.label}</span>
            </button>
          );
        })}
      </div>
      )}
      {expired ? (
        <p className="choice-note" role="status">
          {EXPIRED_NOTE}
        </p>
      ) : hint ? (
        <p className="choice-note">{hint}</p>
      ) : null}
    </div>
  );
}
