import { describe, expect, it } from "vitest";
import type { ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";
import { canAnswerChoice } from "../../src/renderer/src/features/questions/choice-answer.js";
import {
  CHAT_THREAD_HISTORY_LIMIT,
  historyMessageId,
  historyThreadMessages,
  isSameStoredTurn,
  mergeOpenedThread,
  SAME_TURN_WINDOW_MS,
  type ThreadOrigin,
  type ThreadRole,
} from "../../src/renderer/src/features/chat/thread-history.js";

const BOT = 4;
const OPENED_AT = Date.parse("2026-10-28T00:00:00.000Z");

function row(partial: {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  meta?: ChatHistoryRow["meta"];
}): ChatHistoryRow {
  return {
    id: partial.id,
    botId: "11111111-1111-4111-8111-111111111111",
    sessionId: "chat:11111111-1111-4111-8111-111111111111",
    role: partial.role,
    text: partial.text,
    at: partial.at,
    ...(partial.meta !== undefined ? { meta: partial.meta } : {}),
  };
}

function turn(partial: {
  from: ThreadRole;
  text: string;
  time: number;
  origin?: ThreadOrigin;
  id?: number;
}): {
  id: number;
  from: ThreadRole;
  text: string;
  time: number;
  origin: ThreadOrigin;
} {
  return {
    id: partial.id ?? partial.time,
    from: partial.from,
    text: partial.text,
    time: partial.time,
    origin: partial.origin ?? "live",
  };
}

describe("historyThreadMessages", () => {
  it("maps stored user and assistant rows in host order", () => {
    const messages = historyThreadMessages(
      [
        row({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "assistant",
          text: "later",
          at: "2026-10-28T00:00:02.000Z",
        }),
        row({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          role: "user",
          text: "earlier",
          at: "2026-10-28T00:00:01.000Z",
        }),
      ],
      BOT,
    );
    expect(messages.map((message) => message.text)).toEqual(["later", "earlier"]);
    expect(messages[0]).toMatchObject({
      from: "bot",
      speakerKey: BOT,
      origin: "history",
      history: true,
    });
    expect(messages[1]).toMatchObject({ from: "user", origin: "history", history: true });
    expect(messages[0]?.choices).toBeUndefined();
    expect(messages[1]?.speakerKey).toBeUndefined();
    expect(messages[0]?.time).toBe(Date.parse("2026-10-28T00:00:02.000Z"));
  });

  it("leaves dispatch and task-notice rows to the task feed", () => {
    const messages = historyThreadMessages(
      [
        row({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          role: "user",
          text: "hello",
          at: "2026-10-28T00:00:01.000Z",
        }),
        row({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          role: "assistant",
          text: "delegated",
          at: "2026-10-28T00:00:02.000Z",
          meta: {
            kind: "dispatch",
            taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            fromBotId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        }),
        row({
          id: "12121212-1212-4121-8121-121212121213",
          role: "assistant",
          text: "你好",
          at: "2026-10-28T00:00:02.500Z",
          meta: {
            kind: "dispatch_reply",
            taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            fromBotId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        }),
        row({
          id: "abababab-abab-4aba-8aba-abababababab",
          role: "assistant",
          text: "done",
          at: "2026-10-28T00:00:03.000Z",
          meta: {
            kind: "task_notice",
            taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            status: "done",
          },
        }),
        row({
          id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
          role: "assistant",
          text: "automation notice",
          at: "2026-10-28T00:00:04.000Z",
          meta: {
            kind: "automation",
            ruleId: "edededed-eded-4ede-8ede-edededededed",
            outcome: "started",
            runId: null,
          },
        }),
      ],
      BOT,
    );
    expect(messages.map((message) => message.text)).toEqual(["hello"]);
    expect(messages[0]?.history).toBe(true);
  });

  it("restores an answered choice card and keeps it locked", () => {
    const messages = historyThreadMessages(
      [
        row({
          id: "12121212-1212-4121-8121-121212121212",
          role: "assistant",
          text: "【向用户提问】Which first?\nA. Alpha\nB. Beta",
          at: "2026-10-28T00:00:01.000Z",
          meta: {
            kind: "choice",
            question: "Which first?",
            options: [
              { id: "A", label: "Alpha" },
              { id: "B", label: "Beta" },
            ],
            other: true,
            answered: "Alpha",
          },
        }),
        row({
          id: "34343434-3434-4343-8343-343434343434",
          role: "user",
          text: "Alpha",
          at: "2026-10-28T00:00:02.000Z",
        }),
      ],
      BOT,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      from: "bot",
      history: true,
      speakerKey: BOT,
      choices: {
        question: "Which first?",
        other: true,
        answered: "Alpha",
        options: [
          { id: "A", label: "Alpha" },
          { id: "B", label: "Beta" },
        ],
      },
    });
    expect(canAnswerChoice(messages[0]!)).toBe(false);
    expect(messages[1]).toMatchObject({ from: "user", history: true });
    expect(messages[1]?.choices).toBeUndefined();
    expect(canAnswerChoice(messages[1]!)).toBe(false);
  });

  it("uses stable negative ids that do not collide", () => {
    const used = new Set<number>();
    const first = historyMessageId("same-row", used);
    const second = historyMessageId("same-row", used);
    expect(first).toBeLessThan(0);
    expect(second).toBeLessThan(0);
    expect(second).not.toBe(first);
    const again = historyThreadMessages(
      [
        row({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "user",
          text: "hello",
          at: "2026-10-28T00:00:01.000Z",
        }),
      ],
      BOT,
    );
    const repeat = historyThreadMessages(
      [
        row({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "user",
          text: "hello",
          at: "2026-10-28T00:00:01.000Z",
        }),
      ],
      BOT,
    );
    expect(again[0]?.id).toBe(repeat[0]?.id);
    expect(again[0]?.id).toBeLessThan(0);
  });

  it("keeps an unparsable timestamp instead of dropping the row", () => {
    const messages = historyThreadMessages(
      [
        row({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "user",
          text: "kept",
          at: "not-a-date",
        }),
      ],
      BOT,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.time).toBe(0);
  });

  it("asks the host for the contract maximum", () => {
    expect(CHAT_THREAD_HISTORY_LIMIT).toBe(200);
  });
});

describe("mergeOpenedThread", () => {
  const seed = [
    turn({ from: "bot", text: "welcome", time: 1, origin: "seed", id: 1 }),
    turn({ from: "bot", text: "choices", time: 2, origin: "seed", id: 2 }),
  ];

  it("shows the welcome seed when the bot has no stored history", () => {
    expect(mergeOpenedThread([], [], seed)).toEqual(seed);
  });

  it("keeps the seed and a send that landed while an empty read was in flight", () => {
    const local = [...seed, turn({ from: "user", text: "hi", time: OPENED_AT, origin: "live" })];
    expect(mergeOpenedThread([], local, seed)).toEqual(local);
  });

  it("replaces the welcome seed with stored history", () => {
    const history = [
      turn({ from: "user", text: "hi", time: OPENED_AT - 60_000, origin: "history", id: -1 }),
      turn({ from: "bot", text: "hello", time: OPENED_AT - 59_000, origin: "history", id: -2 }),
    ];
    expect(mergeOpenedThread(history, seed, seed)).toEqual(history);
  });

  it("appends a new send that is not in the snapshot", () => {
    const history = [
      turn({ from: "user", text: "hi", time: OPENED_AT - 60_000, origin: "history", id: -1 }),
    ];
    const live = turn({ from: "user", text: "next", time: OPENED_AT, origin: "live", id: 9 });
    expect(mergeOpenedThread(history, [...seed, live], seed)).toEqual([...history, live]);
  });

  it("does not copy a live bubble the snapshot already stored", () => {
    const history = [
      turn({ from: "user", text: "hi", time: OPENED_AT, origin: "history", id: -1 }),
      turn({
        from: "bot",
        text: "hello",
        time: OPENED_AT + 20,
        origin: "history",
        id: -2,
      }),
    ];
    const local = [
      ...seed,
      turn({ from: "user", text: "hi", time: OPENED_AT + 5, origin: "live", id: 9 }),
      turn({ from: "bot", text: "hello", time: OPENED_AT + 30, origin: "live", id: 10 }),
    ];
    expect(mergeOpenedThread(history, local, seed)).toEqual(history);
  });

  it("keeps a repeated line once the previous copy is outside the same-turn window", () => {
    const history = [
      turn({
        from: "user",
        text: "ok",
        time: OPENED_AT - SAME_TURN_WINDOW_MS - 1,
        origin: "history",
        id: -1,
      }),
    ];
    const live = turn({ from: "user", text: "ok", time: OPENED_AT, origin: "live", id: 9 });
    expect(mergeOpenedThread(history, [live], seed).map((message) => message.id)).toEqual([-1, 9]);
  });

  it("keeps local notices that the host does not store", () => {
    const history = [
      turn({ from: "user", text: "hi", time: OPENED_AT - 60_000, origin: "history", id: -1 }),
    ];
    const notice = turn({ from: "bot", text: "", time: OPENED_AT, origin: "live", id: 11 });
    expect(mergeOpenedThread(history, [notice], seed)).toEqual([...history, notice]);
  });
});

describe("isSameStoredTurn", () => {
  const stored = turn({
    from: "bot",
    text: "hello",
    time: OPENED_AT,
    origin: "history",
    id: -2,
  });

  it("matches the stored copy of the reply just appended", () => {
    expect(isSameStoredTurn(stored, { from: "bot", text: "hello" }, OPENED_AT + 40)).toBe(true);
  });

  it("does not swallow a later reply that happens to repeat the text", () => {
    expect(
      isSameStoredTurn(stored, { from: "bot", text: "hello" }, OPENED_AT + SAME_TURN_WINDOW_MS + 1),
    ).toBe(false);
  });

  it("ignores live bubbles", () => {
    expect(
      isSameStoredTurn({ ...stored, origin: "live" }, { from: "bot", text: "hello" }, OPENED_AT),
    ).toBe(false);
  });
});
