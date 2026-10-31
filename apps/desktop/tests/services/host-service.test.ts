import { describe, expect, it } from "vitest";
import type {
  Approval,
  Bot,
  ChatSkillInjection,
  Run,
  Workflow,
  WorkflowDraft,
} from "@deepseek-bot/contracts";
import successRunFixture from "@deepseek-bot/contracts/fixtures/success-run.json";
import { createHostService } from "../../src/renderer/src/services/host-service.js";

const bot = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: "22222222-2222-4222-8222-222222222222",
  name: "note-summarizer",
  instructions: "summarize",
  modelProfileId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "55555555-5555-4555-8555-555555555555",
  toolPolicyId: "66666666-6666-4666-8666-666666666666",
  role: "standard",
  archivedAt: null,
} satisfies Bot;

function makeBridge(handlers: Record<string, (payload: unknown) => unknown>) {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const bridge = {
    host: {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload });
        const handler = handlers[method];
        if (!handler) throw new Error(`unexpected method ${method}`);
        return handler(payload);
      },
    },
    settings: { saveKey: async () => ({ configured: true }) },
  };
  return { bridge, calls };
}

describe("host-backed DesktopService", () => {
  it("lists bots through bot.list", async () => {
    const { bridge, calls } = makeBridge({ "bot.list": () => ({ bots: [bot] }) });
    const service = createHostService(bridge);
    await expect(service.bots.list()).resolves.toEqual([bot]);
    expect(calls[0]).toEqual({ method: "bot.list", payload: {} });
  });

  it("forwards create/update/archive payloads unchanged", async () => {
    const { bridge, calls } = makeBridge({
      "bot.create": () => bot,
      "bot.update": () => bot,
      "bot.archive": () => ({ ...bot, archivedAt: new Date().toISOString() }),
    });
    const service = createHostService(bridge);
    const draft = {
      name: "note-summarizer",
      instructions: "summarize",
      modelProfileId: bot.modelProfileId,
      workspaceId: bot.workspaceId,
      toolPolicyId: bot.toolPolicyId,
    };
    await service.bots.create(draft);
    await service.bots.update(bot.id, bot.revision, { name: "renamed" });
    await service.bots.archive(bot.id, bot.revision);
    expect(calls.map((call) => call.method)).toEqual([
      "bot.create",
      "bot.update",
      "bot.archive",
    ]);
    expect(calls[0]!.payload).toEqual(draft);
    expect(calls[1]!.payload).toEqual({
      id: bot.id,
      expectedRevision: bot.revision,
      patch: { name: "renamed" },
    });
  });

  it("duplicates by creating a copy with the 副本 suffix", async () => {
    const { bridge, calls } = makeBridge({
      "bot.list": () => ({ bots: [bot] }),
      "bot.create": () => ({ ...bot, name: `${bot.name} 副本` }),
    });
    const service = createHostService(bridge);
    await service.bots.duplicate(bot.id);
    expect(calls[1]).toMatchObject({
      method: "bot.create",
      payload: { name: "note-summarizer 副本" },
    });
  });

  it("saves the key through the safeStorage bridge and remembers it", async () => {
    const { bridge } = makeBridge({});
    const service = createHostService(bridge);
    expect(service.settings.keyConfigured()).toBe(false);
    await expect(service.settings.saveKey("sk-test")).resolves.toEqual({ configured: true });
    expect(service.settings.keyConfigured()).toBe(true);
  });

  it("maps the connection test response", async () => {
    const { bridge } = makeBridge({
      "settings.testConnection": () => ({ ok: true, latencyMs: 42 }),
    });
    const service = createHostService(bridge);
    await expect(
      service.settings.testConnection({ model: "deepseek-chat", endpoint: "https://api.deepseek.com" }),
    ).resolves.toEqual({ result: "success", ok: true, latencyMs: 42 });

    const { bridge: failing } = makeBridge({
      "settings.testConnection": () => ({ ok: false, errorCode: "AUTH_FAILED" }),
    });
    await expect(
      createHostService(failing).settings.testConnection({
        model: "deepseek-chat",
        endpoint: "https://api.deepseek.com",
      }),
    ).resolves.toEqual({ result: "failure", ok: false, errorCode: "AUTH_FAILED" });
  });

  it("turns a rejected host call into a failure result", async () => {
    const { bridge } = makeBridge({
      "settings.testConnection": () => {
        throw Object.assign(new Error("no key"), { code: "INVALID_INPUT" });
      },
    });
    await expect(
      createHostService(bridge).settings.testConnection({
        model: "deepseek-chat",
        endpoint: "https://api.deepseek.com",
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "INVALID_INPUT" });
  });
});

describe("host-backed chat", () => {
  it("streams the reply in chunks and resolves finish", async () => {
    const { bridge, calls } = makeBridge({
      "chat.send": () => ({
        sessionId: "chat:x",
        messageId: "m",
        text: "hello world",
        at: "2026-01-01T00:00:00.000Z",
      }),
      "chat.cancel": () => ({ cancelled: true }),
    });
    const service = createHostService(bridge);
    const deltas: string[] = [];
    const handle = service.chat.stream("bot-1", "hi", {
      onDelta: (chunk) => deltas.push(chunk),
      onTool: () => undefined,
    });
    const result = await handle.finish();
    expect(result.failure).toBeNull();
    expect(deltas.join("")).toBe("hello world");
    expect(calls[0]).toMatchObject({ method: "chat.send", payload: { botId: "bot-1", text: "hi" } });
  });

  it("forwards saved skills beside the user text", async () => {
    const { bridge, calls } = makeBridge({
      "chat.send": () => ({
        sessionId: "chat:x",
        messageId: "m",
        text: "ok",
        at: "2026-01-01T00:00:00.000Z",
      }),
    });
    const service = createHostService(bridge);
    const skill: ChatSkillInjection = {
      name: "周报",
      version: 1,
      instructions: "三段",
      capabilities: ["fs.read"],
    };
    const handle = service.chat.stream(
      "bot-1",
      "你好",
      { onDelta: () => undefined, onTool: () => undefined },
      { skills: [skill] },
    );
    await handle.finish();
    expect(calls[0]).toMatchObject({
      method: "chat.send",
      payload: { botId: "bot-1", text: "你好", skills: [skill] },
    });
  });

  it("sends into the requested storage session and cancels bot-scoped", async () => {
    const { bridge, calls } = makeBridge({
      "chat.send": () => ({
        sessionId: "chat:x:turn",
        messageId: "m",
        text: "ok",
        at: "2026-01-01T00:00:00.000Z",
      }),
      "chat.cancel": () => ({ cancelled: true }),
    });
    const service = createHostService(bridge);
    const handle = service.chat.stream(
      "bot-1",
      "hi",
      { onDelta: () => undefined, onTool: () => undefined },
      { sessionId: "cs:44444444-4444-4444-8444-444444444444" },
    );
    handle.cancel();
    await handle.finish();
    // G12: the turn lands in the requested session; the cancel key stays the
    // bot's default id because one turn per bot runs at a time.
    expect(calls[0]).toMatchObject({
      method: "chat.send",
      payload: { botId: "bot-1", text: "hi", sessionId: "cs:44444444-4444-4444-8444-444444444444" },
    });
    expect(calls[calls.length - 1]).toEqual({
      method: "chat.cancel",
      payload: { sessionId: "chat:bot-1" },
    });
  });

  it("surfaces host failures as chat failures", async () => {
    const { bridge } = makeBridge({
      "chat.send": () => {
        throw Object.assign(new Error("no key"), { code: "AUTH_FAILED" });
      },
      "chat.cancel": () => ({ cancelled: false }),
    });
    const service = createHostService(bridge);
    const handle = service.chat.stream("b", "x", {
      onDelta: () => undefined,
      onTool: () => undefined,
    });
    const result = await handle.finish();
    expect(result.failure).toMatchObject({ code: "AUTH_FAILED" });
  });

  it("reads chat.history for the open thread", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      botId: "22222222-2222-4222-8222-222222222222",
      sessionId: "chat:22222222-2222-4222-8222-222222222222",
      role: "user" as const,
      text: "remember this",
      at: "2026-10-28T00:00:00.000Z",
    };
    const { bridge, calls } = makeBridge({
      "chat.history": () => ({ messages: [row] }),
    });
    const service = createHostService(bridge);
    await expect(service.chat.history(row.botId, 200)).resolves.toEqual([row]);
    expect(calls).toEqual([
      { method: "chat.history", payload: { botId: row.botId, limit: 200 } },
    ]);
  });

  it("lists host session metadata and opens one by (botId, sessionId)", async () => {
    const botId = "22222222-2222-4222-8222-222222222222";
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      botId,
      sessionId: `chat:${botId}`,
      role: "user" as const,
      text: "remember this",
      at: "2026-10-28T00:00:01.000Z",
    };
    const { bridge, calls } = makeBridge({
      // G12: the sidebar reads real session metadata; extra sessions carry
      // `cs:` ids and travel beside the default one.
      "chat.session.list": () => ({
        sessions: [
          {
            sessionId: `chat:${botId}`,
            botId,
            title: "remember this",
            archived: false,
            messageCount: 1,
            createdAt: "2026-10-28T00:00:01.000Z",
            lastMessageAt: "2026-10-28T00:00:02.000Z",
          },
          {
            sessionId: `cs:33333333-3333-4333-8333-333333333333`,
            botId,
            title: "新的会话",
            archived: false,
            messageCount: 0,
            createdAt: "2026-10-28T00:10:00.000Z",
            lastMessageAt: "2026-10-28T00:10:00.000Z",
          },
        ],
      }),
      "chat.history": () => ({ messages: [row] }),
    });
    const service = createHostService(bridge);
    await expect(service.chat.listSessions(botId)).resolves.toEqual([
      {
        sessionId: `chat:${botId}`,
        botId,
        title: "remember this",
        startedAt: "2026-10-28T00:00:01.000Z",
        replayEventCount: 1,
        status: "active",
        archived: false,
        lastMessageAt: "2026-10-28T00:00:02.000Z",
      },
      {
        sessionId: `cs:33333333-3333-4333-8333-333333333333`,
        botId,
        title: "新的会话",
        startedAt: "2026-10-28T00:10:00.000Z",
        replayEventCount: 0,
        status: "active",
        archived: false,
        lastMessageAt: "2026-10-28T00:10:00.000Z",
      },
    ]);
    // openSession addresses the row by botId + session id; the read is scoped
    // server-side, so the payload carries the session.
    await expect(
      service.chat.openSession(botId, `cs:33333333-3333-4333-8333-333333333333`),
    ).resolves.toEqual({ events: [], messages: [row] });
    expect(calls[1]).toEqual({
      method: "chat.history",
      payload: { botId, limit: 200, sessionId: `cs:33333333-3333-4333-8333-333333333333` },
    });
  });

  it("returns an empty list when the host reports no sessions", async () => {
    const { bridge, calls } = makeBridge({
      "chat.session.list": () => ({ sessions: [] }),
    });
    const service = createHostService(bridge);
    await expect(service.chat.listSessions(bot.id)).resolves.toEqual([]);
    expect(calls).toEqual([{ method: "chat.session.list", payload: { botId: bot.id } }]);
  });

  it("createSession/renameSession/archiveSession round-trip the contract", async () => {
    const session = {
      sessionId: "cs:44444444-4444-4444-8444-444444444444",
      botId: bot.id,
      title: "新的会话",
      archived: false,
      messageCount: 0,
      createdAt: "2026-10-29T00:00:00.000Z",
      lastMessageAt: "2026-10-29T00:00:00.000Z",
    };
    const { bridge, calls } = makeBridge({
      "chat.session.create": () => ({ session }),
      "chat.session.rename": () => ({ session: { ...session, title: "周报整理" } }),
      "chat.session.archive": () => ({
        session: { ...session, title: "周报整理", archived: true },
      }),
    });
    const service = createHostService(bridge);
    await expect(service.chat.createSession(bot.id)).resolves.toMatchObject({
      sessionId: session.sessionId,
      status: "active",
    });
    await expect(service.chat.renameSession(bot.id, session.sessionId, "周报整理")).resolves.toMatchObject({
      title: "周报整理",
    });
    await expect(service.chat.archiveSession(bot.id, session.sessionId)).resolves.toMatchObject({
      archived: true,
      status: "ended",
    });
    expect(calls.map((call) => call.method)).toEqual([
      "chat.session.create",
      "chat.session.rename",
      "chat.session.archive",
    ]);
    expect(calls[1]?.payload).toEqual({
      botId: bot.id,
      sessionId: session.sessionId,
      title: "周报整理",
    });
  });

  it("cancel forwards to chat.cancel", async () => {
    const { bridge, calls } = makeBridge({
      "chat.send": () => new Promise(() => undefined),
      "chat.cancel": () => ({ cancelled: true }),
    });
    const service = createHostService(bridge);
    const handle = service.chat.stream("b", "x", {
      onDelta: () => undefined,
      onTool: () => undefined,
    });
    handle.cancel();
    expect(calls.some((call) => call.method === "chat.cancel")).toBe(true);
  });
});

