import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureService } from "../../src/renderer/src/services/fixture-service.js";
import type { DesktopService } from "../../src/renderer/src/services/desktop-service.js";

const SESSION_BOT_A = "11111111-1111-4111-8111-111111111111";

const DRAFT = {
  name: "review-bot",
  instructions: "You review deliverables.",
  modelProfileId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "55555555-5555-4555-8555-555555555555",
  toolPolicyId: "66666666-6666-4666-8666-666666666666",
};

let service: DesktopService;

beforeEach(() => {
  service = createFixtureService();
});

describe("FixtureService bots", () => {
  it("seeds schema-valid bots", async () => {
    const bots = await service.bots.list();
    expect(bots.length).toBeGreaterThanOrEqual(2);
    expect(bots.every((b) => b.revision.length > 0)).toBe(true);
  });

  it("creates a schema-valid bot", async () => {
    const bot = await service.bots.create(DRAFT);
    expect(bot.name).toBe("review-bot");
    expect(bot.archivedAt).toBeNull();
    const list = await service.bots.list();
    expect(list.find((b) => b.id === bot.id)).toBeDefined();
  });

  it("rejects an invalid draft with a field issue", async () => {
    await expect(
      service.bots.create({ ...DRAFT, name: "" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("update with a stale revision yields REVISION_CONFLICT", async () => {
    const bot = await service.bots.create(DRAFT);
    await expect(
      service.bots.update(bot.id, "00000000-0000-4000-8000-000000000000", {
        name: "renamed",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("update with the current revision succeeds", async () => {
    const bot = await service.bots.create(DRAFT);
    const next = await service.bots.update(bot.id, bot.revision, { name: "renamed" });
    expect(next.name).toBe("renamed");
    expect(next.revision).not.toBe(bot.revision);
  });

  it("duplicate gets a new id/revision, 副本 suffix, and no sessions are copied", async () => {
    const bot = await service.bots.create(DRAFT);
    const copy = await service.bots.duplicate(bot.id);
    expect(copy.id).not.toBe(bot.id);
    expect(copy.revision).not.toBe(bot.revision);
    expect(copy.name).toBe("review-bot 副本");
    const sessions = await service.chat.listSessions(copy.id);
    expect(sessions).toHaveLength(0);
  });

  it("archive stamps archivedAt; archived bots cannot stream", async () => {
    const bot = await service.bots.create(DRAFT);
    const archived = await service.bots.archive(bot.id, bot.revision);
    expect(archived.archivedAt).not.toBeNull();
    expect(() =>
      service.chat.stream(archived.id, "hello", {
        onDelta: () => undefined,
        onTool: () => undefined,
      }),
    ).toThrowError(/archived/);
    // History remains viewable.
    await expect(service.chat.openSession("sess-success-run")).resolves.toBeDefined();
  });
});

describe("FixtureService settings", () => {
  it("key is write-only: never readable, only configured flag", async () => {
    const secret = "sk-secret-value-should-never-echo";
    const result = await service.settings.saveKey(secret);
    expect(result.configured).toBe(true);
    expect(service.settings.keyConfigured()).toBe(true);
    const snapshot = JSON.stringify(service);
    expect(snapshot.includes(secret)).toBe(false);
  });

  it("testConnection is honestly UNVERIFIED by default", async () => {
    const result = await service.settings.testConnection({
      model: "deepseek-chat",
      endpoint: "https://api.deepseek.com",
    });
    expect(result.result).toBe("unverified");
    expect(result.errorCode).toBe("RUNTIME_UNAVAILABLE");
  });

  it("connection scenario switch drives success/failure states", async () => {
    service.settings.setConnectionScenario("success");
    expect((await service.settings.testConnection({ model: "m", endpoint: "https://x" })).result).toBe("success");
    service.settings.setConnectionScenario("auth-failed");
    expect((await service.settings.testConnection({ model: "m", endpoint: "https://x" })).errorCode).toBe("AUTH_FAILED");
  });
});

describe("FixtureService chat", () => {
  it("lists fixture-backed sessions only for the owning bot", async () => {
    const sessions = await service.chat.listSessions(SESSION_BOT_A);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.botId === SESSION_BOT_A)).toBe(true);
  });

  it("openSession replays contract-valid events from the fixture", async () => {
    const { events } = await service.chat.openSession("sess-success-run");
    expect(events.length).toBe(6);
    expect(events[0]?.type).toBe("run.created");
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("stream appends deltas, reports tool status, and completes", async () => {
    const deltas: string[] = [];
    const tools: string[] = [];
    const handle = service.chat.stream(
      SESSION_BOT_A,
      "hello",
      {
        onDelta: (chunk) => deltas.push(chunk),
        onTool: (tool) => tools.push(tool.state),
      },
      { chunkDelayMs: 1, chunkCount: 4 },
    );
    const result = await handle.finish();
    expect(result.cancelled).toBe(false);
    expect(result.failure).toBeNull();
    expect(tools).toEqual(["requested", "succeeded"]);
    expect(deltas.join("").length).toBeGreaterThan(0);
  });

  it("cancel stops the stream immediately", async () => {
    const deltas: string[] = [];
    const handle = service.chat.stream(
      SESSION_BOT_A,
      "hello",
      { onDelta: (c) => deltas.push(c), onTool: () => undefined },
      { chunkDelayMs: 30, chunkCount: 8 },
    );
    handle.cancel();
    const result = await handle.finish();
    expect(result.cancelled).toBe(true);
    expect(deltas).toHaveLength(0);
  });

  it("simulateFailure surfaces a stable error and stops deltas", async () => {
    const deltas: string[] = [];
    const handle = service.chat.stream(
      SESSION_BOT_A,
      "hello",
      { onDelta: (c) => deltas.push(c), onTool: () => undefined },
      { chunkDelayMs: 1, chunkCount: 4, simulateFailure: "RATE_LIMITED" },
    );
    const result = await handle.finish();
    expect(result.failure?.code).toBe("RATE_LIMITED");
    expect(result.failure?.retryable).toBe(true);
    expect(deltas).toHaveLength(0);
  });
});

describe("FixtureService artifacts", () => {
  it("lists schema-valid artifacts for a session", async () => {
    const artifacts = await service.artifacts.listBySession("sess-success-run");
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.relativePath).toBe("summaries/note-summary.md");
  });

  it("previews text safely and blocks HTML", async () => {
    const artifacts = await service.artifacts.listBySession("sess-success-run");
    const md = artifacts[0]!;
    const html = artifacts[1]!;
    const mdPreview = await service.artifacts.preview(md);
    expect(mdPreview.kind).toBe("text");
    const htmlPreview = await service.artifacts.preview(html);
    expect(htmlPreview).toEqual({ kind: "blocked", reason: expect.stringContaining("QA-14") });
  });
});
