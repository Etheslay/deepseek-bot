/**
 * Chat cards for a live ask_user question.
 * The open bot polls question.list and returns the choice through question.answer.
 * That answer is the tool result and a user chat row; it does not start another turn.
 *
 * One card, one answer: the first successful answer locks the card, and a
 * request that vanishes from question.list without an answer renders as
 * expired/cancelled with its rows disabled. The fallback row (D, forced to
 * 以上都不是) opens a composer clarification instead of answering directly
 * when the question allows free text — the typed text reaches the model
 * through the same question.answer path.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { pinSlotOrder, useTimelineTimes } from "../chat/timeline.js";
import { type Notice, noticeText, t, useLanguage } from "../../i18n.js";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { ChoiceCard, type ChoiceOption } from "./choice-card.js";

/** The Host never trusts the model's own label for the fallback option. */
export const OTHER_OPTION_ID = "D";
export const OTHER_OPTION_LABEL = t("questions.fallbackOption");

type Question = {
  requestId: string;
  question: string;
  options: Array<{ id: "A" | "B" | "C" | "D"; label: string }>;
  allowOther: boolean;
  expiresAt: string;
};

export type AnsweredQuestion = { botId: string; question: string; text: string };

export type QuestionChatCardsProps = {
  botId: string;
  /** requestId -> answered entry, lifted so composer-submitted clarifications land here too. */
  answered: Record<string, AnsweredQuestion>;
  onAnswered: (requestId: string, entry: AnsweredQuestion) => void;
  /** Appends the answer as a local user bubble (no new chat turn). */
  onUserBubble: (text: string) => void;
  /** Fallback row clicked with free text allowed: focus the composer for the answer. */
  onFallback: (requestId: string, question: string) => void;
  /** requestId currently awaiting composer text; that card stays locked. */
  clarifyRequestId: string | null;
};

export function QuestionChatCards(props: QuestionChatCardsProps): JSX.Element | null {
  return <BotQuestionCards key={props.botId} {...props} />;
}

