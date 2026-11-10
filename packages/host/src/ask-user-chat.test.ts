import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startApplicationToolServer, type ApplicationToolServer } from "./app-tool-channel.js";

const hosts: DeepSeekBotHost[] = [];
const servers: ApplicationToolServer[] = [];
const roots: string[] = [];
const question = {
  question: "Which first?",
  options: [
    { id: "A", label: "Alpha" },
    { id: "B", label: "Beta" },
  ],
  allowOther: true,
};

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "dsb-ask-user-chat-"));
  roots.push(root);
  const host = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "actor",
    instructions: "actor",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  const server = await startApplicationToolServer(host.agentTools);
  servers.push(server);
  const controller = new AbortController();
  const sessionId = `physical:${randomUUID()}`;
  const turn = server.openTurn({
    sessionId,
    caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
    signal: controller.signal,
  });
  const request = (path: string, body?: unknown, token = turn.env.DSB_APP_TOOLS_TOKEN) =>
    fetch(`${server.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { host, request, bot, sessionId };
}

describe("ask_user desktop answer return", () => {
  it("keeps ask_user off the eight-tool route and returns the desktop answer into chat", async () => {
    const { host, request, bot, sessionId } = await setup();
    const catalog = (await (await request("/app-tools")).json()) as {
      tools: Array<{ name: string }>;
    };
    expect(catalog.tools.map((tool) => tool.name)).not.toContain("ask_user");
    expect(catalog.tools).toHaveLength(19); // schedules, skills, read_workspace_file, write_document, write_presentation
    expect(
      await (
        await request("/app-tools/call", {
          sessionId,
          callId: randomUUID(),
          tool: "ask_user",
          params: question,
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const schema = (await (await request("/ask-user")).json()) as { tool: { name: string } };
    expect(schema.tool.name).toBe("ask_user");
    const pending = request("/ask-user/call", {
      sessionId,
      callId: randomUUID(),
      tool: "ask_user",
      params: question,
    });
    const listed = await vi.waitFor(async () => {
      const response = (await host.handleMethod("question.list", { botId: bot.id })) as {
        questions: Array<{ requestId: string; question: string; allowOther: boolean }>;
      };
      expect(response.questions).toHaveLength(1);
      return response.questions[0]!;
    });
    expect(listed.question).toBe("Which first?");
    expect(listed).not.toHaveProperty("callerId");
    const other = (await host.handleMethod("bot.create", {
      name: "other",
      instructions: "other",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    expect(await host.handleMethod("question.list", { botId: other.id })).toEqual({
      questions: [],
    });
    await expect(
      host.handleMethod("question.answer", {
        botId: other.id,
        requestId: listed.requestId,
        optionId: "A",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      (await host.handleMethod("question.list", { botId: bot.id })) as { questions: unknown[] },
    ).toMatchObject({ questions: [{ requestId: listed.requestId }] });

    const answered = (await host.handleMethod("question.answer", {
      botId: bot.id,
      requestId: listed.requestId,
      optionId: "A",
    })) as { text: string; optionId: string; messageId: string };
    expect(answered).toMatchObject({ optionId: "A", text: "Alpha" });
    expect(await (await pending).json()).toEqual({
      ok: true,
      result: { requestId: listed.requestId, optionId: "A", text: "Alpha" },
    });
    expect(await host.handleMethod("chat.history", { botId: bot.id })).toMatchObject({
      messages: [
        {
          role: "assistant",
          text: expect.stringContaining("Which first?"),
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
        },
        { id: answered.messageId, role: "user", text: "Alpha" },
      ],
    });
    expect(await host.handleMethod("question.list", { botId: bot.id })).toEqual({ questions: [] });
    expect(await host.handleMethod("chat.history", { botId: other.id })).toEqual({ messages: [] });
  });

  it("forces the fallback label for D and persists the question with the answer", async () => {
    const { host, request, bot, sessionId } = await setup();
    const pending = request("/ask-user/call", {
      sessionId,
      callId: randomUUID(),
      tool: "ask_user",
      params: {
        question: "整理什么？",
        options: [
          { id: "A", label: "整理桌面文件" },
          { id: "D", label: "都不对" },
        ],
        allowOther: false,
      },
    });
    const listed = await vi.waitFor(async () => {
      const response = (await host.handleMethod("question.list", { botId: bot.id })) as {
        questions: Array<{ requestId: string; options: Array<{ id: string; label: string }> }>;
      };
      expect(response.questions).toHaveLength(1);
      return response.questions[0]!;
    });
    // The Host never renders the model's own label for D.
    expect(listed.options).toContainEqual({ id: "D", label: "以上都不是" });
    expect(listed.options).not.toContainEqual({ id: "D", label: "都不对" });

    const answered = (await host.handleMethod("question.answer", {
      botId: bot.id,
      requestId: listed.requestId,
      optionId: "D",
    })) as { text: string };
    await pending;
    const history = (await host.handleMethod("chat.history", { botId: bot.id })) as {
      messages: Array<{ role: string; text: string; meta?: { answered?: string } }>;
    };
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]).toMatchObject({ role: "assistant" });
    expect(history.messages[0]!.text).toContain("【向用户提问】整理什么？");
    expect(history.messages[0]!.text).toContain("D. 以上都不是");
    expect(history.messages[0]!.text).not.toContain("都不对");
    expect(history.messages[0]!.meta).toEqual({
      kind: "choice",
      question: "整理什么？",
      options: [
        { id: "A", label: "整理桌面文件" },
        { id: "D", label: "以上都不是" },
      ],
      answered: answered.text,
    });
    expect(history.messages[1]).toMatchObject({ role: "user", text: answered.text });
  });

  it("stores free text and rejects it when the question disallows other answers", async () => {
    const { host, request, bot, sessionId } = await setup();
    const callId = randomUUID();
    const pending = request("/ask-user/call", {
      sessionId,
      callId,
      tool: "ask_user",
      params: { ...question, allowOther: false },
    });
    const listed = await vi.waitFor(async () => {
      const response = (await host.handleMethod("question.list", { botId: bot.id })) as {
        questions: Array<{ requestId: string; allowOther: boolean }>;
      };
      expect(response.questions).toHaveLength(1);
      return response.questions[0]!;
    });
    expect(listed.allowOther).toBe(false);
    await expect(
      host.handleMethod("question.answer", {
        botId: bot.id,
        requestId: listed.requestId,
        text: "something else",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await host.handleMethod("chat.history", { botId: bot.id })).toEqual({ messages: [] });
    const open = request("/ask-user/call", {
      sessionId,
      callId: randomUUID(),
      tool: "ask_user",
      params: question,
    });
    const free = await vi.waitFor(async () => {
      const response = (await host.handleMethod("question.list", { botId: bot.id })) as {
        questions: Array<{ requestId: string; allowOther: boolean }>;
      };
      const match = response.questions.find((item) => item.allowOther);
      expect(match).toBeDefined();
      return match!;
    });
    await host.handleMethod("question.answer", {
      botId: bot.id,
      requestId: free.requestId,
      text: "  Later today  ",
    });
    expect(await (await open).json()).toMatchObject({
      ok: true,
      result: { requestId: free.requestId, text: "Later today" },
    });
    expect(await host.handleMethod("chat.history", { botId: bot.id })).toMatchObject({
      messages: [
        {
          role: "assistant",
          text: expect.stringContaining("Which first?"),
          meta: {
            kind: "choice",
            question: "Which first?",
            answered: "Later today",
            other: true,
          },
        },
        { role: "user", text: "Later today" },
      ],
    });
    await host.handleMethod("question.answer", {
      botId: bot.id,
      requestId: listed.requestId,
      optionId: "B",
    });
    expect(await (await pending).json()).toMatchObject({
      ok: true,
      result: { optionId: "B", text: "Beta" },
    });
  });
});
