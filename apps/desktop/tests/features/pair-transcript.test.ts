import { describe, expect, it } from "vitest";
import { assemblePairRecords } from "../../src/renderer/src/features/chat/pair-transcript.js";
import type { ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";

const MANAGER = "20000000-0000-4000-8000-000000000001";
const WRITER = "20000000-0000-4000-8000-000000000002";
const TASK = "50000000-0000-4000-8000-000000000001";

const handoff = {
  id: TASK,
  fromBotId: MANAGER,
  toBotId: WRITER,
  instruction: "出简笔画分镜",
  resultSummary: "分镜已交",
  createdAt: "2026-10-26T09:00:00.000Z",
  finishedAt: "2026-10-26T09:01:00.000Z",
};

function marker(text: string): ChatHistoryRow {
  return {
    id: "60000000-0000-4000-8000-000000000001",
    botId: WRITER,
    sessionId: `chat:${WRITER}`,
    role: "user",
    text,
    meta: { kind: "dispatch", taskId: TASK, fromBotId: MANAGER },
    at: "2026-10-26T09:00:01.000Z",
  };
}

describe("pair transcript", () => {
  it("fills the worker reply when history only has the dispatch", () => {
    const records = assemblePairRecords(
      { id: MANAGER, key: 1 },
      { id: WRITER, key: 2 },
      [handoff],
      [],
      [marker("【任务】出简笔画分镜")],
    );
    const turns = records.filter((row) => row.kind === "turn");
    expect(turns.map((row) => [row.speakerKey, row.text])).toEqual([
      [1, "出简笔画分镜"],
      [2, "分镜已交"],
    ]);
  });

  it("keeps the spoken reply instead of repeating the summary", () => {
    const reply: ChatHistoryRow = {
      id: "60000000-0000-4000-8000-000000000002",
      botId: WRITER,
      sessionId: `chat:${WRITER}`,
      role: "assistant",
      text: "人物层已拆开，背景层倒过来。",
      meta: { kind: "dispatch_reply", taskId: TASK, fromBotId: MANAGER },
      at: "2026-10-26T09:00:40.000Z",
    };
    const records = assemblePairRecords(
      { id: MANAGER, key: 1 },
      { id: WRITER, key: 2 },
      [handoff],
      [],
      [marker("【任务】出简笔画分镜"), reply],
    );
    const turns = records.filter((row) => row.kind === "turn");
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({
      speakerKey: 2,
      text: "人物层已拆开，背景层倒过来。",
    });
  });

  it("leaves the human conversation out of the handoff", () => {
    const human = (id: string, role: "user" | "assistant", text: string, at: string): ChatHistoryRow => ({
      id,
      botId: WRITER,
      sessionId: `chat:${WRITER}`,
      role,
      text,
      at,
    });
    const records = assemblePairRecords(
      { id: MANAGER, key: 1 },
      { id: WRITER, key: 2 },
      [handoff],
      [],
      [
        human("60000000-0000-4000-8000-000000000010", "user", "你好", "2026-10-26T08:00:00.000Z"),
        human(
          "60000000-0000-4000-8000-000000000011",
          "assistant",
          "你好，我在。写作和润色这块我可以帮你。",
          "2026-10-26T08:00:05.000Z",
        ),
        human(
          "60000000-0000-4000-8000-000000000012",
          "user",
          "让 2 给我发个你好",
          "2026-10-26T08:59:00.000Z",
        ),
        marker("【任务】给用户发一句“你好”，自然一点，简短即可。"),
        {
          id: "60000000-0000-4000-8000-000000000002",
          botId: WRITER,
          sessionId: `chat:${WRITER}`,
          role: "assistant",
          text: "你好",
          meta: { kind: "dispatch_reply", taskId: TASK, fromBotId: MANAGER },
          at: "2026-10-26T09:00:40.000Z",
        },
        human(
          "60000000-0000-4000-8000-000000000013",
          "assistant",
          "已经跟 2 号说好了，让他给你发句“你好”，应该马上就到。",
          "2026-10-26T09:01:10.000Z",
        ),
      ],
    );
    const turns = records.filter((row) => row.kind === "turn");
    expect(turns.map((row) => row.text)).toEqual(["出简笔画分镜", "你好"]);
  });
});
