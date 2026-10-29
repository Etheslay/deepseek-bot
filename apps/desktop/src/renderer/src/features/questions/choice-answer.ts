/**
 * Seed-card answers (D14 seed card + choice answers).
 *
 * The answer has to live on the message, not in the chat pane's state: the pane
 * is keyed by the selected bot, so switching bots and coming back re-mounted it
 * and an already-answered card re-expanded into its full option list. Keeping
 * this pure keeps that rule testable — the pane only stores the result.
 */
export type AnswerableMessage = {
  id: number;
  /** Mirrors the chat message: the key may be present with an undefined value. */
  choices?: { answered?: string | undefined } | undefined;
};

/**
 * A card can be answered only while it is still open in this session.
 * Reloaded rows (`history: true`) and any card that already has an answer
 * stay locked, including a replay whose `answered` field was lost.
 */
export function canAnswerChoice(message: {
  history?: boolean | undefined;
  choices?: { answered?: string | undefined } | undefined;
}): boolean {
  if (message.history === true) {
    return false;
  }
  if (message.choices === undefined || message.choices.answered !== undefined) {
    return false;
  }
  return true;
}

/**
 * Mark the message whose id matches as answered and return a new array.
 * Messages without a card, and every other message, are returned untouched;
 * re-answering overwrites the previous answer, which keeps the function
 * idempotent for retries.
 */
export function answerSeedCard<T extends AnswerableMessage>(
  messages: readonly T[],
  msgId: number,
  text: string,
): T[] {
  return messages.map((message) =>
    message.id === msgId && message.choices
      ? { ...message, choices: { ...message.choices, answered: text } }
      : message,
  );
}
