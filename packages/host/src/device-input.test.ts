import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApproval, DeviceInput, DeviceInputResult } from "@deepseek-bot/contracts";
import {
  ScreenBackendError,
  type DeviceInputBackend,
  type DeviceInputRequest,
} from "@deepseek-bot/exec-daemon";
import { createHost, type DeepSeekBotHost } from "./host.js";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const pointer: DeviceInput = {
  kind: "pointer",
  gesture: "click",
  button: "left",
  x: 10,
  y: 8192,
};
const key: DeviceInput = {
  kind: "key",
  name: "enter",
  action: "tap",
  shift: false,
  ctrl: false,
  alt: false,
};

describe("device input", () => {
  it("does not perform input before ask, and a denial or disabled policy performs nothing", async () => {
    const state = recorder();
    const { host, bot } = await setup(state.backend);
    await expect(
      host.handleMethod("permission.policy.set", { capability: "device.action", mode: "allow" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(request(host, bot.id, pointer)).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
    await expect(
      host.agentTools.call({ id: `chat:${bot.id}`, botId: bot.id }, "device_input", pointer),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(state.calls).toEqual([]);
    expect(await approvals(host, bot.id)).toEqual([]);

    await enable(host);
    const denied = request(host, bot.id, key);
    await decide(host, await pending(host, bot.id), "denied");
    await expect(denied).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });

    const waiting = request(host, bot.id, pointer);
    await pending(host, bot.id);
    await host.handleMethod("permission.policy.set", { capability: "device.action", mode: "deny" });
    await expect(waiting).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(state.calls).toEqual([]);
    expect(await listed(host, bot.id)).toEqual([]);
    await expect(readdir(join(host.layout.deviceOutputs, bot.id))).rejects.toThrow();
  });

  it("performs one approved input, stores it locally, and does not reuse that approval", async () => {
    const state = recorder();
    let clock = Date.parse("2026-10-28T00:00:00.000Z");
    const { host, bot } = await setup(state.backend, () => new Date(clock));
    await enable(host);
    await expect(
      host.handleMethod("device.action.input", {
        botId: bot.id,
        input: { ...pointer, command: "calc" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("device.action.input", {
        botId: bot.id,
        input: { ...key, name: "win" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await approvals(host, bot.id)).toEqual([]);

    const call = request(host, bot.id, pointer);
    const approval = await pending(host, bot.id);
    expect(approval.tool).toBe("device_input");
    expect(approval.capabilities).toEqual(["device.action"]);
    expect(approval.params).toEqual(pointer);
    await expect(request(host, bot.id, key)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "session",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await decide(host, approval, "approved");
    const result = (await call) as DeviceInputResult;
    expect(Object.keys(result).sort()).toEqual(["at", "id", "kind"]);
    expect(result.kind).toBe("pointer");
    expect(JSON.stringify(result)).not.toContain("device-outputs");
    expect(result).not.toHaveProperty("x");
    expect(state.calls).toEqual([pointer]);

    const artifact = JSON.parse(
      await readFile(join(host.layout.deviceOutputs, bot.id, `${result.id}.json`), "utf8"),
    ) as { input: DeviceInput };
    expect(artifact.input).toEqual(pointer);
    expect(await listed(host, bot.id)).toEqual([
      { id: result.id, botId: bot.id, at: result.at, input: pointer },
    ]);

    clock += 1_000;
    const second = request(host, bot.id, key);
    const next = await pending(host, bot.id);
    await expect(
      host.handleMethod("permission.approval.decide", {
        approvalId: approval.id,
        expectedActionDigest: approval.actionDigest,
        decision: "approved",
        scope: "once",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await decide(host, next, "approved");
    const again = (await second) as DeviceInputResult;
    expect(state.calls).toEqual([pointer, key]);
    expect(await listed(host, bot.id)).toEqual([
      { id: again.id, botId: bot.id, at: again.at, input: key },
      { id: result.id, botId: bot.id, at: result.at, input: pointer },
    ]);
    const other = (await host.handleMethod("bot.create", {
      name: "other",
      instructions: "device",
      modelProfileId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "55555555-5555-4555-8555-555555555555",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
    })) as { id: string };
    expect(await listed(host, other.id)).toEqual([]);
  });

  it("keeps the approval-only request from moving the pointer", async () => {
    const state = recorder();
    const { host, bot } = await setup(state.backend);
    await enable(host);
    const call = host.handleMethod("device.action.request", { botId: bot.id, kind: "pointer" });
    await decide(host, await pending(host, bot.id, "device_action"), "approved");
    const result = (await call) as { id: string };
    expect(Object.keys(result).sort()).toEqual(["at", "id"]);
    expect(state.calls).toEqual([]);
    expect(await listed(host, bot.id)).toEqual([]);
    const records = (await host.handleMethod("device.action.list", { botId: bot.id })) as {
      records: Array<{ id: string }>;
    };
    expect(records.records.map((item) => item.id)).toEqual([result.id]);
  });

  it("writes nothing when the helper fails, the bot is archived, or the artifact is replaced", async () => {
    const state = recorder();
    const { host, bot } = await setup(state.backend);
    await enable(host);
    state.fail = new ScreenBackendError({
      code: "RUNTIME_UNAVAILABLE",
      message: "helper missing",
    });
    const failed = request(host, bot.id, pointer);
    await decide(host, await pending(host, bot.id), "approved");
    await expect(failed).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect(state.calls).toEqual([]);
    await expect(readdir(join(host.layout.deviceOutputs, bot.id))).rejects.toThrow();

    state.fail = undefined;
    const call = request(host, bot.id, key);
    await decide(host, await pending(host, bot.id), "approved");
    const result = (await call) as DeviceInputResult;
    const directory = join(host.layout.deviceOutputs, bot.id);
    await writeFile(join(directory, "manifest.json"), "not-json");
    await expect(listed(host, bot.id)).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify([{ id: result.id, botId: bot.id, at: result.at, input: key }]),
    );
    await rm(join(directory, `${result.id}.json`));
    await expect(listed(host, bot.id)).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });

    const bots = (await host.handleMethod("bot.list", {})) as {
      bots: Array<{ id: string; revision: string }>;
    };
    const row = bots.bots.find((item) => item.id === bot.id);
    await host.handleMethod("bot.archive", { id: bot.id, expectedRevision: row?.revision });
    await expect(request(host, bot.id, pointer)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(state.calls).toEqual([key]);
  });

  it("refuses a linked output directory and an unavailable platform before approval", async () => {
    const state = recorder();
    const { host, bot } = await setup(state.backend);
    const real = `${host.layout.deviceOutputs}-real`;
    rmSync(host.layout.deviceOutputs, { recursive: true, force: true });
    symlinkSync(real, host.layout.deviceOutputs, process.platform === "win32" ? "junction" : "dir");
    await enable(host);
    await expect(listed(host, bot.id)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(state.calls).toEqual([]);

    if (process.platform === "win32") return;
    const plain = await setup();
    await enable(plain.host);
    await expect(request(plain.host, plain.bot.id, pointer)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(await approvals(plain.host, plain.bot.id)).toEqual([]);
  });
});

function recorder(): {
  calls: DeviceInputRequest[];
  fail: ScreenBackendError | undefined;
  backend: DeviceInputBackend;
} {
  const state: {
    calls: DeviceInputRequest[];
    fail: ScreenBackendError | undefined;
    backend: DeviceInputBackend;
  } = {
    calls: [],
    fail: undefined,
    backend: {
      supported: true,
      perform(input, signal) {
        if (signal.aborted) {
          return Promise.reject(
            new ScreenBackendError({ code: "CANCELLED", message: "cancelled" }),
          );
        }
        if (state.fail !== undefined) return Promise.reject(state.fail);
        state.calls.push(structuredClone(input));
        return Promise.resolve();
      },
      close() {},
    },
  };
  return state;
}

async function setup(backend?: DeviceInputBackend, now?: () => Date) {
  const root = mkdtempSync(join(tmpdir(), "dsb-device-input-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "unused",
    ...(backend !== undefined ? { deviceInput: { backend } } : {}),
    ...(now !== undefined ? { now } : {}),
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "device-input",
    instructions: "device",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return { host, bot };
}

function request(host: DeepSeekBotHost, botId: string, input: DeviceInput) {
  return host.handleMethod("device.action.input", { botId, input });
}

async function enable(host: DeepSeekBotHost): Promise<void> {
  await host.handleMethod("permission.policy.set", { capability: "device.action", mode: "ask" });
}

async function listed(host: DeepSeekBotHost, botId: string) {
  const result = (await host.handleMethod("device.action.input.list", { botId })) as {
    records: Array<{ id: string; botId: string; at: string; input: DeviceInput }>;
  };
  return result.records;
}

async function approvals(
  host: DeepSeekBotHost,
  botId: string,
  tool = "device_input",
): Promise<AppApproval[]> {
  const listedApprovals = (await host.handleMethod("permission.approval.list", { botId })) as {
    approvals: AppApproval[];
  };
  return listedApprovals.approvals.filter((item) => item.tool === tool);
}

async function pending(
  host: DeepSeekBotHost,
  botId: string,
  tool = "device_input",
): Promise<AppApproval> {
  let found: AppApproval | undefined;
  await vi.waitFor(
    async () => {
      found = (await approvals(host, botId, tool)).find((item) => item.status === "pending");
      expect(found).toBeDefined();
    },
    { timeout: 5_000 },
  );
  return found!;
}

async function decide(
  host: DeepSeekBotHost,
  approval: AppApproval,
  decision: "approved" | "denied",
): Promise<void> {
  await host.handleMethod("permission.approval.decide", {
    approvalId: approval.id,
    expectedActionDigest: approval.actionDigest,
    decision,
    scope: "once",
  });
}
