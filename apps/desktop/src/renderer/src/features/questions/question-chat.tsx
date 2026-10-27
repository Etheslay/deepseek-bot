/**
 * Chat cards for a live ask_user question.
 * The open bot polls question.list and returns the choice through question.answer.
 * That answer is the tool result and a user chat row; it does not start another turn.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";

type Question = {
  requestId: string;
  question: string;
  options: Array<{ id: "A" | "B" | "C" | "D"; label: string }>;
  allowOther: boolean;
  expiresAt: string;
};

type Answered = { requestId: string; question: string; text: string };

export function QuestionChatCards({ botId }: { botId: string }): JSX.Element | null {
  return <BotQuestionCards key={botId} botId={botId} />;
}

function BotQuestionCards({ botId }: { botId: string }): JSX.Element | null {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = useRef(true);
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const response = await window.deepseekBot.host.call("question.list", { botId });
    const parsed = METHOD_CONTRACTS["question.list"].response.parse(response);
    if (!active.current || sequence !== loadSequence.current) return;
    setQuestions(parsed.questions);
    setNotice((current) => (current === "提问读取失败" ? null : current));
  }, [botId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice("提问读取失败");
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

  const submit = (
    question: Question,
    answer: { optionId: Question["options"][number]["id"] } | { text: string },
  ): void => {
    setBusyId(question.requestId);
    void window.deepseekBot.host
      .call("question.answer", { botId, requestId: question.requestId, ...answer })
      .then((response) => {
        const parsed = METHOD_CONTRACTS["question.answer"].response.parse(response);
        if (!active.current) return;
        setAnswered((current) =>
          current.some((item) => item.requestId === question.requestId)
            ? current
            : [
                ...current,
                { requestId: question.requestId, question: question.question, text: parsed.text },
              ],
        );
        setNotice(`已选择：${parsed.text}`);
        return load();
      })
      .catch(() => {
        if (active.current) setNotice("回答发送失败");
      })
      .finally(() => {
        if (active.current) setBusyId(null);
      });
  };

  const pending = (questions ?? []).filter(
    (question) => !answered.some((item) => item.requestId === question.requestId),
  );
  if (pending.length === 0 && answered.length === 0 && notice === null) return null;

  return (
    <div className="question-chat-cards">
      {pending.map((question) => (
        <div
          key={question.requestId}
          className="choice-card"
          role="group"
          aria-label={question.question}
        >
          <div className="choice-question">{question.question}</div>
          <div className="choice-options">
            {question.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="choice-option"
                disabled={busyId === question.requestId}
                onClick={() => submit(question, { optionId: option.id })}
              >
                <span className="choice-key">{option.id}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          {question.allowOther ? (
            <div className="choice-options">
              <span>其他，我说明</span>
              <input
                value={drafts[question.requestId] ?? ""}
                aria-label="其他，我说明"
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [question.requestId]: event.target.value }))
                }
              />
              <button
                type="button"
                className="choice-option"
                disabled={busyId === question.requestId}
                onClick={() => {
                  const text = (drafts[question.requestId] ?? "").trim();
                  if (text.length === 0) return;
                  submit(question, { text });
                }}
              >
                发送其他回答
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {answered.map((item) => (
        <div key={item.requestId} className="choice-card" role="group" aria-label={item.question}>
          <div className="choice-question">{item.question}</div>
          <div className="choice-answered">已选择：{item.text}</div>
        </div>
      ))}
      {notice !== null ? <p className="sys-line">{notice}</p> : null}
    </div>
  );
}
