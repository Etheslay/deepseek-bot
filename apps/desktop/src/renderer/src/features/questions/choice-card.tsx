/**
 * Shared choice card (D14 seed card + live ask_user clarification cards).
 *
 * One card, one answer: once answered it collapses to a single ✓ row (the ✓
 * comes from the stylesheet, so the row carries only the answer text). While
 * an answer is in flight or the composer owes the card a free-text
 * clarification, every row locks; a closed question stays visible with its
 * rows disabled and one expiry note instead of disappearing or staying
 * clickable. Rows are real buttons with theme-variable colors and a visible
 * focus ring.
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
  return (
    <div className="choice-card" role="group" aria-label={question} style={order === undefined ? undefined : { order }}>
      <div className="choice-question">{question}</div>
      {answered !== undefined ? (
        <div className="choice-answered" role="status" title={answered}>
          <span className="choice-answered-text">{answered}</span>
        </div>
      ) : (
        <>
          <div className="choice-options">
            {rows.map((option) => {
              const locked = disabled === true || expired === true;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={
                    "choice-option" + (option.id === fallback?.id ? " choice-other" : "")
                  }
                  disabled={locked}
                  aria-disabled={locked || undefined}
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
          {expired ? (
            <p className="choice-note" role="status">
              {EXPIRED_NOTE}
            </p>
          ) : hint ? (
            <p className="choice-note">{hint}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
