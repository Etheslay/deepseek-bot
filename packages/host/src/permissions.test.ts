import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function makeHost(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-permissions-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
  });
  hosts.push(host);
  return host;
}

const callerBot = randomUUID();
const invoke = (host: DeepSeekBotHost) =>
  host.handleMethod("tool.invoke", {
    tool: "create_group",
    params: { name: "research" },
    callerBotId: callerBot,
  });

describe("permission gate", () => {
  it("asks by default for write capabilities", async () => {
    const host = await makeHost();
    await expect(invoke(host)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("does not let legacy grants authorize an untrusted tool.invoke identity", async () => {
    const host = await makeHost();
    await host.handleMethod("grant.create", {
      capability: "app.write",
      botId: callerBot,
      scope: "once",
    });
    await expect(invoke(host)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("does not let legacy policy settings authorize an untrusted tool.invoke identity", async () => {
    const host = await makeHost();
    await host.handleMethod("policy.set", { capability: "app.write", policy: "always" });
    await expect(invoke(host)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await host.handleMethod("policy.set", { capability: "app.write", policy: "never" });
    await host.handleMethod("grant.create", { capability: "app.write", scope: "persistent", maxUses: 0 });
    await expect(invoke(host)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("revoking a grant stops further use", async () => {
    const host = await makeHost();
    const grant = (await host.handleMethod("grant.create", {
      capability: "app.write",
      scope: "persistent",
      maxUses: 0,
    })) as { id: string };
    await expect(invoke(host)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await host.handleMethod("grant.revoke", { id: grant.id });
    await expect(invoke(host)).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const listed = (await host.handleMethod("grant.list", {})) as {
      grants: Array<{ id: string; revokedAt: string | null }>;
    };
    expect(listed.grants.find((row) => row.id === grant.id)?.revokedAt).not.toBeNull();
  });

  it("keeps read tools on the always default", async () => {
    const host = await makeHost();
    const result = (await host.handleMethod("tool.invoke", {
      tool: "list_bots",
      callerBotId: callerBot,
    })) as { result: { bots: unknown[] } };
    expect(result.result.bots).toEqual([]);
  });
});
