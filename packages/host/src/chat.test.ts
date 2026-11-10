import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppApproval } from "@deepseek-bot/contracts";
import { createBot } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

// 1×1 red PNG, base64 — the smallest valid raster.
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);
const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function hostWithBot(
  scenario = "ok",
  resolveApiKey: () => Promise<string> = async () => "sk-test-only",
  extraEnv: Record<string, string> = {},
  options: { onTurnStream?: (notice: { botId: string; sessionId: string; text: string }) => void } = {},
): Promise<{ host: DeepSeekBotHost; botId: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsb-chat-runtime-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey,
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, ...extraEnv, FAKE_SCENARIO: scenario }),
    ...(options.onTurnStream !== undefined ? { onTurnStream: options.onTurnStream } : {}),
  });
  hosts.push(host);
  const now = host.db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  host.db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const profileId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  const workspaceId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, join(root, "ws"), now, now);
  mkdirSync(join(root, "ws"), { recursive: true });
  const policyId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(
      policyId,
      randomUUID(),
      JSON.stringify({
        filesystem: { enabled: false, operations: [] },
        shell: { mode: "disabled" },
        network: { mode: "disabled" },
        mcp: { enabled: false, requireApproval: false, servers: [] },
      }),
      now,
      now,
    );
  await host.handleMethod("permission.policy.set", {
    capability: "app.create_group",
    mode: "ask",
  });
  const bot = createBot(host.db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "chat-bot",
      instructions: "be brief",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  });
  return { host, botId: bot.bot.id };
}

