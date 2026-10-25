import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { setSetting } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);
const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function makeHost(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-settings-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
  });
  hosts.push(host);
  return host;
}

const payload = {
  modelProfile: {
    provider: "deepseek" as const,
    model: "deepseek-chat",
    endpoint: "https://api.deepseek.com",
  },
};

describe("settings.testConnection", () => {
  it("asks the user to save a key first", async () => {
    const host = await makeHost();
    await expect(host.handleMethod("settings.testConnection", payload)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("reports success for a 200 response", async () => {
    const host = await makeHost();
    setSetting(host.db, "apiKeyRef", `cred:${randomUUID()}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const result = (await host.handleMethod("settings.testConnection", payload)) as {
      ok: boolean;
      latencyMs?: number;
    };
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe("number");
  });

  it("maps 401 to AUTH_FAILED", async () => {
    const host = await makeHost();
    setSetting(host.db, "apiKeyRef", `cred:${randomUUID()}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(host.handleMethod("settings.testConnection", payload)).resolves.toMatchObject({
      ok: false,
      errorCode: "AUTH_FAILED",
    });
  });

  it("maps 429 to RATE_LIMITED and network errors to RUNTIME_UNAVAILABLE", async () => {
    const host = await makeHost();
    setSetting(host.db, "apiKeyRef", `cred:${randomUUID()}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(host.handleMethod("settings.testConnection", payload)).resolves.toMatchObject({
      ok: false,
      errorCode: "RATE_LIMITED",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(host.handleMethod("settings.testConnection", payload)).resolves.toMatchObject({
      ok: false,
      errorCode: "RUNTIME_UNAVAILABLE",
    });
  });
});

