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
      (status) => status,
    );
    const turns = records.filter((row) => row.kind === "turn");
    expect(turns.map((row) => [row.speakerKey, row.text])).toEqual([
      [1, "【任务】出简笔画分镜"],
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
      at: "2026-10-26T09:00:40.000Z",
    };
    const records = assemblePairRecords(
      { id: MANAGER, key: 1 },
      { id: WRITER, key: 2 },
      [handoff],
      [],
      [marker("【任务】出简笔画分镜"), reply],
      (status) => status,
    );
    const turns = records.filter((row) => row.kind === "turn");
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({
      speakerKey: 2,
      text: "人物层已拆开，背景层倒过来。",
    });
  });
});