describe("chat runtime", () => {
  it("prepares MCP discovery before starting Harness and cancels preparation with the turn", async () => {
    const records = mkdtempSync(join(tmpdir(), "dsb-mcp-preparation-"));
    roots.push(records);
    let listing = false;
    const server = createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const rpc = JSON.parse(body) as { id?: number; method: string };
      if (rpc.method === "tools/list") {
        listing = true;
        return;
      }
      if (rpc.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "slow", version: "1" },
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("not listening");
      const { host, botId } = await hostWithBot("ok", async () => "unused", {
        FAKE_RECORD_DIR: records,
      });
      const connector = (await host.handleMethod("connector.register", {
        name: "slow",
        kind: "mcp-http",
        endpoint: `http://127.0.0.1:${address.port}/mcp`,
      })) as { id: string };
      await host.handleMethod("connector.enable", { id: connector.id });
      await host.handleMethod("connector.mcp.grants.set", {
        botId,
        id: connector.id,
        allowedTools: ["echo"],
      });
      const sent = host.handleMethod("chat.send", { botId, text: "prepare" });
      let settled = false;
      void sent.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.waitFor(() => expect(listing || settled).toBe(true));
      expect(listing).toBe(true);
      expect(existsSync(join(records, "fake-harness.jsonl"))).toBe(false);
      const cancelled = expect(sent).rejects.toMatchObject({ code: "CANCELLED" });
      await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` });
      await cancelled;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("keeps an application tool call waiting for approval and returns its actual result to Harness", async () => {
    const { host, botId } = await hostWithBot("app-tool");
    const sent = host.handleMethod("chat.send", { botId, text: "create group" });
    let approvals: AppApproval[] = [];
    await vi.waitFor(async () => {
      ({ approvals } = (await host.handleMethod("permission.approval.list", { botId })) as {
        approvals: AppApproval[];
      });
      expect(approvals).toHaveLength(1);
    });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
    const approval = approvals[0]!;
    expect(approval.sessionId).toBe(`chat:${botId}`);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    expect(await sent).toMatchObject({ text: expect.stringContaining('"name":"from Harness"') });
    expect(
      ((await host.handleMethod("group.list", {})) as { groups: unknown[] }).groups,
    ).toHaveLength(1);
  });
  it("cancels a pending application tool without leaving an approval or write", async () => {
    const { host, botId } = await hostWithBot("app-tool");
    const sent = host.handleMethod("chat.send", { botId, text: "cancel this write" });
    const cancelled = expect(sent).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(async () =>
      expect(
        (
          (await host.handleMethod("permission.approval.list", { botId })) as {
            approvals: unknown[];
          }
        ).approvals,
      ).toHaveLength(1),
    );
    expect(await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` })).toEqual({
      cancelled: true,
    });
    await cancelled;
    expect(await host.handleMethod("permission.approval.list", { botId })).toEqual({
      approvals: [],
    });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });
  it("can cancel while credential resolution is still pending", async () => {
    let release!: (value: string) => void;
    const credential = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { host, botId } = await hostWithBot("ok", () => credential);
    let failure: unknown;
    const sent = host
      .handleMethod("chat.send", { botId, text: "cancel before start" })
      .catch((error) => {
        failure = error;
      });
    await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` });
    try {
      await vi.waitFor(() => expect(failure).toMatchObject({ code: "CANCELLED" }));
    } finally {
      release("unused");
      await sent;
    }
  });
  it("accepts a follow-up while the previous turn is still closing", async () => {
    let release!: (value: string) => void;
    const credential = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { host, botId } = await hostWithBot("ok", () => credential);
    const first = host.handleMethod("chat.send", { botId, text: "第一句" });
    const cancelled = expect(first).rejects.toMatchObject({ code: "CANCELLED" });
    await host.handleMethod("chat.cancel", { sessionId: `chat:${botId}` });
    const second = host.handleMethod("chat.send", { botId, text: "插话" });
    release("unused");
    await cancelled;
    await expect(second).resolves.toMatchObject({ text: "fake final response" });
  });
  it("reads an aside into the same turn before the reply is committed", async () => {
    const records = mkdtempSync(join(tmpdir(), "dsb-aside-"));
    roots.push(records);
    const { host, botId } = await hostWithBot("slow-tool", async () => "sk-test-only", {
      FAKE_RECORD_DIR: records,
    });
    const sent = host.handleMethod("chat.send", { botId, text: "先做一版" });
    await vi.waitFor(async () => {
      expect(await host.handleMethod("chat.status", { botId })).toMatchObject({
        active: true,
        stage: "tool",
      });
    });
    await expect(
      host.handleMethod("chat.aside", { botId, text: "改成五页，给三年级" }),
    ).resolves.toEqual({ queued: true });
    await expect(sent).resolves.toMatchObject({ text: "fake final response" });
    const log = readFileSync(join(records, "fake-harness.jsonl"), "utf8");
    const prompts = log.split("\n").filter((line) => line.includes('"session/prompt"'));
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(log).toContain("改成五页，给三年级");
    expect(log).toContain("用意的变更");
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: { role: string; text: string }[];
    };
    expect(history.messages.map((message) => message.text)).toContain("改成五页，给三年级");
  });
  it("does not queue an aside when the bot is idle", async () => {
    const { host, botId } = await hostWithBot();
    await expect(host.handleMethod("chat.aside", { botId, text: "没人在答" })).resolves.toEqual({
      queued: false,
    });
  });
  it("sends a turn through the harness and persists both sides", async () => {
    const { host, botId } = await hostWithBot();
    const sent = (await host.handleMethod("chat.send", {
      botId,
      text: "你好",
    })) as { sessionId: string; text: string; messageId: string; at: string };
    expect(sent.sessionId.startsWith(`chat:${botId}`)).toBe(true);
    expect(sent.text).toBe("fake final response");
    const history = (await host.handleMethod("chat.history", { botId })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history.messages[1]?.text).toBe("fake final response");
  });

  it("humanizes credential failures instead of leaking raw system errors", async () => {
    const { host, botId } = await hostWithBot("ok", async () => {
      throw new Error(
        "ENOENT: no such file or directory, open 'D:\\data\\credentials\\00000000-0000-4000-8000-000000000001.blob'",
      );
    });
    let failure: { code: string; message: string } | undefined;
    try {
      await host.handleMethod("chat.send", { botId, text: "你好" });
    } catch (error) {
      failure = error as { code: string; message: string };
    }
    expect(failure).toBeDefined();
    expect(failure?.code).toBe("INVALID_INPUT");
    // One calm sentence with the fix — and none of the raw noise.
    expect(failure?.message).toContain("API Key");
    expect(failure?.message).toContain("设置");
    expect(failure?.message).not.toContain("ENOENT");
    expect(failure?.message).not.toContain("credentials");
    expect(failure?.message).not.toContain("\\");
  });

  it("carries payload images as prompt content blocks (B3'')", async () => {
    const records = mkdtempSync(join(tmpdir(), "dsb-chat-vision-records-"));
    roots.push(records);
    const { host, botId } = await hostWithBot("ok", async () => "unused", {
      FAKE_RECORD_DIR: records,
    });
    await host.handleMethod("chat.send", {
      botId,
      text: "这张图片里是什么颜色？",
      images: [{ data: pngBase64, mimeType: "image/png" }],
    });
    const lines = readFileSync(join(records, "fake-harness.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
    const prompt = lines.find((entry) => entry.method === "session/prompt");
    expect(prompt?.params.contentBlocks).toEqual([
      { type: "text", text: expect.stringContaining("这张图片里是什么颜色？") },
      { type: "image", data: pngBase64, mimeType: "image/png" },
    ]);
    // Plan 乙 (open-defects §2.1): the pinned catalog now distinguishes the
    // three rows — chat is cataloged text-only (known, not available), flash
    // is the vision model (both true), and an unregistered id stays neutral.
    const vision = (await host.handleMethod("vision.status", { botId })) as {
      model: string;
      visionAvailable: boolean;
      visionKnown: boolean;
    };
    expect(vision.model).toBe("deepseek-chat");
    expect(vision.visionKnown).toBe(true);
    expect(vision.visionAvailable).toBe(false);

    host.db.raw.prepare("UPDATE model_profiles SET model = 'deepseek-flash';").run();
    const flashVision = (await host.handleMethod("vision.status", { botId })) as {
      model: string;
      visionAvailable: boolean;
      visionKnown: boolean;
    };
    expect(flashVision.model).toBe("deepseek-flash");
    expect(flashVision.visionKnown).toBe(true);
    expect(flashVision.visionAvailable).toBe(true);

    host.db.raw.prepare("UPDATE model_profiles SET model = 'deepseek-vision-unknown';").run();
    const unknownVision = (await host.handleMethod("vision.status", { botId })) as {
      model: string;
      visionAvailable: boolean;
      visionKnown: boolean;
    };
    expect(unknownVision.model).toBe("deepseek-vision-unknown");
    expect(unknownVision.visionKnown).toBe(false);
    expect(unknownVision.visionAvailable).toBe(false);
  });

  it("replays history as context because each turn opens a fresh session", async () => {
    const { host, botId } = await hostWithBot();
    const first = (await host.handleMethod("chat.send", { botId, text: "one" })) as {
      sessionId: string;
    };
    const second = (await host.handleMethod("chat.send", { botId, text: "two" })) as {
      sessionId: string;
    };
    expect(second.sessionId).not.toBe(first.sessionId);
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("primitive mode answers just this step: no persona, no history replay, rows still persisted", async () => {
    const { host, botId } = await hostWithBot("echo-model");
    // Turn 1 (normal): no history exists yet, persona applies.
    const first = (await host.handleMethod("chat.send", { botId, text: "第一问" })) as {
      text: string;
    };
    expect(first.text).toContain("be brief");
    expect(first.text).not.toContain("【最近对话】");

    // Turn 2 (normal): the previous turn now replays as context.
    const normal = (await host.handleMethod("chat.send", { botId, text: "第二问" })) as {
      text: string;
    };
    expect(normal.text).toContain("be brief");
    expect(normal.text).toContain("【最近对话】");

    // Turn 3 (primitive): persona and replay drop out; the terse directive
    // replaces them and no earlier row leaks into the prompt.
    const terse = (await host.handleMethod("chat.send", {
      botId,
      text: "第三问",
      primitive: true,
    })) as { text: string };
    expect(terse.text).toContain("【原始人模式】");
    expect(terse.text).toContain("[用户消息]\n第三问");
    expect(terse.text).not.toContain("be brief");
    expect(terse.text).not.toContain("【最近对话】");
    expect(terse.text).not.toContain("第一问");
    expect(terse.text).not.toContain("第二问");

    // Turn 4 (normal): replay is back — the switch leaves no residue.
    const back = (await host.handleMethod("chat.send", { botId, text: "第四问" })) as {
      text: string;
    };
    expect(back.text).toContain("be brief");
    expect(back.text).toContain("【最近对话】");

    // Storage is untouched by the flag: every row of every turn is kept.
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(history.messages[4]?.text).toBe("第三问");
  });

  it("primitive mode keeps the explicitly attached skill block", async () => {
    const { host, botId } = await hostWithBot("echo-model");
    const sent = (await host.handleMethod("chat.send", {
      botId,
      text: "你好",
      primitive: true,
      skills: [{ name: "周报", version: 2, instructions: "只写三段。", capabilities: [] }],
    })) as { text: string };
    expect(sent.text).toContain("### 周报（v2）");
    expect(sent.text).toContain("【原始人模式】");
    expect(sent.text).not.toContain("be brief");
  });

  it("reports live turn progress from real harness events", async () => {
    const { host, botId } = await hostWithBot("slow-tool");    const idle = (await host.handleMethod("chat.status", { botId })) as { active: boolean };
    expect(idle.active).toBe(false);
    const sent = host.handleMethod("chat.send", { botId, text: "write hello.txt" });
    // Poll until the turn's tool stage shows up — the fake harness holds the
    // tool/call for 400ms, so the stage is observable, not raced.
    const sawTool = await new Promise<boolean>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        void host
          .handleMethod("chat.status", { botId })
          .then((status) => {
            const view = status as { active: boolean; stage: string; toolName?: string };
            if (view.stage === "tool" && view.toolName === "write") {
              clearInterval(timer);
              resolve(true);
            } else if (Date.now() - started > 3_000) {
              clearInterval(timer);
              resolve(false);
            }
          })
          .catch(() => undefined);
      }, 25);
    });
    expect(sawTool).toBe(true);
    expect((await sent) as unknown).toBeDefined();
    const settled = (await host.handleMethod("chat.status", { botId })) as { active: boolean };
    expect(settled.active).toBe(false);
  });

  it("streams live assistant segments while the turn runs", async () => {
    const notices: Array<{ botId: string; sessionId: string; text: string }> = [];
    const { host, botId } = await hostWithBot("narrated-tool", undefined, {}, {
      onTurnStream: (notice) => notices.push(notice),
    });
    const sent = (await host.handleMethod("chat.send", { botId, text: "do it" })) as {
      text: string;
    };
    // The narrated-tool turn settles two assistant messages: the narration
    // before the tool call and the final response. Both stream live.
    expect(notices.length).toBe(2);
    expect(notices[0]).toMatchObject({ botId, text: "先看看工作区。" });
    expect(notices[1]).toMatchObject({ text: "fake final response" });
    // Every notice carries the same per-turn session id.
    expect(new Set(notices.map((notice) => notice.sessionId)).size).toBe(1);
    // The authoritative reply is still the last segment only (D30 semantics).
    expect(sent.text).toBe("fake final response");
  });

  it("injects saved skills into the prompt and keeps them out of the user row", async () => {
    const { host, botId } = await hostWithBot("echo-model");
    const sent = (await host.handleMethod("chat.send", {
      botId,
      text: "你好",
      skills: [{ name: "周报", version: 2, instructions: "只写三段。", capabilities: [] }],
    })) as { text: string };
    expect(sent.text).toContain("### 周报（v2）");
    expect(sent.text).toContain("只写三段。");
    expect(sent.text).toContain("[用户消息]\n你好");
    const history = (await host.handleMethod("chat.history", { botId })) as {
      messages: Array<{ role: string; text: string }>;
    };
    expect(history.messages[0]).toMatchObject({ role: "user", text: "你好" });
    expect(history.messages[0]?.text).not.toContain("只写三段");
  });

  it("rejects a skill capability that is not a capability id", async () => {
    const { host, botId } = await hostWithBot();
    await expect(
      host.handleMethod("chat.send", {
        botId,
        text: "你好",
        skills: [{ name: "周报", version: 1, instructions: "只写三段。", capabilities: ["read"] }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const history = (await host.handleMethod("chat.history", { botId })) as { messages: unknown[] };
    expect(history.messages).toEqual([]);
  });

  it("blocks a tool the injected skill did not declare before opening an approval", async () => {
    const { host, botId } = await hostWithBot("app-tool");
    const sent = (await host.handleMethod("chat.send", {
      botId,
      text: "建组",
      skills: [{ name: "只读", version: 1, instructions: "不要创建。", capabilities: ["app.read"] }],
    })) as { text: string };
    expect(sent.text).toContain("UNAUTHORIZED_PATH");
    expect(await host.handleMethod("permission.approval.list", { botId })).toEqual({
      approvals: [],
    });
    expect(await host.handleMethod("group.list", {})).toEqual({ groups: [] });
  });

  it("still requires approval when the skill declares that capability", async () => {
    const { host, botId } = await hostWithBot("app-tool");
    const sent = host.handleMethod("chat.send", {
      botId,
      text: "建组",
      skills: [
        {
          name: "建组",
          version: 1,
          instructions: "可以创建分组。",
          capabilities: ["app.create_group"],
        },
      ],
    });
    let approvals: AppApproval[] = [];
    await vi.waitFor(async () => {
      ({ approvals } = (await host.handleMethod("permission.approval.list", { botId })) as {
        approvals: AppApproval[];
      });
      expect(approvals).toHaveLength(1);
    });
    const approval = approvals[0]!;
    expect(approval.capabilities).toContain("app.create_group");
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "approved",
      scope: "once",
    });
    await sent;
    expect(((await host.handleMethod("group.list", {})) as { groups: unknown[] }).groups).toHaveLength(
      1,
    );
  });

  it("rejects unknown bots and reports cancel state", async () => {
    const { host } = await hostWithBot();
    await expect(
      host.handleMethod("chat.send", { botId: randomUUID(), text: "hi" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const cancelled = (await host.handleMethod("chat.cancel", {
      sessionId: "chat:nope",
    })) as { cancelled: boolean };
    expect(cancelled.cancelled).toBe(false);
  });
});
