/**
 * v0.5 manager orchestration UI tests (T5): the coordinator role switch in
 * the bot editor, the dispatched-task monitor tab (filter/cancel/chain hop)
 * and the chat-side dispatch/notice feed.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TaskSchema, type Bot, type Task } from "@deepseek-bot/contracts";
import { ServiceProvider } from "../../src/renderer/src/services/service-context.jsx";
import { BotForm } from "../../src/renderer/src/features/bots/bot-form.js";
import { TaskList } from "../../src/renderer/src/features/run-monitor/tasks/task-list.js";
import { TaskFeedCards } from "../../src/renderer/src/features/chat/task-feed.js";
import { createFixtureTaskService } from "../../src/renderer/src/features/run-monitor/tasks/task-service.js";
import { capabilityLabel } from "../../src/renderer/src/features/permissions/capability-labels.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";
import type { BotDraft, ChatHistoryRow } from "../../src/renderer/src/services/desktop-service.js";

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

describe("bot editor role switch (FR-1)", () => {
  it("submits the coordinator role and toggles back to standard", async () => {
    const submitted: BotDraft[] = [];
    const container = await render(
      createElement(BotForm, {
        submitLabel: "保存",
        onSubmit: async (draft) => {
          submitted.push(draft);
          return { ok: true };
        },
        onCancel: () => undefined,
        initial: {
          name: "manager",
          instructions: "负责派活",
          modelProfileId: "44444444-4444-4444-8444-444444444444",
          workspaceId: "55555555-5555-4555-8555-555555555555",
          toolPolicyId: "66666666-6666-4666-8666-666666666666",
          role: "standard",
        },
      }),
    );
    const chips = [...container.querySelectorAll<HTMLButtonElement>(".role-chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["标准", "协调者（可派发任务）"]);
    await act(async () => {
      chips[1]!.click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "保存")!
        .click();
    });
    expect(submitted[0]?.role).toBe("coordinator");
    await act(async () => {
      chips[0]!.click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "保存")!
        .click();
    });
    expect(submitted[1]?.role).toBe("standard");
  });
});

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

  it("renders the dispatch marker with its sender and the delivery notice jump", async () => {
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
        {
          id: "60000000-0000-4000-8000-000000000002",
          botId: COORDINATOR,
          sessionId: `chat:${COORDINATOR}`,
          role: "user",
          text: "任务通知（已完成）：manager 派发给 writer 的任务已完成。",
          meta: {
            kind: "task_notice",
            taskId: rootTask.id,
            status: "done",
            resultSummary: "清单完成",
          },
          at: "2026-10-26T09:01:10.000Z",
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
          onOpenBot: (botKey: number) => opened.push(botKey),
        }),
      ),
    );
    const feed = container.querySelector(".task-feed");
    expect(feed).not.toBeNull();
    const tag = feed!.querySelector<HTMLButtonElement>(".dispatch-tag");
    expect(tag?.textContent).toContain("manager");
    expect(feed!.querySelector(".dispatch-text")?.textContent).toContain("选题清单");
    // The notice resolves the executor through the task list and offers the jump.
    const notice = feed!.querySelector<HTMLButtonElement>(".task-notice.clickable");
    expect(notice?.textContent).toContain("查看执行者会话");
    await act(async () => {
      notice!.click();
    });
    expect(opened).toEqual([2]);
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
          onOpenBot: () => undefined,
        }),
      ),
    );
    expect(container.querySelector(".task-feed")).toBeNull();
  });
});
