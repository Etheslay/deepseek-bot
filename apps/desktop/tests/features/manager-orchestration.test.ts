/**
 * v0.5 manager orchestration UI tests (T5): the dispatched-task monitor tab
 * (filter/cancel/chain hop) and the chat-side dispatch/notice feed. The bot
 * editor role switch was removed by interop (TASK_BOT_INTEROP.md) — any bot
 * dispatches now, so there is no role switch left to test.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TaskSchema, type Bot, type Task } from "@deepseek-bot/contracts";
import { ServiceProvider } from "../../src/renderer/src/services/service-context.jsx";
import { TaskList } from "../../src/renderer/src/features/run-monitor/tasks/task-list.js";
import { buildFeedItems, TaskFeedCards } from "../../src/renderer/src/features/chat/task-feed.js";
import { createFixtureTaskService } from "../../src/renderer/src/features/run-monitor/tasks/task-service.js";
import { capabilityLabel } from "../../src/renderer/src/features/permissions/capability-labels.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";
import type { ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";

const roots: Root[] = [];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.textContent = "";
  /* the assertions below quote Chinese copy, so pin the language rather than
     inheriting the machine locale (D22 routes these labels through the catalogue) */
  setLanguagePreference("zh");
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  delete (window as { deepseekBot?: unknown }).deepseekBot;
});

async function render(component: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(component);
  });
  return container;
}

const COORDINATOR = "20000000-0000-4000-8000-000000000001";
const WRITER = "20000000-0000-4000-8000-000000000002";
const CODER = "20000000-0000-4000-8000-000000000003";

function task(overrides: Partial<Task>): Task {
  return TaskSchema.parse({
    id: "50000000-0000-4000-8000-000000000001",
    fromBotId: COORDINATOR,
    toBotId: WRITER,
    instruction: "出本周选题清单",
    status: "queued",
    resultSummary: null,
    rootTaskId: "50000000-0000-4000-8000-000000000001",
    chainIndex: 0,
    chainTotal: 1,
    createdAt: "2026-10-26T09:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    workerMessageIds: [],
    ...overrides,
  });
}

/** Flat Bot views — TaskList resolves names by id. */
const bots = [
  { id: COORDINATOR, name: "manager" },
  { id: WRITER, name: "writer" },
  { id: CODER, name: "coder" },
] as Bot[];

describe("dispatch capability label (FR-5/E6)", () => {
  it("names app.dispatch_task in the human permission surfaces", () => {
    setLanguagePreference("zh");
    expect(capabilityLabel("app.dispatch_task")).toBe("派发任务给其他 bot");
    setLanguagePreference("en");
    expect(capabilityLabel("app.dispatch_task")).toBe("Dispatch tasks to other bots");
  });
});

describe("task monitor tab (FR-6)", () => {
  it("renders statuses, the chain hop badge and filters", async () => {
    const tasks = [
      task({ status: "queued" }),
      task({
        id: "50000000-0000-4000-8000-000000000002",
        instruction: "按选题起草正文",
        status: "done",
        resultSummary: "已完成草稿",
        rootTaskId: "50000000-0000-4000-8000-000000000001",
        chainIndex: 1,
        chainTotal: 2,
      }),
      task({
        id: "50000000-0000-4000-8000-000000000003",
        fromBotId: WRITER,
        toBotId: CODER,
        instruction: "整理回顾",
        status: "failed",
      }),
    ];
    const container = await render(
      createElement(TaskList, {
        tasks,
        bots,
        onCancel: () => undefined,
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("排队中");
    expect(text).toContain("已完成");
    expect(text).toContain("已失败");
    expect(text).toContain("跳 2/2");
    expect(text).toContain("manager → writer");

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".task-filter")]
        .find((button) => button.textContent === "已失败")!
        .click();
    });
    expect(container.textContent).toContain("整理回顾");
    expect(container.textContent).not.toContain("出本周选题清单");
  });

  it("offers cancel only for cancellable rows and calls back once", async () => {
    const cancelled: string[] = [];
    const container = await render(
      createElement(TaskList, {
        tasks: [
          task({ status: "queued" }),
          task({ id: "50000000-0000-4000-8000-000000000004", status: "running" }),
          task({ id: "50000000-0000-4000-8000-000000000005", status: "done" }),
        ],
        bots,
        onCancel: (taskId) => {
          cancelled.push(taskId);
        },
      }),
    );
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".task-cancel")];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent)).toEqual(["取消", "中断回合"]);
    await act(async () => {
      buttons[0]!.click();
    });
    expect(cancelled).toEqual(["50000000-0000-4000-8000-000000000001"]);
  });
});

