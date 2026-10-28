import { describe, expect, it } from "vitest";
import type { Bot } from "@deepseek-bot/contracts";
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

  it("lists chat:<botId> and opens that session's messages", async () => {
    const botId = "22222222-2222-4222-8222-222222222222";
    const rows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        botId,
        sessionId: `chat:${botId}`,
        role: "user" as const,
        text: "remember this",
        at: "2026-10-28T00:00:01.000Z",
      },
      {
        id: "11111111-1111-4111-8111-111111111112",
        botId,
        sessionId: `chat:${botId}`,
        role: "assistant" as const,
        text: "stored reply",
        at: "2026-10-28T00:00:02.000Z",
      },
    ];
    const { bridge, calls } = makeBridge({
      "chat.history": () => ({ messages: rows }),
    });
    const service = createHostService(bridge);
    await expect(service.chat.listSessions(botId)).resolves.toEqual([
      {
        sessionId: `chat:${botId}`,
        botId,
        title: "remember this",
        startedAt: "2026-10-28T00:00:01.000Z",
        replayEventCount: 2,
        status: "active",
      },
    ]);
    await expect(service.chat.openSession(`chat:${botId}`)).resolves.toEqual({
      events: [],
      messages: rows,
    });
    expect(calls).toEqual([
      { method: "chat.history", payload: { botId, limit: 200 } },
      { method: "chat.history", payload: { botId, limit: 200 } },
    ]);
  });

  it("returns an empty list when the bot has no stored messages", async () => {
    const { bridge, calls } = makeBridge({
      "chat.history": () => ({ messages: [] }),
    });
    const service = createHostService(bridge);
    await expect(service.chat.listSessions(bot.id)).resolves.toEqual([]);
    await expect(service.chat.openSession(`chat:${bot.id}`)).resolves.toEqual({
      events: [],
      messages: [],
    });
    expect(calls).toEqual([
      { method: "chat.history", payload: { botId: bot.id, limit: 200 } },
      { method: "chat.history", payload: { botId: bot.id, limit: 200 } },
    ]);
  });

  it("does not read history for a session id that is not chat:<botId>", async () => {
    const { bridge, calls } = makeBridge({});
    const service = createHostService(bridge);
    await expect(service.chat.openSession("sess-success-run")).resolves.toEqual({
      events: [],
      messages: [],
    });
    expect(calls).toEqual([]);
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