function BotQuestionCards({
  botId,
  answered,
  onAnswered,
  onUserBubble,
  onFallback,
  clarifyRequestId,
}: QuestionChatCardsProps): JSX.Element | null {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [closed, setClosed] = useState<Record<string, true>>({});
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Last known payload per requestId; vanished questions render from it. */
  const known = useRef<Map<string, Question>>(new Map());
  const anchors = useRef<Map<string, number>>(new Map());
  const active = useRef(true);
  const loadSequence = useRef(0);
  const times = useTimelineTimes();

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const response = await window.deepseekBot.host.call("question.list", { botId });
    const parsed = METHOD_CONTRACTS["question.list"].response.parse(response);
    if (!active.current || sequence !== loadSequence.current) return;
    for (const question of parsed.questions) known.current.set(question.requestId, question);
    setQuestions(parsed.questions);
    setClosed((current) => {
      let changed = false;
      const next = { ...current };
      for (const id of known.current.keys()) {
        if (!parsed.questions.some((question) => question.requestId === id) && !(id in next)) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setNotice((current) => (current?.key === "questions.readFailed" ? null : current));
  }, [botId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice({ key: "questions.readFailed" });
      });
    };
    run();
    const timer = setInterval(run, 1_000);
    return () => {
      active.current = false;
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  const answer = (
    question: Question,
    payload: { optionId: Question["options"][number]["id"] } | { text: string },
    bubbleText: string,
  ): void => {
    setBusyId(question.requestId);
    void window.deepseekBot.host
      .call("question.answer", { botId, requestId: question.requestId, ...payload })
      .then((response) => {
        const parsed = METHOD_CONTRACTS["question.answer"].response.parse(response);
        if (!active.current) return;
        onAnswered(question.requestId, {
          botId,
          question: question.question,
          text: parsed.text,
        });
        onUserBubble(bubbleText);
        return load();
      })
      .catch(() => {
        if (active.current) setNotice({ key: "questions.answerFailed" });
      })
      .finally(() => {
        if (active.current) setBusyId(null);
      });
  };

  const isClosed = (question: Question): boolean =>
    closed[question.requestId] === true || Date.parse(question.expiresAt) <= Date.now();

  const slot = (id: string): number => {
    const knownAt = anchors.current.get(id);
    if (knownAt !== undefined) return pinSlotOrder(times, knownAt);
    const now = Date.now();
    anchors.current.set(id, now);
    return pinSlotOrder(times, now);
  };

  const pending = (questions ?? []).filter(
    (question) => answered[question.requestId] === undefined,
  );
  const vanished = Object.keys(closed).filter(
    (id) =>
      answered[id] === undefined &&
      !(questions ?? []).some((question) => question.requestId === id),
  );
  const answeredEntries = Object.entries(answered).filter(
    ([, entry]) => entry.botId === botId,
  );
  if (
    pending.length === 0 &&
    vanished.length === 0 &&
    answeredEntries.length === 0 &&
    notice === null
  )
    return null;

  return (
    <div className="question-chat-cards">
      {pending.map((question) => {
        const rows: ChoiceOption[] = question.options
          .filter((option) => option.id !== OTHER_OPTION_ID)
          .map((option) => ({ id: option.id, label: option.label }));
        const hasFallback =
          question.options.some((option) => option.id === OTHER_OPTION_ID) || question.allowOther;
        const clarify = clarifyRequestId === question.requestId;
        return (
          <ChoiceCard
            key={question.requestId}
            order={slot(question.requestId)}
            question={question.question}
            options={rows}
            fallback={hasFallback ? { id: OTHER_OPTION_ID, label: OTHER_OPTION_LABEL } : null}
            disabled={clarify || busyId === question.requestId}
            expired={isClosed(question)}
            hint={clarify ? t("questions.explainBelowPlaceholder") : null}
            onChoose={(option) => {
              if (option.id === OTHER_OPTION_ID) {
                if (question.allowOther) {
                  onFallback(question.requestId, question.question);
                } else {
                  answer(question, { optionId: OTHER_OPTION_ID }, option.label);
                }
                return;
              }
              answer(
                question,
                { optionId: option.id as Question["options"][number]["id"] },
                option.label,
              );
            }}
          />
        );
      })}
      {vanished.map((id) => {
        const knownQuestion = known.current.get(id);
        return (
          <ChoiceCard
            key={id}
            order={slot(id)}
            question={knownQuestion?.question ?? id}
            options={(knownQuestion?.options ?? []).map((option) => ({
              id: option.id,
              label: option.id === OTHER_OPTION_ID ? OTHER_OPTION_LABEL : option.label,
            }))}
            expired
          />
        );
      })}
      {answeredEntries.map(([requestId, entry]) => {
        // 2026-11: keep the card's original rows when the question is still
        // known, so an answered card dims with its picked row marked instead of
        // collapsing into a single ✓ line. When the rows are gone (after a
        // reload) only the neutral answer text can be shown.
        const knownQuestion = known.current.get(requestId);
        const rows: ChoiceOption[] = (knownQuestion?.options ?? [])
          .filter((option) => option.id !== OTHER_OPTION_ID)
          .map((option) => ({ id: option.id, label: option.label }));
        const hasFallback =
          knownQuestion !== undefined &&
          (knownQuestion.options.some((option) => option.id === OTHER_OPTION_ID) ||
            knownQuestion.allowOther);
        return (
          <ChoiceCard
            key={requestId}
            order={slot(requestId)}
            question={entry.question}
            options={rows}
            fallback={hasFallback ? { id: OTHER_OPTION_ID, label: OTHER_OPTION_LABEL } : null}
            answered={entry.text}
          />
        );
      })}
      {notice !== null ? (
        <p className="sys-line" style={{ order: slot("notice") }}>
          {noticeText(notice)}
        </p>
      ) : null}
    </div>
  );
}
