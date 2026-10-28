import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type PathLike,
} from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
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

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    realpath: vi.fn(actual.realpath),
    readFile: vi.fn(actual.readFile),
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

const TITLE = "UNIQUE_WINDOW_TITLE_ZZZ";
const OCR = "UNIQUE_OCR_TEXT_ZZZ";
const HWND = "hwnd-secret-value";
const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["cancel", "disable", "clear-target", "rollback-failure"] as const)(
  "removes only the new capture on %s during manifest publication",
  async (action) => {
    const { host, bot } = await setup();
    await prepare(host, bot.id);
    const first = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await approve(host, await pending(host, bot.id));
    const prior = (await first) as ScreenResult;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const publishing = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const rename = fsPromises.rename;
    let manifestRenames = 0;
    vi.spyOn(fsPromises, "rename").mockImplementation(async (source, dest) => {
      if (String(source).includes(".manifest-")) {
        manifestRenames += 1;
        if (action === "rollback-failure" && manifestRenames > 1) {
          throw new Error("private-output-path-SECRET restore failed");
        }
        reached();
        await held;
      }
      await rename(source, dest);
    });
    const running = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    const outcome = running.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await approve(host, await pending(host, bot.id));
    await publishing;
    if (action === "cancel" || action === "rollback-failure") {
      expect(await host.handleMethod("screen.cancel", { botId: bot.id })).toEqual({
        cancelled: true,
      });
    } else if (action === "disable") {
      await host.handleMethod("permission.policy.set", {
        capability: "screen.capture",
        mode: "deny",
      });
    } else {
      await host.handleMethod("screen.target.set", { botId: bot.id, id: null });
    }
    release();
    const settled = await outcome;
    expect(settled).toMatchObject({
      error: {
        code:
          action === "cancel" || action === "rollback-failure" ? "CANCELLED" : "UNAUTHORIZED_PATH",
      },
    });
    expect(JSON.stringify(settled)).not.toContain("SECRET");
    expect(await host.handleMethod("screen.results.list", { botId: bot.id })).toEqual({
      results: [prior],
    });
    expect((await readdir(join(host.layout.screenOutputs, bot.id))).sort()).toEqual(
      [prior.id, "manifest.json"].sort(),
    );
  },
);

it.each(["root", "bot"] as const)(
  "rejects a linked %s output directory before capture writes outside it",
  async (level) => {
    const { host, bot, fake } = await setup();
    await prepare(host, bot.id);
    const outside = mkdtempSync(join(tmpdir(), "dsb-screen-outside-"));
    roots.push(outside);
    mkdirSync(host.layout.screenOutputs, { recursive: true });
    const target =
      level === "root" ? host.layout.screenOutputs : join(host.layout.screenOutputs, bot.id);
    rmSync(target, { recursive: true, force: true });
    symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
    const request = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    let settled = false;
    const result = request
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    await vi.waitFor(async () => {
      if (settled) return;
      const { approvals } = (await host.handleMethod("permission.approval.list", {
        botId: bot.id,
      })) as { approvals: AppApproval[] };
      const approval = approvals.find((item) => item.status === "pending");
      expect(approval).toBeDefined();
      await approve(host, approval!);
    });
    expect(await result).toMatchObject({ error: { code: "UNAUTHORIZED_PATH" } });
    expect(fake.state.captureCount).toBe(0);
    expect(await readdir(outside)).toEqual([]);
  },
);

it("serializes deletion with capture publication without losing either manifest change", async () => {
  const { host, bot } = await setup();
  await prepare(host, bot.id);
  const first = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
  await approve(host, await pending(host, bot.id));
  const prior = (await first) as ScreenResult;
  // Use real disk operations with resolved promises so one event-loop turn
  // deterministically drains a competing mutation up to its rename barrier.
  vi.spyOn(fsPromises, "lstat").mockImplementation((async (file: PathLike) =>
    lstatSync(file)) as typeof fsPromises.lstat);
  vi.spyOn(fsPromises, "realpath").mockImplementation((async (file: PathLike) =>
    realpathSync(file)) as typeof fsPromises.realpath);
  vi.spyOn(fsPromises, "readFile").mockImplementation((async (file: PathLike) =>
    readFileSync(file)) as typeof fsPromises.readFile);
  vi.spyOn(fsPromises, "writeFile").mockImplementation((async (
    file: PathLike,
    data: string | Uint8Array,
  ) => writeFileSync(file, data)) as typeof fsPromises.writeFile);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const publishing = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let manifestRenames = 0;
  vi.spyOn(fsPromises, "rename").mockImplementation(async (source, dest) => {
    if (String(source).includes(".manifest-")) {
      manifestRenames += 1;
      if (manifestRenames === 1) {
        reached();
        await held;
      }
    }
    renameSync(source, dest);
  });
  const capture = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
  await approve(host, await pending(host, bot.id));
  await publishing;
  const deletion = host.handleMethod("screen.result.delete", { botId: bot.id, id: prior.id });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const overlappingRenames = manifestRenames;
  release();
  const current = (await capture) as ScreenResult;
  await deletion;
  expect(overlappingRenames).toBe(1);
  expect(await host.handleMethod("screen.results.list", { botId: bot.id })).toEqual({
    results: [current],
  });
  expect((await readdir(join(host.layout.screenOutputs, bot.id))).sort()).toEqual(
    [current.id, "manifest.json"].sort(),
  );
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

async function setup(fake = createFake(), dataRoot?: string) {
  const root = dataRoot ?? mkdtempSync(join(tmpdir(), "dsb-screen-"));
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
    symlinkSync(
      process.platform === "win32" ? root : join(root, "outside.txt"),
      preview,
      process.platform === "win32" ? "junction" : "file",
    );
    await expect(
      host.handleMethod("screen.result.read", { botId: bot.id, id: result.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const directory = join(host.layout.screenOutputs, bot.id, result.id);
    rmSync(directory, { recursive: true, force: true });
    const elsewhere = join(root, "elsewhere");
    writeFileSync(join(root, "outside.txt"), "pixels");
    mkdirSyncSafe(elsewhere);
    symlinkSync(elsewhere, directory, process.platform === "win32" ? "junction" : "dir");
    await expect(
      host.handleMethod("screen.result.read", { botId: bot.id, id: result.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });

    const manifest = join(host.layout.screenOutputs, bot.id, "manifest.json");
    rmSync(manifest);
    symlinkSync(
      process.platform === "win32" ? root : join(root, "outside.txt"),
      manifest,
      process.platform === "win32" ? "junction" : "file",
    );
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

  it("captures when the data root path is a directory link", async (context) => {
    const real = mkdtempSync(join(tmpdir(), "dsb-screen-real-"));
    const linkParent = mkdtempSync(join(tmpdir(), "dsb-screen-link-"));
    roots.push(real, linkParent);
    const link = join(linkParent, "data");
    try {
      symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }
    const fake = createFake();
    const { host, bot } = await setup(fake, link);
    await prepare(host, bot.id);
    const call = host.handleMethod("screen.request", { botId: bot.id, mode: "image" });
    await approve(host, await pending(host, bot.id));
    const result = (await call) as ScreenResult;
    const read = (await host.handleMethod("screen.result.read", {
      botId: bot.id,
      id: result.id,
    })) as { imageBase64: string };
    expect(read.imageBase64.length).toBeGreaterThan(0);
    expect(host.layout.screenOutputs.startsWith(link)).toBe(true);
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
    for (const result of results) mkdirSyncSafe(join(directory, result.id));
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
