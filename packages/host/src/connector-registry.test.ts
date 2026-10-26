import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";

const CREDENTIAL_REF = "cred:11111111-1111-4111-8111-111111111111";
const MISSING = "22222222-2222-4222-8222-222222222222";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-connector-host-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => {
      throw new Error("connector registry must not resolve a credential");
    },
  });
  hosts.push(host);
  return host;
}

describe("connector registry", () => {
  it("registers a disabled connector, toggles it, and does not call out", async () => {
    const host = await setup();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("connector registry must not send a request");
    };
    try {
      expect(await host.handleMethod("connector.list", {})).toEqual({ connectors: [] });
      const registered = (await host.handleMethod("connector.register", {
        name: "  local drawer  ",
        credentialRef: CREDENTIAL_REF,
      })) as { id: string; enabled: boolean; credentialRef: string | null };
      expect(registered).toMatchObject({
        name: "local drawer",
        enabled: false,
        credentialRef: CREDENTIAL_REF,
      });
      await expect(
        host.handleMethod("connector.register", { name: "leak", credentialRef: "sk-live-secret" }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      const enabled = (await host.handleMethod("connector.enable", { id: registered.id })) as {
        enabled: boolean;
      };
      expect(enabled.enabled).toBe(true);
      const disabled = (await host.handleMethod("connector.disable", { id: registered.id })) as {
        enabled: boolean;
        credentialRef: string | null;
      };
      expect(disabled).toMatchObject({ enabled: false, credentialRef: CREDENTIAL_REF });
      await expect(host.handleMethod("connector.enable", { id: MISSING })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      const names = host.agentTools.capabilities.list().map((tool) => tool.name);
      expect(names).not.toContain("connector.register");
      expect(names).not.toContain("connector_invoke");
      expect(names.filter((name) => name.startsWith("connector"))).toEqual([]);
      const policy = host.db.raw.prepare("SELECT policy_json FROM tool_policies LIMIT 1").get() as {
        policy_json: string;
      };
      expect(JSON.parse(policy.policy_json).mcp).toEqual({
        enabled: false,
        requireApproval: true,
        servers: [],
      });
      await host.shutdown();
      hosts.splice(0);
      const reopened = await createHost({
        dataRoot: host.layout.root,
        resolveApiKey: async () => {
          throw new Error("connector registry must not resolve a credential");
        },
      });
      hosts.push(reopened);
      expect(await reopened.handleMethod("connector.list", {})).toMatchObject({
        connectors: [{ id: registered.id, enabled: false, credentialRef: CREDENTIAL_REF }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
