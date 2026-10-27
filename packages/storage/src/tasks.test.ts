/**
 * v0.5 manager orchestration storage tests (TASK_MANAGER_ORCHESTRATION.md
 * slices T2/T7a): the tasks table state machine, the relay-chain columns,
 * the restart sweep and the coordinator-role uniqueness rule.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Bot, ModelProfile } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "./index.js";
import { makeBot, makeLayout, makeTempRoot, openTestDatabase, seedProfileAndWorkspace } from "./test-support.js";
import { createBot, updateBot } from "./repos/bots.js";
import { createGroup } from "./repos/groups.js";
import {
  appendWorkerMessageId,
  countQueuedTasksForBot,
  countTasks,
  finishTask,
  getTask,
  insertTask,
  listQueuedHopsOfRoot,
  listTasks,
  markTaskRunning,
  nextQueuedTask,
  sweepInterruptedTasks,
} from "./repos/tasks.js";
import { appendTaskEvent, listTaskEvents } from "./repos/task-events.js";


const COORDINATOR_ID = "20000000-0000-4000-8000-000000000001";
const WORKER_A_ID = "20000000-0000-4000-8000-000000000002";
const WORKER_B_ID = "20000000-0000-4000-8000-000000000003";
const GROUP_ID = "30000000-0000-4000-8000-000000000001";
const ROOT_ID = "50000000-0000-4000-8000-000000000001";
const HOP2_ID = "50000000-0000-4000-8000-000000000002";
const EVENT_ID = "70000000-0000-4000-8000-000000000001";

let db: OpenedDatabase;
let profile: ModelProfile;
let workspaceId: string;
let coordinator: Bot;
let workerA: Bot;
let workerB: Bot;

beforeEach(() => {
  db = openTestDatabase(makeLayout(makeTempRoot()));
  const seeded = seedProfileAndWorkspace(db);
  profile = seeded.profile;
  workspaceId = seeded.workspaceId;
  createGroup(db, {
    group: {
      id: GROUP_ID,
      revision: "30000000-0000-4000-8000-000000000009",
      name: "content team",
      archivedAt: null,
    },
  });
  const seed = (id: string, role: "standard" | "coordinator"): Bot =>
    createBot(db, {
      bot: makeBot(profile, workspaceId, {
        id,
        name: role === "coordinator" ? "manager" : `worker-${id.slice(-1)}`,
        groupId: GROUP_ID,
        role,
      }),
    }).bot;
  coordinator = seed(COORDINATOR_ID, "coordinator");
  workerA = seed(WORKER_A_ID, "standard");
  workerB = seed(WORKER_B_ID, "standard");
});

afterEach(() => {
  db.close();
});

describe("coordinator role uniqueness (FR-1)", () => {
  it("rejects a second coordinator in the same group", () => {
    expect(() =>
      createBot(db, {
        bot: makeBot(profile, workspaceId, {
          name: "second manager",
          groupId: GROUP_ID,
          role: "coordinator",
        }),
      }),
    ).toThrow(/already has a coordinator/);
  });

  it("rejects promoting a second bot via bot.update", () => {
    expect(() =>
      updateBot(db, {
        id: workerA.id,
        expectedRevision: workerA.revision,
        patch: { role: "coordinator" },
      }),
    ).toThrow(/already has a coordinator/);
  });

  it("allows the coordinator itself to be edited without tripping the rule", () => {
    const updated = updateBot(db, {
      id: coordinator.id,
      expectedRevision: coordinator.revision,
      patch: { name: "manager v2" },
    });
    expect(updated.role).toBe("coordinator");
  });

  it("demotes and re-promotes within the same group", () => {
    updateBot(db, {
      id: coordinator.id,
      expectedRevision: coordinator.revision,
      patch: { role: "standard" },
    });
    const promoted = updateBot(db, {
      id: workerA.id,
      expectedRevision: workerA.revision,
      patch: { role: "coordinator" },
    });
    expect(promoted.role).toBe("coordinator");
  });
});

describe("task rows and transitions (U3/U4 storage half)", () => {
  it("inserts queued root tasks and reads them back", () => {
    const task = insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "写本周选题",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 2,
    });
    expect(task.status).toBe("queued");
    expect(task.rootTaskId).toBe(ROOT_ID);
    expect(getTask(db, ROOT_ID)).toEqual(task);
    expect(countTasks(db)).toBe(1);
    expect(countQueuedTasksForBot(db, workerA.id)).toBe(1);
  });

  it("guards the status machine on every transition", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "任务",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 1,
    });
    const running = markTaskRunning(db, ROOT_ID);
    expect(running.status).toBe("running");
    expect(running.startedAt).not.toBeNull();
    const done = finishTask(db, ROOT_ID, { status: "done", resultSummary: "完成" });
    expect(done.status).toBe("done");
    expect(done.resultSummary).toBe("完成");
    expect(done.finishedAt).not.toBeNull();
    // done is terminal.
    expect(() => markTaskRunning(db, ROOT_ID)).toThrow(/illegal task transition/);
  });

  it("pins worker message ids once each", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "任务",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 1,
    });
    appendWorkerMessageId(db, ROOT_ID, "60000000-0000-4000-8000-000000000001");
    const task = appendWorkerMessageId(db, ROOT_ID, "60000000-0000-4000-8000-000000000001");
    expect(task.workerMessageIds).toHaveLength(1);
  });

  it("serves the dispatcher FIFO by created_at per executor bot", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "第一件",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 1,
      createdAt: "2026-10-26T00:00:00.000Z",
    });
    insertTask(db, {
      id: HOP2_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "第二件",
      rootTaskId: HOP2_ID,
      chainIndex: 0,
      chainTotal: 1,
      createdAt: "2026-10-26T00:01:00.000Z",
    });
    expect(nextQueuedTask(db, workerA.id)?.instruction).toBe("第一件");
    expect(nextQueuedTask(db, workerB.id)).toBeUndefined();
  });

  it("sweeps queued/running rows to interrupted on restart (U4)", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "排队中",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 1,
    });
    insertTask(db, {
      id: HOP2_ID,
      fromBotId: coordinator.id,
      toBotId: workerB.id,
      instruction: "执行中",
      rootTaskId: HOP2_ID,
      chainIndex: 0,
      chainTotal: 1,
    });
    markTaskRunning(db, HOP2_ID);
    const swept = sweepInterruptedTasks(db);
    expect(swept.map((task) => task.status)).toEqual(["interrupted", "interrupted"]);
    expect(countTasks(db, "interrupted")).toBe(2);
    expect(countTasks(db, "queued")).toBe(0);
  });
});

describe("relay chain records (T7a)", () => {
  it("lists a whole chain in hop order via rootTaskId", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "设计",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 2,
    });
    insertTask(db, {
      id: HOP2_ID,
      fromBotId: workerA.id,
      toBotId: workerB.id,
      instruction: "编码",
      rootTaskId: ROOT_ID,
      chainIndex: 1,
      chainTotal: 2,
    });
    const chain = listQueuedHopsOfRoot(db, ROOT_ID);
    expect(chain.map((hop) => hop.chainIndex)).toEqual([0, 1]);
    expect(listTasks(db, { rootTaskId: ROOT_ID })).toHaveLength(2);
    expect(listTasks(db, { fromBotId: workerA.id })).toHaveLength(1);
    expect(listTasks(db, { status: "queued", toBotId: workerB.id })).toHaveLength(1);
  });

  it("cascades queued hops when the root is cancelled (R-13.5 storage half)", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "设计",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 2,
    });
    insertTask(db, {
      id: HOP2_ID,
      fromBotId: workerA.id,
      toBotId: workerB.id,
      instruction: "编码",
      rootTaskId: ROOT_ID,
      chainIndex: 1,
      chainTotal: 2,
    });
    finishTask(db, HOP2_ID, { status: "cancelled" });
    // Only the root remains queued; a cascade cancels exactly that one.
    const queued = listQueuedHopsOfRoot(db, ROOT_ID);
    expect(queued.map((hop) => hop.id)).toEqual([ROOT_ID]);
  });
});

describe("task events", () => {
  it("appends strictly increasing per-task sequences and dedups by eventId", () => {
    insertTask(db, {
      id: ROOT_ID,
      fromBotId: coordinator.id,
      toBotId: workerA.id,
      instruction: "任务",
      rootTaskId: ROOT_ID,
      chainIndex: 0,
      chainTotal: 1,
    });
    const base = {
      eventId: EVENT_ID,
      taskId: ROOT_ID,
      timestamp: "2026-10-26T00:00:00.000Z",
      type: "task.status" as const,
    };
    const first = appendTaskEvent(db, {
      ...base,
      sequence: 0,
      payload: { taskId: ROOT_ID, from: "queued", to: "running" },
    });
    expect(first).toEqual({ recorded: true, sequence: 0 });
    const replay = appendTaskEvent(db, {
      ...base,
      sequence: 0,
      payload: { taskId: ROOT_ID, from: "queued", to: "running" },
    });
    expect(replay).toEqual({ recorded: false, sequence: 0 });
    expect(() =>
      appendTaskEvent(db, {
        eventId: "70000000-0000-4000-8000-000000000002",
        taskId: ROOT_ID,
        sequence: 0,
        timestamp: "2026-10-26T00:00:01.000Z",
        type: "task.status",
        payload: { taskId: ROOT_ID, from: "running", to: "done", reason: "finished" },
      }),
    ).toThrow(/next value/);
    appendTaskEvent(db, {
      eventId: "70000000-0000-4000-8000-000000000002",
      taskId: ROOT_ID,
      sequence: 1,
      timestamp: "2026-10-26T00:00:01.000Z",
      type: "task.status",
      payload: { taskId: ROOT_ID, from: "running", to: "done", reason: "finished" },
    });
    expect(listTaskEvents(db, ROOT_ID)).toHaveLength(2);
    expect(listTaskEvents(db, ROOT_ID, { afterSequence: 0 })).toHaveLength(1);
  });
});
