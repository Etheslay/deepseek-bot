/**
 * Pair transcript for two bots (the record behind 「已发消息给」 and
 * 「N 条消息往来」). History segments supply the words each side actually
 * sent. When a handoff has only one of those turns, the task instruction
 * and the worker's result fill the missing side so the record is a
 * two-sided exchange.
 */
import type { ChatHistoryRow } from "../../services/desktop-service.js";

export type PairRecord =
  | { kind: "turn"; speakerKey: number; text: string; at: string }
  | { kind: "notice"; text: string; at: string };

export type PairTask = {
  id: string;
  fromBotId: string;
  toBotId: string;
  instruction: string;
  resultSummary: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type NoticeStatus = Extract<NonNullable<ChatHistoryRow["meta"]>, { kind: "task_notice" }>["status"];

type PairBot = { id: string; key: number };

function segment(rows: ChatHistoryRow[]): Map<string, ChatHistoryRow[]> {
  const map = new Map<string, ChatHistoryRow[]>();
  let current: string | null = null;
  for (const row of rows) {
    if (row.meta?.kind === "dispatch") current = row.meta.taskId;
    if (row.meta?.kind === "task_notice") {
      const list = map.get(row.meta.taskId) ?? [];
      list.push(row);
      map.set(row.meta.taskId, list);
      continue;
    }
    if (current === null) continue;
    const list = map.get(current) ?? [];
    list.push(row);
    map.set(current, list);
  }
  return map;
}

export function assemblePairRecords(
  me: PairBot,
  peer: PairBot,
  tasks: PairTask[],
  myRows: ChatHistoryRow[],
  peerRows: ChatHistoryRow[],
  labelStatus: (status: NoticeStatus) => string,
): PairRecord[] {
  const who = (botId: string): PairBot | null => {
    if (botId === me.id) return me;
    if (botId === peer.id) return peer;
    return null;
  };
  const rows: PairRecord[] = [];
  const pairTasks = tasks
    .filter(
      (task) =>
        (task.fromBotId === me.id && task.toBotId === peer.id) ||
        (task.fromBotId === peer.id && task.toBotId === me.id),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const task of pairTasks) {
    const manager = who(task.fromBotId);
    const worker = who(task.toBotId);
    if (manager === null || worker === null) continue;
    const history = task.toBotId === peer.id ? peerRows : myRows;
    const segmentRows = segment(history).get(task.id) ?? [];
    const hasManagerTurn = segmentRows.some(
      (row) => row.meta?.kind !== "task_notice" && row.role !== "assistant",
    );
    const hasWorkerTurn = segmentRows.some(
      (row) => row.meta?.kind !== "task_notice" && row.role === "assistant",
    );
    if (!hasManagerTurn && task.instruction !== "") {
      rows.push({
        kind: "turn",
        speakerKey: manager.key,
        text: task.instruction,
        at: task.createdAt,
      });
    }
    for (const row of segmentRows) {
      if (row.meta?.kind === "task_notice") {
        const summary =
          row.meta.resultSummary !== undefined && row.meta.resultSummary.length > 0
            ? `：${row.meta.resultSummary}`
            : "";
        rows.push({
          kind: "notice",
          text: `${labelStatus(row.meta.status)}${summary}`,
          at: row.at,
        });
        continue;
      }
      const speaker = row.role === "assistant" ? worker : manager;
      rows.push({ kind: "turn", speakerKey: speaker.key, text: row.text, at: row.at });
    }
    if (!hasWorkerTurn && task.resultSummary !== null && task.resultSummary !== "") {
      rows.push({
        kind: "turn",
        speakerKey: worker.key,
        text: task.resultSummary,
        at: task.finishedAt ?? task.createdAt,
      });
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return rows;
}
