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
});

