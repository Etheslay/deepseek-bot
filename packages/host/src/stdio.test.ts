import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { startStdioHost, type StdioHostController } from "./stdio.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);

const roots: string[] = [];
const disposals: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const dispose of disposals.splice(0)) {
    await dispose().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface Harness {
  readonly host: DeepSeekBotHost;
  readonly controller: StdioHostController;
  /** Frames the parent (desktop main side) received. */
  readonly inbound: Array<Record<string, unknown>>;
  /** Send a parent→host frame (request or credential answer). */
  send(frame: Record<string, unknown>): void;
  /** Wait for the next inbound frame matching an id/method. */
  waitFor(predicate: (frame: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "dsb-stdio-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "key",
    dshBin: fakeHarness,
    childEnv: (env) => ({ ...env, FAKE_SCENARIO: "ok" }),
  });
  const clientToHost = new PassThrough();
  const hostToClient = new PassThrough();
  const inbound: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (frame: Record<string, unknown>) => boolean;
    resolve: (frame: Record<string, unknown>) => void;
  }> = [];
  let buffer = "";
  hostToClient.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const frame = JSON.parse(line) as Record<string, unknown>;
      inbound.push(frame);
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(frame));
      if (waiterIndex >= 0) {
        waiters.splice(waiterIndex, 1)[0]?.resolve(frame);
      }
    }
  });
  const controller = startStdioHost({
    host,
    input: clientToHost,
    output: hostToClient,
  });
  const dispose = async (): Promise<void> => {
    clientToHost.end();
    await controller.done;
    await host.shutdown().catch(() => undefined);
  };
  disposals.push(dispose);
  return {
    host,
    controller,
    inbound,
    send: (frame) => clientToHost.write(`${JSON.stringify(frame)}\n`),
    waitFor: (predicate, timeoutMs = 5_000) =>
      new Promise((resolve, reject) => {
        const existing = inbound.find(predicate);
        if (existing !== undefined) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => reject(new Error("waitFor frame timed out")), timeoutMs);
        timer.unref?.();
        waiters.push({
          predicate,
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
        });
      }),
    dispose,
  };
}

const envelope = (method: string, payload: unknown): Record<string, unknown> => ({
  protocolVersion: "0.1",
  requestId: randomUUID(),
  method,
  payload,
});

describe("startStdioHost", () => {
  it("answers contract methods over stdio with validated results", async () => {
    const harness = await makeHarness();
    const id = randomUUID();
    harness.send({ jsonrpc: "2.0", id, method: "contract/call", params: envelope("bot.list", {}) });
    const response = await harness.waitFor((frame) => frame.id === id);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ bots: [] });
  });

  it("carries stable error codes for invalid envelopes and failed methods", async () => {
    const harness = await makeHarness();
    harness.send({ jsonrpc: "2.0", id: "bad", method: "contract/call", params: { method: "bot.list" } });
    const envelopeError = await harness.waitFor((frame) => frame.id === "bad");
    expect(envelopeError.error).toMatchObject({ code: "INVALID_INPUT" });

    harness.send({
      jsonrpc: "2.0",
      id: "missing",
      method: "contract/call",
      params: envelope("run.get", { runId: randomUUID() }),
    });
    const methodError = await harness.waitFor((frame) => frame.id === "missing");
    expect(methodError.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
  });

  it("resolves credentials through the parent round trip", async () => {
    const harness = await makeHarness();
    const pending = harness.controller.resolveCredential("cred:abc");
    const request = await harness.waitFor((frame) => frame.method === "credential/resolve");
    expect(request.params).toEqual({ credentialRef: "cred:abc" });
    harness.send({ jsonrpc: "2.0", id: request.id, result: { apiKey: "sk-test" } });
    await expect(pending).resolves.toBe("sk-test");

    const failing = harness.controller.resolveCredential("cred:gone");
    const failed = await harness.waitFor(
      (frame) => frame.method === "credential/resolve" && (frame.params as { credentialRef?: string }).credentialRef === "cred:gone",
    );
    harness.send({
      jsonrpc: "2.0",
      id: failed.id,
      result: { error: "blob not found" },
    });
    await expect(failing).rejects.toThrow("blob not found");
  });

  it("rejects oversized payloads and unknown stdio methods", async () => {
    const harness = await makeHarness();
    harness.send({
      jsonrpc: "2.0",
      id: "big",
      method: "contract/call",
      params: envelope("bot.list", { filler: "x".repeat(1_048_577) }),
    });
    const oversized = await harness.waitFor((frame) => frame.id === "big");
    expect(oversized.error).toMatchObject({ code: "INVALID_INPUT" });

    harness.send({ jsonrpc: "2.0", id: "odd", method: "no/such/method" });
    const unknown = await harness.waitFor((frame) => frame.id === "odd");
    expect(unknown.error).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("shuts the host down on host/shutdown", async () => {
    const harness = await makeHarness();
    harness.send({ jsonrpc: "2.0", id: "bye", method: "host/shutdown" });
    const response = await harness.waitFor((frame) => frame.id === "bye");
    expect(response.result).toEqual({ ok: true });
    await expect(harness.host.handleMethod("bot.list", {})).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  });
});
