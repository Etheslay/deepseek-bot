// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QuestionChatCards,
  type AnsweredQuestion,
} from "../../src/renderer/src/features/questions/question-chat.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const REQUEST = "11111111-1111-4111-8111-111111111111";

const QUESTION = {
  requestId: REQUEST,
  question: "Which first?",
  options: [
    { id: "A", label: "Alpha" },
    { id: "B", label: "Beta" },
    { id: "D", label: "model's own label" },
  ],
  allowOther: true,
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
};

const ANSWERED: AnsweredQuestion = {
  botId: BOT,
  question: "Which first?",
  text: "Alpha",
};

interface Call {
  method: string;
  payload: unknown;
}

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
});

interface Props {
  questions: unknown[];
  answers?: unknown[];
  answered?: Record<string, AnsweredQuestion>;
  clarifyRequestId?: string | null;
}

function installHost(props: Props): {
  calls: Call[];
  onAnswered: ReturnType<typeof vi.fn>;
  onUserBubble: ReturnType<typeof vi.fn>;
  onFallback: ReturnType<typeof vi.fn>;
} {
  const calls: Call[] = [];
  const onAnswered = vi.fn();
  const onUserBubble = vi.fn();
  const onFallback = vi.fn();
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        if (method === "question.list") return { questions: props.questions };
        if (method === "question.answer") {
          return (
            props.answers?.shift() ?? {
              requestId: REQUEST,
              optionId: "A",
              text: "Alpha",
              messageId: "33333333-3333-4333-8333-333333333333",
              at: "2026-10-26T06:30:00.000Z",
            }
          );
        }
        throw new Error(`unexpected method ${method}`);
      },
    },
  } as unknown as Window["deepseekBot"];
  return { calls, onAnswered, onUserBubble, onFallback };
}

async function renderCards(props: Props): Promise<{
  container: HTMLDivElement;
  calls: Call[];
  onAnswered: ReturnType<typeof vi.fn>;
  onUserBubble: ReturnType<typeof vi.fn>;
  onFallback: ReturnType<typeof vi.fn>;
}> {
  const host = installHost(props);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(QuestionChatCards, {
        botId: BOT,
        answered: props.answered ?? {},
        clarifyRequestId: props.clarifyRequestId ?? null,
        onAnswered: host.onAnswered,
        onUserBubble: host.onUserBubble,
        onFallback: host.onFallback,
      }),
    );
  });
  return { container, ...host };
}

