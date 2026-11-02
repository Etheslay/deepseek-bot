/**
 * Pair transcript for two bots (the record behind 「已发消息给」 and
 * 「N 条消息往来」). A record is only that handoff: the sender's
 * instruction and the worker's reply. The human conversation that shares
 * the same session is not part of it. When one of the two turns was not
 * stored, the instruction or the worker's result fills the gap.
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

type PairBot = { id: string; key: number };

/**
 * The two handoff rows for one task. A tagged reply wins. Otherwise the
 * dispatch marker and the single assistant row right after it — never the
 * rest of the session.
 */
function handoffRows(rows: ChatHistoryRow[], taskId: string): ChatHistoryRow[] {
  const tagged = rows.filter((row) => {
    const meta = row.meta;
    if (meta === undefined) return false;
    if (meta.kind !== "dispatch" && meta.kind !== "dispatch_reply") return false;
    return meta.taskId === taskId;
  });
  if (tagged.some((row) => row.meta?.kind === "dispatch_reply")) {
    return tagged;
  }
  const start = rows.findIndex(
    (row) => row.meta?.kind === "dispatch" && row.meta.taskId === taskId,
  );
  if (start < 0) return tagged;
  const reply = rows
    .slice(start + 1)
    .find((row) => row.role === "assistant" && row.meta?.kind !== "task_notice");
  const marker = rows[start];
  return marker === undefined ? [] : reply === undefined ? [marker] : [marker, reply];
}

export function assemblePairRecords(
  me: PairBot,
  peer: PairBot,
  tasks: PairTask[],
  myRows: ChatHistoryRow[],
  peerRows: ChatHistoryRow[],
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
    const segmentRows = handoffRows(history, task.id);
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
      if (row.meta?.kind === "task_notice") continue;
      const speaker = row.role === "assistant" ? worker : manager;
      const text =
        row.meta?.kind === "dispatch" && row.role !== "assistant" && task.instruction !== ""
          ? task.instruction
          : row.text;
      rows.push({ kind: "turn", speakerKey: speaker.key, text, at: row.at });
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