describe("host-backed artifacts (D28 co-edit)", () => {
  const artifact = {
    relativePath: "notes/todo.md",
    mediaType: "text/markdown",
    size: 9,
    updatedAt: "2026-10-26T00:00:00.000Z",
    checksum: { algorithm: "sha256" as const, value: "a".repeat(64) },
  };
  const version = {
    id: "33333333-3333-4333-8333-333333333333",
    botId: bot.id,
    relativePath: "notes/todo.md",
    revision: 1,
    author: "user" as const,
    mediaType: "text/markdown",
    size: 9,
    checksum: { algorithm: "sha256" as const, value: "a".repeat(64) },
    createdAt: "2026-10-26T00:00:00.000Z",
  };

  it("routes the six artifacts methods to the host contract names", async () => {
    const { bridge, calls } = makeBridge({
      "artifacts.list": () => ({ artifacts: [artifact] }),
      "artifacts.read": () => ({ kind: "text", mediaType: "text/markdown", checksum: artifact.checksum, content: "# t\n" }),
      "artifacts.save": () => ({ artifact, version }),
      "artifacts.versions": () => ({ versions: [version] }),
      "artifacts.versionContent": () => ({ kind: "text", mediaType: "text/markdown", content: "old" }),
      "artifacts.revert": () => ({ artifact, version }),
    });
    const service = createHostService(bridge);
    await service.artifacts.list(bot.id);
    await service.artifacts.read(bot.id, "notes/todo.md");
    await service.artifacts.save(bot.id, "notes/todo.md", "# t\n", "a".repeat(64));
    await service.artifacts.versions(bot.id, "notes/todo.md");
    await service.artifacts.versionContent(bot.id, "notes/todo.md", version.id);
    await service.artifacts.revert(bot.id, "notes/todo.md", version.id);
    expect(calls.map((call) => call.method)).toEqual([
      "artifacts.list",
      "artifacts.read",
      "artifacts.save",
      "artifacts.versions",
      "artifacts.versionContent",
      "artifacts.revert",
    ]);
    expect(calls[2]!.payload).toEqual({
      botId: bot.id,
      path: "notes/todo.md",
      content: "# t\n",
      expectedChecksum: "a".repeat(64),
    });
  });

  it("omits expectedChecksum for blind saves", async () => {
    const { bridge, calls } = makeBridge({
      "artifacts.save": () => ({ artifact, version }),
    });
    const service = createHostService(bridge);
    await service.artifacts.save(bot.id, "notes/todo.md", "# t\n");
    expect(calls[0]!.payload).toEqual({ botId: bot.id, path: "notes/todo.md", content: "# t\n" });
  });

  it("maps host error codes onto ServiceError (REVISION_CONFLICT)", async () => {
    const { bridge } = makeBridge({
      "artifacts.save": () => {
        throw Object.assign(new Error("文件被修改"), { code: "REVISION_CONFLICT" });
      },
    });
    const service = createHostService(bridge);
    await expect(service.artifacts.save(bot.id, "notes/todo.md", "# t\n", "a".repeat(64))).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });

  it("uploads attachments chunked through begin/append/commit (D26)", { timeout: 30_000 }, async () => {
    const { bridge, calls } = makeBridge({
      "attachment.begin": (payload) => {
        expect(payload).toMatchObject({ botId: bot.id, name: "big.md" });
        return { uploadId: "upload-1" };
      },
      "attachment.append": (raw) => {
        const payload = raw as { chunkBase64: string };
        const chunk = Buffer.from(payload.chunkBase64, "base64");
        expect(chunk.length).toBeLessThanOrEqual(512 * 1024);
        return { received: chunk.length };
      },
      "attachment.commit": () => ({
        botId: bot.id,
        path: "attachments/big.md",
        size: 600 * 1024,
        checksum: "c".repeat(64),
      }),
    });
    const service = createHostService(bridge);
    const bytes = new Uint8Array(600 * 1024);
    const result = await service.attachments.upload(bot.id, { name: "big.md", bytes });
    expect(result).toEqual({
      botId: bot.id,
      path: "attachments/big.md",
      size: 600 * 1024,
      checksum: "c".repeat(64),
    });
    expect(calls.map((call) => call.method)).toEqual([
      "attachment.begin",
      "attachment.append",
      "attachment.append",
      "attachment.commit",
    ]);
    const roundTrip = calls
      .filter((call) => call.method === "attachment.append")
      .map((call) => Buffer.from((call.payload as { chunkBase64: string }).chunkBase64, "base64"));
    expect(Buffer.concat(roundTrip)).toEqual(Buffer.from(bytes));
  });

  it("surfaces host attachment rejections as ServiceError", async () => {
    const { bridge } = makeBridge({
      "attachment.begin": () => {
        throw Object.assign(new Error("bot was not found"), { code: "INVALID_INPUT" });
      },
    });
    const service = createHostService(bridge);
    await expect(
      service.attachments.upload(bot.id, { name: "x.md", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("host-backed vault (D24 leftover)", () => {
  it("routes backup/restore/describe to the host data.* methods", async () => {
    const { bridge, calls } = makeBridge({
      "data.backup": () => ({ backupId: "b1", createdAt: "2026-10-26T00:00:00.000Z", sizeBytes: 10 }),
      "data.restore": () => ({ restored: true }),
      "data.describe": () => ({ schemaVersion: "11", counts: { bots: 1 } }),
    });
    const service = createHostService(bridge);
    await service.vault.createBackup();
    await service.vault.restore("b1");
    const described = await service.vault.describe();
    expect(calls.map((call) => call.method)).toEqual([
      "data.backup",
      "data.restore",
      "data.describe",
    ]);
    expect(calls[1]!.payload).toEqual({ backupId: "b1" });
    expect(described).toEqual({ schemaVersion: "11", counts: { bots: 1 } });
  });

  it("restore surfaces the hostRestarted flag and maps stable errors", async () => {
    // The mock stands in for the MAIN-process wrapper: after a successful
    // data.restore it restarts the Host and adds hostRestarted (index.ts).
    const { bridge } = makeBridge({
      "data.restore": () => ({ restored: true, hostRestarted: true }),
    });
    await expect(createHostService(bridge).vault.restore("b1")).resolves.toEqual({
      restored: true,
      hostRestarted: true,
    });

    const { bridge: failing } = makeBridge({
      "data.restore": () => {
        throw Object.assign(new Error("存在进行中的运行"), { code: "INVALID_INPUT" });
      },
    });
    await expect(createHostService(failing).vault.restore("b1")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("lists backups through the desktop bridge and tolerates its absence", async () => {
    const { bridge } = makeBridge({});
    const service = createHostService(bridge);
    await expect(service.vault.listBackups()).resolves.toEqual([]);

    const { bridge: withBackups } = makeBridge({});
    (withBackups as unknown as { backups: { list: () => Promise<unknown[]> } }).backups = {
      list: async () => [{ backupId: "b1", createdAt: "2026-10-26T00:00:00.000Z", schemaVersion: 11, sizeBytes: 5 }],
    };
    const listed = await createHostService(withBackups).vault.listBackups();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.backupId).toBe("b1");
  });

  it("falls back to an in-memory hardware-acceleration answer without the bridge", async () => {
    const { bridge } = makeBridge({});
    const service = createHostService(bridge);
    await expect(service.hardwareAcceleration()).resolves.toEqual({
      enabled: true,
      restartRequired: false,
    });
    await expect(service.hardwareAcceleration(false)).resolves.toEqual({
      enabled: false,
      restartRequired: true,
    });
  });
});

const workflow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "sample-review-flow",
  schemaVersion: "0.1",
  nodes: [
    {
      id: "n1",
      type: "bot",
      botId: bot.id,
      instructionTemplate: "summarize the draft",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    },
  ],
  edges: [],
  limits: { maxConcurrentNodes: 2 },
} satisfies Workflow;

const draft: WorkflowDraft = {
  name: workflow.name,
  schemaVersion: workflow.schemaVersion,
  nodes: workflow.nodes.map((node) => ({ ...node })),
  edges: [],
  limits: { ...workflow.limits },
};

const run = successRunFixture.interactions[0]!.expectedResponse as unknown as Run;

const nodeRun = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  runId: run.id,
  nodeId: "n1",
  attempt: 1,
  status: "pending",
  inputRefs: [],
  outputRefs: [],
  sessionId: null,
};

const approval = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  runId: run.id,
  nodeRunId: nodeRun.id,
  actionDigest: "a".repeat(64),
  resource: "workspace:read",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  status: "pending",
} satisfies Approval;

describe("host-backed workflow service", () => {
  it("lists and gets workflows through the contract methods", async () => {
    const { bridge, calls } = makeBridge({
      "workflow.list": () => ({
        workflows: [{ id: workflow.id, revision: workflow.revision, name: workflow.name }],
      }),
      "workflow.get": () => workflow,
    });
    const service = createHostService(bridge);
    await expect(service.workflows.list()).resolves.toEqual([
      { id: workflow.id, revision: workflow.revision, name: workflow.name },
    ]);
    await expect(service.workflows.get(workflow.id)).resolves.toEqual(workflow);
    expect(calls.map((call) => call.method)).toEqual(["workflow.list", "workflow.get"]);
    expect(calls[1]!.payload).toEqual({ id: workflow.id });
  });

  it("saves a draft with the expected revision only when one is given", async () => {
    const { bridge, calls } = makeBridge({ "workflow.save": () => workflow });
    const service = createHostService(bridge);
    await service.workflows.save(draft);
    await service.workflows.save(draft, workflow.revision);
    expect(calls[0]!.payload).toEqual({ workflow: draft });
    expect(calls[1]!.payload).toEqual({
      workflow: draft,
      expectedRevision: workflow.revision,
    });
  });

  it("copies by remapping node ids and saving a new document", async () => {
    const { bridge, calls } = makeBridge({
      "workflow.get": () => workflow,
      "workflow.save": () => ({ ...workflow, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    });
    const service = createHostService(bridge);
    await service.workflows.copy(workflow.id);
    expect(calls[0]!.payload).toEqual({ id: workflow.id });
    const saved = calls[1]!.payload as { workflow: WorkflowDraft };
    expect(saved.workflow.nodes[0]!.id).toBe("n1-copy");
    expect(saved.workflow).not.toHaveProperty("id");
    expect(saved).not.toHaveProperty("expectedRevision");
  });

  it("imports lazily: validates through the Host and never persists", async () => {
    const { bridge, calls } = makeBridge({
      "workflow.validate": () => ({ valid: true, errors: [] }),
    });
    const service = createHostService(bridge);
    const result = await service.workflows.importTemplate({
      schemaVersion: "0.1",
      workflow: draft,
    });
    expect(result.accepted).toBe(true);
    expect(result.draft).toEqual(draft);
    expect(calls.map((call) => call.method)).toEqual(["workflow.validate"]);
  });

  it("surfaces Host graph errors from import without persisting", async () => {
    const { bridge, calls } = makeBridge({
      "workflow.validate": () => ({
        valid: false,
        errors: [{ code: "WORKFLOW_CYCLE", message: "cycle detected" }],
      }),
    });
    const service = createHostService(bridge);
    const result = await service.workflows.importTemplate({
      schemaVersion: "0.1",
      workflow: draft,
    });
    expect(result).toEqual({
      accepted: false,
      errors: [{ code: "WORKFLOW_CYCLE", message: "cycle detected" }],
      errorCode: "WORKFLOW_CYCLE",
    });
    expect(calls.map((call) => call.method)).toEqual(["workflow.validate"]);
  });

  it("keeps the data-version refusal on the template envelope", async () => {
    const { bridge, calls } = makeBridge({});
    const service = createHostService(bridge);
    const result = await service.workflows.importTemplate({
      schemaVersion: "9.9",
      workflow: draft,
    });
    expect(result).toEqual({
      accepted: false,
      errors: [],
      errorCode: "DATA_VERSION_UNSUPPORTED",
    });
    expect(calls).toEqual([]);
  });
});

describe("host-backed run service", () => {
  it("lists runs through run.list with the default page limit", async () => {
    const { bridge, calls } = makeBridge({
      "run.list": () => ({ runs: [run], nextCursor: null }),
    });
    const service = createHostService(bridge);
    const listed = await service.runs.list();
    expect(listed.runs[0]!.id).toBe(run.id);
    expect(listed.nextCursor).toBeNull();
    await service.runs.list({ status: "succeeded", limit: 5 });
    expect(calls[0]!.payload).toEqual({ limit: 50 });
    expect(calls[1]!.payload).toEqual({ limit: 5, status: "succeeded" });
    expect(service.runs.playback).toBe("host");
  });

  it("composes a snapshot with derived approval baselines", async () => {
    const { bridge, calls } = makeBridge({
      "run.snapshot": () => ({
        run,
        nodeRuns: [nodeRun],
        approvals: [approval],
        artifacts: [],
      }),
    });
    const service = createHostService(bridge);
    const snapshot = await service.runs.snapshot(run.id);
    expect(snapshot.run.id).toBe(run.id);
    expect(snapshot.nodeRuns[0]!.id).toBe(nodeRun.id);
    expect(snapshot.approvals[0]!.approval.status).toBe("pending");
    expect(Date.parse(snapshot.approvals[0]!.requestedAt)).toBe(
      Date.parse(approval.expiresAt) - 600_000,
    );
    expect(snapshot.approvals[0]!.invalidReason).toBeUndefined();
    expect(calls[0]!.payload).toEqual({ runId: run.id });
  });

  it("subscribes from afterSequence and forwards snapshotRequired", async () => {
    const { bridge, calls } = makeBridge({
      "events.subscribe": () => ({ events: [], snapshotRequired: true }),
    });
    const service = createHostService(bridge);
    await expect(service.runs.subscribe(run.id, 7)).resolves.toEqual({
      events: [],
      snapshotRequired: true,
    });
    expect(calls[0]!.payload).toEqual({ runId: run.id, afterSequence: 7 });
  });

  it("forwards cancel, resume, retry and approval decisions", async () => {
    const { bridge, calls } = makeBridge({
      "run.cancel": () => ({ ...run, status: "cancelled" }),
      "run.resume": () => run,
      "run.retryNode": () => nodeRun,
      "approval.decide": () => ({ ...approval, status: "approved" }),
    });
    const service = createHostService(bridge);
    await service.runs.cancel(run.id);
    await service.runs.resume(run.id);
    await service.runs.retryNode(nodeRun.id);
    await expect(
      service.runs.decideApproval({
        approvalId: approval.id,
        decision: "approved",
        expectedActionDigest: approval.actionDigest,
      }),
    ).resolves.toMatchObject({ status: "approved" });
    expect(calls.map((call) => call.method)).toEqual([
      "run.cancel",
      "run.resume",
      "run.retryNode",
      "approval.decide",
    ]);
  });

  it("lists approvals through approval.list and maps expiry", async () => {
    const expired = { ...approval, expiresAt: "2026-01-01T00:00:00.000Z" };
    const { bridge, calls } = makeBridge({
      "approval.list": () => ({ approvals: [expired] }),
    });
    const service = createHostService(bridge);
    const baselines = await service.runs.listApprovals();
    expect(baselines[0]!.invalidReason).toBe("expired");
    expect(calls[0]!.payload).toEqual({ limit: 100 });
  });

  it("has no transient queue and rejects fixture-only playback", async () => {
    const { bridge, calls } = makeBridge({});
    const service = createHostService(bridge);
    await expect(service.runs.pullTransient(run.id)).resolves.toEqual([]);
    await expect(service.runs.advanceScenario(run.id)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(calls).toEqual([]);
  });
});

describe("host-backed uiState (G1')", () => {
  it("round-trips the snapshot through ui.state.get/set", async () => {
    const empty = {
      botOrder: [],
      groupOrder: [],
      selectedBotId: null,
      selectedGroupId: null,
    };
    const snapshot = {
      botOrder: [bot.id],
      groupOrder: [],
      selectedBotId: bot.id,
      selectedGroupId: null,
    };
    let stored = empty;
    const { bridge } = makeBridge({
      "ui.state.get": () => ({ state: stored }),
      "ui.state.set": (payload) => {
        stored = (payload as { state: typeof empty }).state;
        return { state: stored };
      },
    });
    const service = createHostService(bridge);
    await expect(service.uiState.get()).resolves.toEqual(empty);
    await expect(service.uiState.save(snapshot)).resolves.toEqual(snapshot);
    await expect(service.uiState.get()).resolves.toEqual(snapshot);
  });
});

describe("host-backed groups (G1' 分组实体化)", () => {
  it("forwards group.list/create/archive payloads unchanged", async () => {
    const group = {
      id: "77777777-7777-4777-8777-777777777777",
      revision: "88888888-8888-4888-8888-888888888888",
      name: "设计组",
      archivedAt: null,
    };
    const { bridge, calls } = makeBridge({
      "group.list": () => ({ groups: [group] }),
      "group.create": (payload) => ({
        ...group,
        name: (payload as { name: string }).name,
      }),
      "group.archive": (payload) => {
        const request = payload as { id: string; expectedRevision: string };
        return {
          ...group,
          id: request.id,
          revision:
            request.expectedRevision === group.revision
              ? "99999999-9999-4999-8999-999999999999"
              : group.revision,
          archivedAt: "2026-10-31T00:00:00Z",
        };
      },
    });
    const service = createHostService(bridge);
    await expect(service.groups.list()).resolves.toEqual([group]);
    await expect(service.groups.create("设计组")).resolves.toMatchObject({
      name: "设计组",
    });
    await expect(
      service.groups.archive(group.id, group.revision),
    ).resolves.toMatchObject({ archivedAt: "2026-10-31T00:00:00Z" });
    expect(calls.map((call) => call.method)).toEqual([
      "group.list",
      "group.create",
      "group.archive",
    ]);
    expect(calls[2]?.payload).toEqual({ id: group.id, expectedRevision: group.revision });
  });
});

describe("host-backed skills (D17' service layer)", () => {
  it("round-trips the library through skillLibrary.get/save", async () => {
    const library = {
      skills: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "周报",
          instructions: "输出三段式周报。",
          capabilities: ["fs.read"],
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      bindings: {},
    };
    let stored = { skills: [], bindings: {} };
    const { bridge, calls } = makeBridge({
      "skillLibrary.get": () => ({ library: stored }),
      "skillLibrary.save": (payload) => {
        stored = (payload as { library: typeof stored }).library;
        return { library: stored };
      },
    });
    const service = createHostService(bridge);
    await expect(service.skills.getLibrary()).resolves.toEqual({
      skills: [],
      bindings: {},
    });
    await expect(service.skills.saveLibrary(library)).resolves.toEqual(library);
    await expect(service.skills.getLibrary()).resolves.toEqual(library);
    expect(calls.map((call) => call.method)).toEqual([
      "skillLibrary.get",
      "skillLibrary.save",
      "skillLibrary.get",
    ]);
  });
});
