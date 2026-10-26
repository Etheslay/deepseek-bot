/**
 * TaskService (v0.5 manager orchestration, TASK_MANAGER_ORCHESTRATION.md §3.3
 * T5): dispatched-task query + human cancel over the `task.list`/`task.cancel`
 * contracts, plus the persisted chat history feed the chat view renders
 * dispatch markers and delivery notices from. The fixture implementation
 * keeps a small in-memory store so the monitoring tab stays interactive
 * without a host; the host service replaces it with real method calls.
 */
import { TaskSchema, type Task, type TaskStatus } from "@deepseek-bot/contracts";
import { ServiceError, type ChatHistoryRow } from "../../../services/desktop-service.js";

export type TaskQuery = {
  status?: TaskStatus;
  rootTaskId?: string;
  limit?: number;
};

export interface TaskServiceApi {
  /** task.list: optional status/root filters, ascending creation order. */
  list(query?: TaskQuery): Promise<{ tasks: Task[] }>;
  /** task.cancel: queued cancels directly, running rides chat cancel. */
  cancel(taskId: string): Promise<Task>;
}

export function createFixtureTaskService(): TaskServiceApi {
  const manager = "20000000-0000-4000-8000-000000000001";
  const writer = "20000000-0000-4000-8000-000000000002";
  const coder = "20000000-0000-4000-8000-000000000003";
  const chainRoot = "50000000-0000-4000-8000-000000000001";
  const store: Task[] = [
    TaskSchema.parse({
      id: chainRoot,
      fromBotId: manager,
      toBotId: writer,
      instruction: "出本周内容选题清单",
      status: "running",
      resultSummary: null,
      rootTaskId: chainRoot,
      chainIndex: 0,
      chainTotal: 2,
      createdAt: "2026-10-26T09:00:00.000Z",
      startedAt: "2026-10-26T09:00:01.000Z",
      finishedAt: null,
      workerMessageIds: [],
    }),
    TaskSchema.parse({
      id: "50000000-0000-4000-8000-000000000002",
      fromBotId: writer,
      toBotId: coder,
      instruction: "按选题清单起草正文",
      status: "queued",
      resultSummary: null,
      rootTaskId: chainRoot,
      chainIndex: 1,
      chainTotal: 2,
      createdAt: "2026-10-26T09:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      workerMessageIds: [],
    }),
    TaskSchema.parse({
      id: "50000000-0000-4000-8000-000000000003",
      fromBotId: manager,
      toBotId: coder,
      instruction: "整理上季度回顾",
      status: "running",
      resultSummary: null,
      rootTaskId: "50000000-0000-4000-8000-000000000003",
      chainIndex: 0,
      chainTotal: 1,
      createdAt: "2026-10-26T09:05:00.000Z",
      startedAt: "2026-10-26T09:05:01.000Z",
      finishedAt: null,
      workerMessageIds: [],
    }),
  ];

  return {
    list: async (query = {}) => {
      const filtered = store.filter(
        (task) =>
          (query.status === undefined || task.status === query.status) &&
          (query.rootTaskId === undefined || task.rootTaskId === query.rootTaskId),
      );
      const limit = query.limit ?? 50;
      return { tasks: filtered.slice(0, limit) };
    },
    cancel: async (taskId) => {
      const task = store.find((row) => row.id === taskId);
      if (task === undefined) {
        throw new ServiceError("INVALID_INPUT", "任务不存在", false);
      }
      if (task.status !== "queued" && task.status !== "running") {
        throw new ServiceError("INVALID_INPUT", `任务已处于 ${task.status}，无法取消`, false);
      }
      task.status = "cancelled";
      task.finishedAt = new Date().toISOString();
      // Fixture mirrors the host cascade: queued hops of the chain follow.
      for (const hop of store) {
        if (
          hop.rootTaskId === task.rootTaskId &&
          hop.id !== task.id &&
          hop.status === "queued"
        ) {
          hop.status = "cancelled";
          hop.finishedAt = task.finishedAt;
        }
      }
      return { ...task };
    },
  };
}

/** Shared no-op history for the fixture chat (rows live in the UI state). */
export function fixtureChatHistory(_botId: string, _limit = 100): ChatHistoryRow[] {
  return [];
}
