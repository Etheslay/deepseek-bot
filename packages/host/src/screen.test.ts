import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval, ScreenResult } from "@deepseek-bot/contracts";
import {
  ScreenBackendError,
  type ScreenBackend,
  type WindowIdentity,
} from "@deepseek-bot/exec-daemon";
import { PNG } from "pngjs";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startApplicationToolServer } from "./app-tool-channel.js";

const TITLE = "UNIQUE_WINDOW_TITLE_ZZZ";
const OCR = "UNIQUE_OCR_TEXT_ZZZ";
const HWND = "hwnd-secret-value";
const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tinyPng(): Buffer {
  const image = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 12;
    image.data[index + 1] = 34;
    image.data[index + 2] = 56;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

function createFake() {
  const state = {
    windows: [
      {
        hwnd: HWND,
        pid: 20,
        processStartTime: "30",
        title: TITLE,
        minimized: false,
        width: 2,
        height: 2,
        protected: false,
      },
      {
        hwnd: "other",
        pid: 21,
        processStartTime: "31",
        title: "",
        minimized: false,
        width: 1,
        height: 1,
        protected: false,
      },
      {
        hwnd: "long",
        pid: 22,
        processStartTime: "32",
        title: "x".repeat(513),
        minimized: false,
        width: 1,
        height: 1,
        protected: false,
      },
    ],
    captureCount: 0,
    recognizeCount: 0,
    lastIdentity: undefined as WindowIdentity | undefined,
    hold: undefined as Promise<void> | undefined,
    release: () => undefined as void,
    afterCapture: undefined as (() => Promise<void>) | undefined,
    png: tinyPng() as Buffer | "bad",
    byteLength: undefined as number | undefined,
    recognizeText: OCR,
    closed: false,
  };
  const backend: ScreenBackend = {
    async listWindows(signal) {
      if (state.closed || signal.aborted) {
        throw new ScreenBackendError({ code: "CANCELLED", message: "helper list cancelled" });
      }
      return state.windows.map((row) => ({ ...row }));
    },
    async capture(identity, outputDirectory, signal) {
      state.captureCount += 1;
      state.lastIdentity = identity;
      if (state.hold !== undefined) {
        await new Promise<void>((resolve, reject) => {
          const fail = (): void =>
            reject(
              new ScreenBackendError({
                code: "CANCELLED",
                message: "helper capture cancelled SECRET",
              }),
            );
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener("abort", fail, { once: true });
          void state.hold?.then(() => {
            signal.removeEventListener("abort", fail);
            resolve();
          });
        });
      }
      if (state.closed || signal.aborted) {
        throw new ScreenBackendError({
          code: "CANCELLED",
          message: "helper capture cancelled SECRET",
        });
      }
      const bytes = state.png === "bad" ? Buffer.from("not-a-png") : state.png;
      await writeFile(join(outputDirectory, "capture.png"), bytes);
      if (state.afterCapture !== undefined) await state.afterCapture();
      return {
        width: 2,
        height: 2,
        pngPath: join(outputDirectory, "capture.png"),
        byteLength: state.byteLength ?? bytes.length,
      };
    },
    async recognize(_pngPath, signal) {
      state.recognizeCount += 1;
      if (signal.aborted) {
        throw new ScreenBackendError({ code: "CANCELLED", message: `ocr ${OCR}` });
      }
      return state.recognizeText;
    },
    close() {
      state.closed = true;
    },
  };
  return {
    backend,
    state,
    armHold(): void {
      state.hold = new Promise<void>((resolve) => {
        state.release = () => {
          state.hold = undefined;
          resolve();
        };
      });
    },
  };
}

async function setup(fake = createFake()) {
  const root = mkdtempSync(join(tmpdir(), "dsb-screen-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "unused",
    screen: { backend: fake.backend, supported: true },
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "screen",
    instructions: "screen",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return { host, root, bot, fake };
}

async function otherBot(host: DeepSeekBotHost): Promise<string> {
  const bot = (await host.handleMethod("bot.create", {
    name: "other",
    instructions: "other",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return bot.id;
}

async function pending(host: DeepSeekBotHost, botId?: string): Promise<AppApproval> {
  let found: AppApproval | undefined;
  await vi.waitFor(
    async () => {
      const listed = (await host.handleMethod(
        "permission.approval.list",
        botId === undefined ? {} : { botId },
      )) as { approvals: AppApproval[] };
      found = listed.approvals.find((item) => item.status === "pending");
      expect(found).toBeDefined();
    },
    { timeout: 5_000 },
  );
  return found!;
}

async function approve(host: DeepSeekBotHost, approval: AppApproval): Promise<void> {
  await host.handleMethod("permission.approval.decide", {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision: "approved",
    scope: "once",
  });
}

async function enable(host: DeepSeekBotHost): Promise<void> {
  await host.handleMethod("permission.policy.set", { capability: "screen.capture", mode: "ask" });
}

async function choose(
  host: DeepSeekBotHost,
  botId: string,
): Promise<{ id: string; title: string }> {
  const listed = (await host.handleMethod("screen.windows.list", {})) as {
    windows: Array<{ id: string; title: string }>;
  };
  expect(JSON.stringify(listed)).not.toContain(HWND);
  expect(listed.windows).toEqual([{ id: expect.any(String), title: TITLE }]);
  const status = (await host.handleMethod("screen.target.set", {
    botId,
    id: listed.windows[0]!.id,
  })) as { target: { id: string; title: string } | null };
  expect(status.target).toEqual(listed.windows[0]);
  return listed.windows[0]!;
}

async function prepare(host: DeepSeekBotHost, botId: string): Promise<void> {
  await enable(host);
  await choose(host, botId);
}

describe("screen host gateway", () => {
  it("denies capture before ask, hides the tool, and ignores an untrusted caller", async () => {
    const { host, bot, fake } = await setup();
    expect(await host.handleMethod("screen.status", { botId: bot.id })).toMatchObject({
      supported: true,
      enabled: false,
      target: null,
      busy: false,
    });
    expect(host.screen.visible(bot.id)).toBe(false);
    await expect(
      host.handleMethod("permission.policy.set", { capability: "screen.capture", mode: "allow" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("screen.request", { botId: bot.id, mode: "image" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await expect(
      host.handleMethod("tool.invoke", {
        callerBotId: bot.id,
        tool: "screen_capture",
        params: { mode: "image" },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(fake.state.captureCount).toBe(0);
    const server = await startApplicationToolServer(host.agentTools, {
      screenCatalog: (caller) =>
        host.screen.visible(caller.botId)
          ? host.agentTools.capabilities.schemas(["screen_capture"])
          : [],
    });
    const controller = new AbortController();
    const turn = server.openTurn({
      sessionId: "physical-session",
      caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
      signal: controller.signal,
    });
    const hidden = (await (
      await fetch(`${server.url}/screen`, {
        headers: { authorization: `Bearer ${turn.env.DSB_APP_TOOLS_TOKEN}` },
      })
    ).json()) as { tools: Array<{ name: string }> };
    expect(hidden.tools).toEqual([]);
    await server.close();
  });

  it("requires a selected window and returns only metadata after one exact approval", async () => {
    const { host, root, bot, fake } = await setup();
    await enable(host);
    expect(host.screen.visible(bot.id)).toBe(false);
    await expect(
      host.handleMethod("screen.request", { botId: bot.id, mode: "image" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.state.captureCount).toBe(0);
    await choose(host, bot.id);
    expect(host.screen.visible(bot.id)).toBe(true);
    const server = await startApplicationToolServer(host.agentTools, {
      screenCatalog: (caller) =>
        host.screen.visible(caller.botId)
          ? host.agentTools.capabilities.schemas(["screen_capture"])
          : [],
    });
    const controller = new AbortController();
    const turn = server.openTurn({
      sessionId: "physical-session",
      caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
      signal: controller.signal,
    });
    const shown = (await (
      await fetch(`${server.url}/screen`, {
        headers: { authorization: `Bearer ${turn.env.DSB_APP_TOOLS_TOKEN}` },
      })
    ).json()) as { tools: Array<{ name: string }> };
    expect(shown.tools.map((tool) => tool.name)).toEqual(["screen_capture"]);
    await server.close();

    const call = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    const approval = await pending(host, bot.id);
    expect(fake.state.captureCount).toBe(0);
    await expect(
      host.handleMethod("screen.request", { botId: bot.id, mode: "ocr" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fake.state.captureCount).toBe(0);
    expect(approval.params).toMatchObject({ mode: "image", windowTitle: TITLE });
    expect(JSON.stringify(approval.params)).not.toContain(HWND);
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "session",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.state.captureCount).toBe(0);
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: "0".repeat(64),
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await approve(host, approval);
    const result = (await call) as ScreenResult;
    expect(Object.keys(result).sort()).toEqual(["at", "hasOcr", "height", "id", "mode", "width"]);
    expect(result).toMatchObject({ mode: "image", hasOcr: false, width: 2, height: 2 });
    expect(fake.state.captureCount).toBe(1);
    expect(fake.state.recognizeCount).toBe(0);
    expect(fake.state.lastIdentity).toEqual({ hwnd: HWND, pid: 20, processStartTime: "30" });
    const again = host.agentTools.call(
      { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
      "screen_capture",
      { mode: "image" },
    );
    const second = await pending(host, bot.id);
    expect(second.id).not.toBe(approval.id);
    await host.handleMethod("permission.approval.decide", {
      approvalId: second.id,
      expectedActionDigest: second.actionDigest,
      decision: "denied",
    });
    await expect(again).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const audit = JSON.stringify(await host.handleMethod("permission.audit.list", {}));
    const jsonl = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).not.toContain(TITLE);
    expect(audit).not.toContain(HWND);
    expect(jsonl).not.toContain(TITLE);
    expect(jsonl).not.toContain(HWND);
    const read = (await host.handleMethod("screen.result.read", {
      botId: bot.id,
      id: result.id,
    })) as { text: string | null; imageBase64: string };
    expect(read.text).toBeNull();
    expect(read.imageBase64.length).toBeGreaterThan(0);
    await host.shutdown();
    hosts.splice(hosts.indexOf(host), 1);
    const reopened = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "unused",
      screen: { backend: fake.backend, supported: true },
    });
    hosts.push(reopened);
    expect(await reopened.handleMethod("screen.results.list", { botId: bot.id })).toEqual({
      results: [result],
    });
    expect(await reopened.handleMethod("screen.status", { botId: bot.id })).toMatchObject({
      target: null,
      enabled: true,
    });
    expect(reopened.screen.visible(bot.id)).toBe(false);
    await expect(
      reopened.handleMethod("screen.result.delete", { botId: bot.id, id: result.id }),
    ).resolves.toEqual({ deleted: true });
    expect(await reopened.handleMethod("screen.results.list", { botId: bot.id })).toEqual({
      results: [],
    });
    await expect(
      reopened.handleMethod("screen.result.delete", { botId: bot.id, id: result.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("keeps OCR text out of the model result and the audit log", async () => {
    const { host, bot, fake } = await setup();
    await prepare(host, bot.id);
    const call = host.agentTools.call(
      { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
      "screen_capture",
      { mode: "ocr" },
    );
    await approve(host, await pending(host, bot.id));
    const result = (await call) as ScreenResult;
    expect(result).toMatchObject({ mode: "ocr", hasOcr: true });
    expect(JSON.stringify(result)).not.toContain(OCR);
    const read = (await host.handleMethod("screen.result.read", {
      botId: bot.id,
      id: result.id,
    })) as { text: string | null };
    expect(read.text).toBe(OCR);
    const audit = JSON.stringify(await host.handleMethod("permission.audit.list", {}));
    const jsonl = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).not.toContain(OCR);
    expect(jsonl).not.toContain(OCR);
    expect(fake.state.recognizeCount).toBe(1);
  });

  it("rejects a second bot while the capture lock is held and does not queue it", async () => {
    const fake = createFake();
    const { host, bot } = await setup(fake);
    const other = await otherBot(host);
    await prepare(host, bot.id);
    await prepare(host, other);
    fake.armHold();
    const first = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await approve(host, await pending(host, bot.id));
    await vi.waitFor(() => expect(fake.state.captureCount).toBe(1));
    const second = host.handleMethod("screen.request", { botId: other, mode: "image" });
    const rejected = expect(second).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await approve(host, await pending(host, other));
    await rejected;
    expect(fake.state.captureCount).toBe(1);
    fake.state.release();
    await expect(first).resolves.toMatchObject({ mode: "image" });
    expect(fake.state.captureCount).toBe(1);
  });

  it("cancels approval, an in-flight helper, a cleared target, and a policy change", async () => {
    const { host, bot, fake } = await setup();
    await prepare(host, bot.id);
    const waiting = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await pending(host, bot.id);
    expect(await host.handleMethod("screen.cancel", { botId: bot.id })).toEqual({
      cancelled: true,
    });
    await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fake.state.captureCount).toBe(0);

    fake.armHold();
    const running = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await approve(host, await pending(host, bot.id));
    await vi.waitFor(() => expect(fake.state.captureCount).toBe(1));
    expect(await host.handleMethod("chat.cancel", { sessionId: `chat:${bot.id}` })).toEqual({
      cancelled: false,
    });
    await expect(running).rejects.toMatchObject({
      code: "CANCELLED",
      message: "screen capture was cancelled",
    });
    const listed = (await host.handleMethod("screen.results.list", { botId: bot.id })) as {
      results: ScreenResult[];
    };
    expect(listed.results).toEqual([]);

    fake.armHold();
    const raced = host.handleMethod("screen.request", { botId: bot.id, mode: "ocr" });
    await approve(host, await pending(host, bot.id));
    await vi.waitFor(() => expect(fake.state.captureCount).toBe(2));
    fake.state.afterCapture = async () => {
      await host.handleMethod("screen.target.set", { botId: bot.id, id: null });
    };
    fake.state.release();
    await expect(raced).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(
      (
        (await host.handleMethod("screen.results.list", { botId: bot.id })) as {
          results: unknown[];
        }
      ).results,
    ).toEqual([]);
    expect(JSON.stringify(await host.handleMethod("permission.audit.list", {}))).not.toContain(OCR);

    await choose(host, bot.id);
    const denied = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await pending(host, bot.id);
    await host.handleMethod("permission.policy.set", {
      capability: "screen.capture",
      mode: "deny",
    });
    await expect(denied).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(fake.state.captureCount).toBe(2);
    const names = await readdir(join(host.layout.screenOutputs, bot.id)).catch(() => []);
    expect(names.filter((name) => name.startsWith(".tmp-"))).toEqual([]);
  });

  it("drops an in-flight capture when the bot is archived or the host closes", async () => {
    const { host, bot, fake } = await setup();
    await prepare(host, bot.id);
    const archived = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await pending(host, bot.id);
    const current = (await host.handleMethod("bot.list", {})) as {
      bots: Array<{ id: string; revision: string }>;
    };
    await host.handleMethod("bot.archive", {
      id: bot.id,
      expectedRevision: current.bots.find((item) => item.id === bot.id)!.revision,
    });
    await expect(archived).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fake.state.captureCount).toBe(0);

    const { host: second, bot: live, fake: other } = await setup();
    await prepare(second, live.id);
    const closing = second.handleMethod("screen.request", { botId: live.id, mode: "image" });
    const rejected = expect(closing).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(second, live.id);
    await second.shutdown();
    hosts.splice(hosts.indexOf(second), 1);
    await rejected;
    expect(other.state.captureCount).toBe(0);
  });

  it("isolates results, rejects links, and restores files without the selection", async () => {
    const { host, root, bot, fake } = await setup();
    await prepare(host, bot.id);
    const call = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await approve(host, await pending(host, bot.id));
    const result = (await call) as ScreenResult;
    const stranger = await otherBot(host);
    await expect(
      host.handleMethod("screen.result.read", { botId: stranger, id: result.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("screen.result.delete", { botId: stranger, id: result.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const preview = join(host.layout.screenOutputs, bot.id, result.id, "preview.jpg");
    rmSync(preview);
    symlinkSync(join(root, "outside.txt"), preview, "file");
    await expect(
      host.handleMethod("screen.result.read", { botId: bot.id, id: result.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const directory = join(host.layout.screenOutputs, bot.id, result.id);
    rmSync(directory, { recursive: true, force: true });
    const elsewhere = join(root, "elsewhere");
    writeFileSync(join(root, "outside.txt"), "pixels");
    mkdirSyncSafe(elsewhere);
    symlinkSync(elsewhere, directory, "dir");
    await expect(
      host.handleMethod("screen.result.read", { botId: bot.id, id: result.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });

    const manifest = join(host.layout.screenOutputs, bot.id, "manifest.json");
    rmSync(manifest);
    symlinkSync(join(root, "outside.txt"), manifest, "file");
    await expect(host.handleMethod("screen.results.list", { botId: bot.id })).rejects.toMatchObject(
      { code: "UNAUTHORIZED_PATH" },
    );

    await host.shutdown();
    hosts.splice(hosts.indexOf(host), 1);
    const reopened = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "unused",
      screen: { backend: fake.backend, supported: true },
    });
    hosts.push(reopened);
    expect(await reopened.handleMethod("screen.status", { botId: bot.id })).toMatchObject({
      target: null,
    });
    expect(reopened.screen.visible(bot.id)).toBe(false);
  });

  it("refuses another capture at fifty results and removes a rejected attempt", async () => {
    const { host, bot, fake } = await setup();
    await prepare(host, bot.id);
    const results = Array.from({ length: 50 }, () => ({
      id: randomUUID(),
      mode: "image" as const,
      at: "2026-10-27T00:00:00.000Z",
      width: 2,
      height: 2,
      hasOcr: false,
    }));
    const directory = join(host.layout.screenOutputs, bot.id);
    mkdirSyncSafe(directory);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ results }));
    await expect(
      host.handleMethod("screen.request", { botId: bot.id, mode: "image" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.state.captureCount).toBe(0);

    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ results: [] }));
    fake.state.png = "bad";
    const bad = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await approve(host, await pending(host, bot.id));
    await expect(bad).rejects.toMatchObject({ code: "INVALID_INPUT" });
    fake.state.png = tinyPng();
    fake.state.recognizeText = "Ω".repeat(70_000);
    const huge = host.handleMethod("screen.request", { botId: bot.id, mode: "ocr" });
    await approve(host, await pending(host, bot.id));
    await expect(huge).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "screen text exceeds the limit",
    });
    const names = await readdir(directory);
    expect(
      names.filter((name) => name.startsWith(".tmp-") || name.startsWith(".manifest-")),
    ).toEqual([]);
    expect(
      (await host.handleMethod("screen.results.list", { botId: bot.id })) as { results: unknown[] },
    ).toEqual({ results: [] });
    expect(JSON.stringify(await host.handleMethod("permission.audit.list", {}))).not.toContain("Ω");
  });
});

function mkdirSyncSafe(directory: string): void {
  mkdirSync(directory, { recursive: true });
}