describe("fixture task service", () => {
  it("cancels a queued chain root and cascades its queued hop", async () => {
    const service = createFixtureTaskService();
    const page = await service.list();
    expect(page.tasks).toHaveLength(3);
    const root = page.tasks.find((row) => row.chainIndex === 0)!;
    const cancelled = await service.cancel(root.id);
    expect(cancelled.status).toBe("cancelled");
    const after = await service.list({ rootTaskId: root.rootTaskId });
    expect(after.tasks.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
    // The unrelated running task is untouched.
    const stillRunning = await service.list({ status: "running" });
    expect(stillRunning.tasks).toHaveLength(1);
    await expect(service.cancel(root.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("chat task feed (FR-4/FR-7)", () => {
  function installHost(history: ChatHistoryRow[], tasks: Task[]): void {
    window.deepseekBot = {
      host: {
        call: async (method: string) => {
          if (method === "chat.history") return { messages: history };
          if (method === "task.list") return { tasks };
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];
  }

  it("renders the exchange notices from real dispatch data (executor side)", async () => {
    const rootTask = task({ status: "done", resultSummary: "清单完成" });
    installHost(
      [
        {
          id: "60000000-0000-4000-8000-000000000001",
          botId: WRITER,
          sessionId: `chat:${WRITER}`,
          role: "user",
          text: "【任务】出本周选题清单",
          meta: { kind: "dispatch", taskId: rootTask.id, fromBotId: COORDINATOR },
          at: "2026-10-26T09:00:01.000Z",
        },
      ],
      [rootTask],
    );
    const opened: number[] = [];
    const container = await render(
      createElement(
        ServiceProvider,
        null,
        createElement(TaskFeedCards, {
          botId: WRITER,
          bots: [
            { key: 1, bot: { id: COORDINATOR, name: "manager", role: "coordinator" } },
            { key: 2, bot: { id: WRITER, name: "writer", role: "standard" } },
            { key: 3, bot: { id: CODER, name: "coder", role: "standard" } },
          ] as never,
          onOpenExchange: (botKey: number) => opened.push(botKey),
        }),
      ),
    );
    const feed = container.querySelector(".task-feed");
    expect(feed).not.toBeNull();
    expect(feed!.querySelector(".exchange-bubble")).toBeNull();
    expect(feed!.textContent).not.toContain("选题清单");
    expect(feed!.textContent).not.toContain("消息来自");
    const summary = feed!.querySelector(".chat-summary");
    expect(summary?.tagName).not.toBe("BUTTON");
    const chips = summary?.querySelectorAll("button.summary-bot") ?? [];
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain("manager");
    expect(summary?.textContent).not.toContain("writer");
    expect(summary?.textContent).not.toContain("和");
    await act(async () => {
      (chips[0] as HTMLButtonElement).click();
    });
    expect(opened).toEqual([1]);
    expect(summary?.textContent).toContain("1 条消息往来：");
  });

  it("renders the coordinator side: the sent notice, the reply, and the counter", async () => {
    const done = task({
      status: "done",
      resultSummary: "清单完成",
      finishedAt: "2026-10-26T09:01:00.000Z",
    });
    const queued = task({
      id: "50000000-0000-4000-8000-000000000002",
      rootTaskId: "50000000-0000-4000-8000-000000000002",
      status: "queued",
      instruction: "整理纪要",
      createdAt: "2026-10-26T09:02:00.000Z",
    });
    installHost([], [done, queued]);
    const container = await render(
      createElement(
        ServiceProvider,
        null,
        createElement(TaskFeedCards, {
          botId: COORDINATOR,
          bots: [
            { key: 1, bot: { id: COORDINATOR, name: "manager", role: "coordinator" } },
            { key: 2, bot: { id: WRITER, name: "writer", role: "standard" } },
          ] as never,
          onOpenExchange: () => undefined,
        }),
      ),
    );
    const feed = container.querySelector(".task-feed");
    expect(feed).not.toBeNull();
    const notices = feed!.querySelectorAll(".deliver-notice");
    expect(feed!.querySelector(".exchange-bubble")).toBeNull();
    expect(feed!.textContent).not.toContain("出本周选题清单");
    expect(feed!.textContent).not.toContain("清单完成");
    expect(feed!.textContent).not.toContain("整理纪要");
    expect(notices.length).toBe(2);
    expect(notices[0]?.textContent).toContain("已发消息给");
    expect(notices[1]?.textContent).toContain("已发消息给");
    expect(feed!.textContent).not.toContain("消息来自");
    const summary = feed!.querySelector(".chat-summary");
    const chips = summary?.querySelectorAll("button.summary-bot") ?? [];
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain("writer");
    expect(summary?.textContent).toContain("3 条消息往来：");
    expect(summary?.textContent).not.toContain("manager");
    expect(summary?.textContent).not.toContain("和");
  });

  it("opens the pair record from the other bot and ignores the status words", async () => {
    const done = task({
      status: "done",
      instruction: "请 writer 开渲",
      resultSummary: "你好",
      finishedAt: "2026-10-26T09:01:00.000Z",
    });
    installHost([], [done]);
    const opened: number[] = [];
    const container = await render(
      createElement(
        ServiceProvider,
        null,
        createElement(TaskFeedCards, {
          botId: COORDINATOR,
          bots: [
            { key: 1, bot: { id: COORDINATOR, name: "manager", role: "coordinator" } },
            { key: 2, bot: { id: WRITER, name: "writer", role: "standard" } },
          ] as never,
          onOpenExchange: (botKey: number) => opened.push(botKey),
        }),
      ),
    );
    const feed = container.querySelector(".task-feed");
    expect(feed).not.toBeNull();
    const notice = feed!.querySelector(".deliver-notice");
    expect(notice).not.toBeNull();
    expect(notice!.tagName).not.toBe("BUTTON");
    await act(async () => {
      notice!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(opened).toEqual([]);
    const writer = notice!.querySelector<HTMLButtonElement>("button.summary-bot");
    expect(writer).not.toBeNull();
    await act(async () => {
      writer!.click();
    });
    expect(opened).toEqual([2]);
  });

  it("keeps a sent line on the task's created time after it finishes", () => {
    const done = task({
      status: "done",
      resultSummary: "清单完成",
      createdAt: "2026-10-26T09:00:00.000Z",
      finishedAt: "2026-10-26T09:05:00.000Z",
    });
    const items = buildFeedItems(COORDINATOR, [], [done]);
    const sent = items.find((item) => item.kind === "sent");
    expect(sent?.at).toBe("2026-10-26T09:00:00.000Z");
  });

  it("renders nothing when the host has no marked rows", async () => {
    installHost([], []);
    const container = await render(
      createElement(
        ServiceProvider,
        null,
        createElement(TaskFeedCards, {
          botId: WRITER,
          bots: [
            { key: 2, bot: { id: WRITER, name: "writer", role: "standard" } },
          ] as never,
          onOpenExchange: () => undefined,
        }),
      ),
    );
    expect(container.querySelector(".task-feed")).toBeNull();
  });
});