function click(container: ParentNode, label: string): void {
  const button = [...container.querySelectorAll("button")].find((item) =>
    (item.textContent ?? "").includes(label),
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ask_user chat cards", () => {
  it("shows the pending question and returns the chosen option into the chat (U4/U7 renderer side)", async () => {
    const { container, calls, onAnswered, onUserBubble } = await renderCards({
      questions: [QUESTION],
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    expect(calls[0]).toEqual({ method: "question.list", payload: { botId: BOT } });
    expect(container.textContent).toContain("Alpha");
    await act(async () => {
      click(container, "Alpha");
    });
    expect(calls).toContainEqual({
      method: "question.answer",
      payload: { botId: BOT, requestId: REQUEST, optionId: "A" },
    });
    expect(onAnswered).toHaveBeenCalledWith(REQUEST, {
      botId: BOT,
      question: "Which first?",
      text: "Alpha",
    });
    expect(onUserBubble).toHaveBeenCalledWith("Alpha");
    expect(calls.some((call) => call.method === "chat.send")).toBe(false);
  });

  it("keeps the answered card visible with the picked row marked (U2)", async () => {
    const { container } = await renderCards({
      questions: [QUESTION],
      answered: { [REQUEST]: ANSWERED },
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    // 2026-11: the card no longer collapses; it dims and marks the picked row.
    expect(container.textContent).not.toContain("已选择");
    expect(container.textContent).toContain("Alpha");
    expect(container.querySelector(".choice-card")?.classList.contains("is-answered")).toBe(true);
    expect(container.querySelector(".choice-option.is-chosen")).not.toBeNull();
    expect(container.querySelector(".choice-answered")).toBeNull();
  });

  it("forces the D label and routes a D click to the composer instead of answering (U4)", async () => {
    const { container, calls, onFallback } = await renderCards({ questions: [QUESTION] });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    expect(container.textContent).not.toContain("model's own label");
    expect(container.textContent).toContain("以上都不是");
    await act(async () => {
      click(container, "以上都不是");
    });
    expect(onFallback).toHaveBeenCalledWith(REQUEST, "Which first?");
    expect(calls.some((call) => call.method === "question.answer")).toBe(false);
  });

  it("answers D directly when the question disallows other text", async () => {
    const { container, calls, onFallback } = await renderCards({
      questions: [{ ...QUESTION, allowOther: false }],
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    await act(async () => {
      click(container, "以上都不是");
    });
    expect(onFallback).not.toHaveBeenCalled();
    expect(calls).toContainEqual({
      method: "question.answer",
      payload: { botId: BOT, requestId: REQUEST, optionId: "D" },
    });
  });

  it("still offers the D fallback when the model omitted it and free text is allowed", async () => {
    const { container, onFallback } = await renderCards({
      questions: [
        { ...QUESTION, options: [{ id: "A", label: "Alpha" }, { id: "B", label: "Beta" }] },
      ],
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Alpha");
    });
    expect(container.textContent).toContain("以上都不是");
    await act(async () => {
      click(container, "以上都不是");
    });
    expect(onFallback).toHaveBeenCalledWith(REQUEST, "Which first?");
  });

  it("hides the fallback when the question neither has D nor allows other answers", async () => {
    const { container } = await renderCards({
      questions: [
        {
          ...QUESTION,
          allowOther: false,
          options: [{ id: "A", label: "Alpha" }, { id: "B", label: "Beta" }],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Alpha");
    });
    expect(container.textContent).not.toContain("以上都不是");
  });

  it("locks the card while the composer owes the clarification (U3/U4)", async () => {
    const { container, onFallback, calls } = await renderCards({
      questions: [QUESTION],
      clarifyRequestId: REQUEST,
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    expect(container.textContent).toContain("请在下方输入框");
    for (const row of container.querySelectorAll("button")) {
      expect(row.disabled).toBe(true);
    }
    await act(async () => {
      click(container, "Alpha");
    });
    expect(onFallback).not.toHaveBeenCalled();
    expect(calls.some((call) => call.method === "question.answer")).toBe(false);
  });

  it("expires immediately when the deadline has passed and closes the answer channel (U6)", async () => {
    const { container, calls } = await renderCards({
      questions: [{ ...QUESTION, expiresAt: new Date(Date.now() - 1_000).toISOString() }],
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    expect(container.textContent).toContain("该问题已过期或已取消");
    for (const row of container.querySelectorAll("button")) {
      expect(row.disabled).toBe(true);
    }
    await act(async () => {
      click(container, "Alpha");
    });
    expect(calls.some((call) => call.method === "question.answer")).toBe(false);
  });

  it("keeps a request that vanished from question.list visible as expired (U6)", async () => {
    vi.useFakeTimers();
    const holder: { questions: unknown[] } = { questions: [QUESTION] };
    const calls: Call[] = [];
    const onAnswered = vi.fn();
    window.deepseekBot = {
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload });
          if (method === "question.list") return { questions: holder.questions };
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(QuestionChatCards, {
          botId: BOT,
          answered: {},
          clarifyRequestId: null,
          onAnswered,
          onUserBubble: vi.fn(),
          onFallback: vi.fn(),
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain("Which first?");
    // The turn was cancelled/expired host-side: the pending list empties.
    holder.questions = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(container.textContent).toContain("Which first?");
    expect(container.textContent).toContain("该问题已过期或已取消");
    for (const row of container.querySelectorAll("button")) {
      expect(row.disabled).toBe(true);
    }
    await act(async () => {
      click(container, "Alpha");
    });
    expect(onAnswered).not.toHaveBeenCalled();
    expect(calls.some((call) => call.method === "question.answer")).toBe(false);
  });

  it("keeps an expired-but-answered request dimmed instead of showing the expiry note", async () => {
    const { container } = await renderCards({
      questions: [],
      answered: { [REQUEST]: ANSWERED },
    });
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).not.toContain("该问题已过期");
    expect(container.querySelector(".choice-card")?.classList.contains("is-answered")).toBe(true);
  });
});
