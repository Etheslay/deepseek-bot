// @vitest-environment jsdom
/**
 * Clicking the bot named on a chat status line opens that pair's exchange
 * history. A hook under the pair-view return used to drop out and blank
 * the window instead.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskSchema, type Bot, type Task } from "@deepseek-bot/contracts";
import { BotsPlaceholder } from "../../src/renderer/src/App.js";
import type { UiBot } from "../../src/renderer/src/features/bots/use-bots.js";
import { ServiceProvider } from "../../src/renderer/src/services/service-context.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const ME = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  delete (window as unknown as { deepseekBot?: unknown }).deepseekBot;
});

function bot(id: string, name: string): Bot {
  return {
    id,
    revision: "22222222-2222-4222-8222-222222222222",
    name,
    instructions: "be brief",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
    role: "standard",
    archivedAt: null,
  };
}

function uiBot(key: number, id: string, name: string): UiBot {
  return {
    key,
    bot: bot(id, name),
    avatar: { kind: "mono" },
    shape: 0,
    color: 2,
    group: 1,
    unread: false,
    hidden: false,
  };
}

function sentTask(): Task {
  return TaskSchema.parse({
    id: "50000000-0000-4000-8000-000000000001",
    fromBotId: ME,
    toBotId: OTHER,
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
  });
}

describe("status line bot", () => {
  it("opens the pair chat history instead of blanking the window", async () => {
    const task = sentTask();
    window.deepseekBot = {
      host: {
        call: async (method: string) => {
          if (method === "chat.history") return { messages: [] };
          if (method === "task.list") return { tasks: [task] };
          if (method === "voice.status") {
            return {
              transcribe: { available: false, reason: null },
              speak: { available: false, reason: null },
            };
          }
          if (method === "chat.contextUsage") {
            return {
              percent: 0,
              usedTokens: 0,
              windowTokens: 1_000,
              estimated: true,
              compressedAt: null,
              compressing: false,
            };
          }
          if (method === "permission.approval.list") return { approvals: [] };
          if (method === "question.list") return { questions: [] };
          if (method === "search.results.list") return { searches: [] };
          throw new Error(`unexpected method ${method}`);
        },
      },
    } as unknown as Window["deepseekBot"];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(
          ServiceProvider,
          null,
          createElement(BotsPlaceholder, {
            bots: [uiBot(1, ME, "manager"), uiBot(2, OTHER, "writer")],
            groups: [],
            selectedBot: 1,
            stream: null,
            streamHandles: new Map(),
            onStreamUpdate: () => undefined,
            msgs: [],
            pairTranscripts: {},
            quoteDraft: null,
            onQuote: () => undefined,
            onPairQuote: () => undefined,
            onCancelQuote: () => undefined,
            onSend: () => undefined,
            onReact: () => undefined,
            onTalkTo: () => undefined,
            onCopy: () => undefined,
            onAssistant: () => undefined,
            onOpenBot: () => undefined,
            voiceLanguage: "zh",
            voiceConfigVersion: 0,
            onNotify: () => undefined,
            onBotStatus: () => undefined,
            onReplyCompleted: () => undefined,
            onApprovalPending: () => undefined,
            skillContext: () => ({ ok: true as const, skills: [] }),
            onAnswerSeedCard: () => undefined,
            onOpenAttachment: () => undefined,
            primitiveMode: false,
            onTogglePrimitive: () => undefined,
            deepThinking: false,
            onToggleDeepThinking: () => undefined,
            onOpenAutomation: () => undefined,
          }),
        ),
      );
    });

    const button = await new Promise<HTMLButtonElement>((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        const found = [...container.querySelectorAll("button")].find(
          (item) => item.textContent === "writer",
        );
        if (found) {
          resolve(found);
          return;
        }
        if (Date.now() - started > 3_000) {
          reject(new Error(`status line bot missing: ${container.textContent}`));
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    });

    await act(async () => {
      button.click();
    });

    const pair = container.querySelector(".pair-view");
    expect(pair).not.toBeNull();
    expect(pair?.textContent).toContain("manager");
    expect(pair?.textContent).toContain("writer");
    expect(pair?.textContent).toContain("关闭聊天");
  });
});
