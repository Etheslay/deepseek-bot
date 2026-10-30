import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  spawnHostProcess,
  type HostProcessClient,
} from "../../src/main/host-client.js";

const fakeHost = fileURLToPath(new URL("./fixtures/fake-host.mjs", import.meta.url));

const roots: string[] = [];
const clients: HostProcessClient[] = [];
afterAll(async () => {
  for (const client of clients.splice(0)) {
    await client.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeClient(decryptCredential: (ref: string) => Promise<string>): HostProcessClient {
  const root = mkdtempSync(join(tmpdir(), "dsb-host-client-"));
  roots.push(root);
  const client = spawnHostProcess({
    entryPath: fakeHost,
    nodePath: process.execPath,
    dataRoot: root,
    decryptCredential,
  });
  clients.push(client);
  return client;
}

describe("spawnHostProcess", () => {
  it("round-trips contract calls and surfaces stable error codes", async () => {
    const client = makeClient(async () => "sk-test");
    await expect(client.call("bot.list", {})).resolves.toEqual({ bots: [{ id: "bot-1" }] });
    await expect(client.call("run.get", { runId: "x" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      retryable: false,
    });
  });

  it("rejects methods outside the contract allowlist before spawning traffic", async () => {
    const client = makeClient(async () => "unused");
    await expect(client.call("not.a.method" as never, {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("answers the host's credential/resolve requests through the decryptor", async () => {
    const decrypt = vi.fn<(ref: string) => Promise<string>>(async (ref) => {
      if (ref.endsWith("2222")) return "sk-test";
      throw new Error("credential blob does not exist");
    });
    const client = makeClient(decrypt);
    // First call: the fake asks back with the good ref, then answers.
    await expect(client.call("bot.list", {})).resolves.toEqual({ bots: [{ id: "bot-1" }] });
    // Second call: the fake asks with a ref the decryptor rejects; the
    // failure travels as an error result and the channel keeps working.
    await expect(client.call("bot.list", {})).resolves.toEqual({ bots: [{ id: "bot-1" }] });
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("forwards schedule.missed notifications to listeners", async () => {
    const client = makeClient(async () => "unused");
    const notices = vi.fn();
    const unsubscribe = client.onMissed(notices);
    // The fake pushes schedule.missed shortly after startup; traffic on the
    // channel keeps the process alive while we wait for it.
    await vi.waitFor(() => expect(notices).toHaveBeenCalled(), { timeout: 5_000 });
    expect(notices.mock.calls[0]?.[0]).toEqual([
      { scheduleId: "s1", workflowId: "w1", occurrenceUtc: "2026-01-01T00:00:00Z", reason: "test" },
    ]);
    unsubscribe();
    expect(client.onMissed(notices)).toBeTypeOf("function");
  });

  it("forwards chat.stream notifications to listeners", async () => {
    const client = makeClient(async () => "unused");
    const notices = vi.fn();
    const unsubscribe = client.onChatStream(notices);
    await vi.waitFor(() => expect(notices).toHaveBeenCalled(), { timeout: 5_000 });
    // The fake pushes a malformed notice (non-UUID botId) ahead of the valid
    // one; the schema-validated consumer skips it and forwards only this.
    expect(notices.mock.calls[0]?.[0]).toEqual({
      botId: "11111111-1111-4111-8111-111111111111",
      sessionId: "chat:11111111-1111-4111-8111-111111111111",
      text: "live segment",
    });
    unsubscribe();
    expect(client.onChatStream(notices)).toBeTypeOf("function");
  });

  it("shuts the host down gracefully", async () => {
    const client = makeClient(async () => "unused");
    await expect(client.shutdown()).resolves.toBeUndefined();
    await expect(client.call("bot.list", {})).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    clients.pop();
  });
});
