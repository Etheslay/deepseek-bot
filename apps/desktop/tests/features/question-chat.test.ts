// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionChatCards } from "../../src/renderer/src/features/questions/question-chat.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const REQUEST = "11111111-1111-4111-8111-111111111111";

const QUESTION = {
  requestId: REQUEST,
  question: "Which first?",
  options: [
    { id: "A", label: "Alpha" },
    { id: "B", label: "Beta" },
  ],
  allowOther: true,
  expiresAt: "2026-10-26T07:00:00.000Z",
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

function installHost(questions: unknown[], answers: unknown[] = []): Call[] {
  const calls: Call[] = [];
  window.deepseekBot = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        if (method === "question.list") return { questions };
        if (method === "question.answer") {
          return (
            answers.shift() ?? {
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
  return calls;
}

async function renderCards(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(QuestionChatCards, { botId: BOT }));
  });
  return container;
}

function click(container: ParentNode, label: string): void {
  const button = [...container.querySelectorAll("button")].find((item) =>
    (item.textContent ?? "").includes(label),
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ask_user chat cards", () => {
  it("shows the pending question and returns the chosen option into the chat", async () => {
    const calls = installHost([QUESTION]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Which first?");
    });
    expect(calls[0]).toEqual({ method: "question.list", payload: { botId: BOT } });
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("其他，我说明");
    await act(async () => {
      click(container, "Alpha");
    });
    expect(calls).toContainEqual({
      method: "question.answer",
      payload: { botId: BOT, requestId: REQUEST, optionId: "A" },
    });
    expect(container.textContent).toContain("已选择：Alpha");
    expect(calls.some((call) => call.method === "chat.send")).toBe(false);
  });

  it("hides free text when the question does not allow it", async () => {
    installHost([{ ...QUESTION, allowOther: false }]);
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Beta");
    });
    expect(container.textContent).not.toContain("其他，我说明");
  });

  it("sends trimmed free text and keeps the answer visible after the question closes", async () => {
    const calls = installHost(
      [QUESTION],
      [
        {
          requestId: REQUEST,
          text: "Later today",
          messageId: "33333333-3333-4333-8333-333333333333",
          at: "2026-10-26T06:31:00.000Z",
        },
      ],
    );
    const container = await renderCards();
    await vi.waitFor(() => {
      expect(container.querySelector("input")).not.toBeNull();
    });
    const input = container.querySelector("input");
    if (input === null) throw new Error("missing other input");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "  Later today  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      click(container, "发送其他回答");
    });
    expect(calls).toContainEqual({
      method: "question.answer",
      payload: { botId: BOT, requestId: REQUEST, text: "Later today" },
    });
    expect(container.textContent).toContain("已选择：Later today");
  });
});
