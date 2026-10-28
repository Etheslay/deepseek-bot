import { describe, expect, it } from "vitest";
import {
  METHOD_CONTRACTS,
  METHODS,
  McpServerGrantSchema,
  CapabilityPolicySchema,
  PermissionGrantSchema,
  defaultPermissionMode,
  requiresPerActionApproval,
} from "./index.js";

const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-10-27T00:00:00.000Z";

describe("D19 MCP connector contracts", () => {
  it("defaults existing registration to sd-webui and accepts explicit mcp-http", () => {
    const request = METHOD_CONTRACTS["connector.register"].request;
    expect(request.parse({ name: "local" })).toHaveProperty("kind", "sd-webui");
    expect(
      request.safeParse({ name: "local", kind: "mcp-http", endpoint: "http://127.0.0.1:8000/mcp" })
        .success,
    ).toBe(true);
    expect(request.safeParse({ name: "local", kind: "stdio" }).success).toBe(false);
    expect(
      request.safeParse({
        name: "local",
        kind: "mcp-stdio",
        command: "server",
        args: ["--stdio"],
        credentialEnv: "MCP_CREDENTIAL",
      }).success,
    ).toBe(true);
  });

  it("keeps old connector responses readable while accepting kind in all catalog responses", () => {
    const connector = {
      id,
      name: "local",
      enabled: false,
      credentialRef: null,
      endpoint: null,
      at,
      updatedAt: at,
    };
    for (const method of [
      "connector.register",
      "connector.disable",
      "connector.setEndpoint",
    ] as const) {
      expect(METHOD_CONTRACTS[method].response.safeParse(connector).success).toBe(true);
      expect(
        METHOD_CONTRACTS[method].response.parse({ ...connector, kind: "mcp-http" }),
      ).toHaveProperty("kind", "mcp-http");
    }
    expect(
      METHOD_CONTRACTS["connector.enable"].response.parse({
        ...connector,
        enabled: true,
        kind: "mcp-http",
      }),
    ).toHaveProperty("kind", "mcp-http");
    expect(
      METHOD_CONTRACTS["connector.list"].response.parse({
        connectors: [{ ...connector, kind: "mcp-http" }],
      }).connectors[0],
    ).toHaveProperty("kind", "mcp-http");
  });

  it("adds trusted MCP discovery and grant methods to the method whitelist", () => {
    for (const method of [
      "connector.mcp.discover",
      "connector.mcp.grants.get",
      "connector.mcp.grants.set",
    ]) {
      expect(METHODS).toContain(method);
    }
  });

  it("bounds discovered tools and rejects invalid or unexpected request fields", () => {
    const contract = METHOD_CONTRACTS["connector.mcp.discover"];
    expect(contract).toBeDefined();
    if (!contract) return;
    expect(contract.request.safeParse({ id }).success).toBe(true);
    for (const payload of [{ id: "bad" }, { id, endpoint: "http://localhost" }]) {
      expect(contract.request.safeParse(payload).success).toBe(false);
    }
    const tool = {
      name: "lookup",
      description: "help",
      inputSchema: { type: "object", properties: {} },
    };
    expect(contract.response.safeParse({ tools: [tool], at }).success).toBe(true);
    expect(
      contract.response.safeParse({ tools: [{ name: "lookup", inputSchema: {} }], at }).success,
    ).toBe(true);
    for (const patch of [
      { name: "x".repeat(201) },
      { description: "x".repeat(4001) },
      { inputSchema: [] },
    ]) {
      expect(contract.response.safeParse({ tools: [{ ...tool, ...patch }], at }).success).toBe(
        false,
      );
    }
    expect(contract.response.safeParse({ tools: Array(201).fill(tool), at }).success).toBe(false);
  });

  it("uses exact unique tool grants and strict UUID-scoped control requests", () => {
    const get = METHOD_CONTRACTS["connector.mcp.grants.get"];
    const set = METHOD_CONTRACTS["connector.mcp.grants.set"];
    expect(get).toBeDefined();
    expect(set).toBeDefined();
    if (!get || !set) return;
    expect(get.request.safeParse({ botId: id }).success).toBe(true);
    expect(get.request.safeParse({ botId: id, id }).success).toBe(false);
    expect(set.request.safeParse({ botId: id, id, allowedTools: ["lookup"] }).success).toBe(true);
    expect(set.request.safeParse({ botId: id, id, allowedTools: [] }).success).toBe(true);
    for (const patch of [
      { botId: "bad" },
      { id: "bad" },
      { extra: true },
      { allowedTools: ["*"] },
      { allowedTools: ["lookup*"] },
      { allowedTools: ["look?p"] },
      { allowedTools: ["lookup", "lookup"] },
      { allowedTools: Array.from({ length: 201 }, (_, i) => `tool${i}`) },
    ]) {
      expect(set.request.safeParse({ botId: id, id, allowedTools: [], ...patch }).success).toBe(
        false,
      );
    }
    for (const contract of [get, set])
      expect(
        contract.response.safeParse({ servers: [{ serverId: id, allowedTools: ["lookup"] }] })
          .success,
      ).toBe(true);
  });

  it("rejects wildcard and duplicate names in the reusable server grant schema", () => {
    expect(
      McpServerGrantSchema.safeParse({ serverId: id, allowedTools: ["x".repeat(200)] }).success,
    ).toBe(true);
    for (const allowedTools of [["*"], ["lookup", "lookup"], ["tool?"], ["x".repeat(201)]]) {
      expect(McpServerGrantSchema.safeParse({ serverId: id, allowedTools }).success).toBe(false);
    }
  });

  it("requires single action approval for mcp.call independently of connector.invoke", () => {
    expect(defaultPermissionMode("mcp.call")).toBe("ask");
    expect(requiresPerActionApproval("mcp.call")).toBe(true);
    expect(CapabilityPolicySchema.safeParse({ capability: "mcp.call", mode: "ask" }).success).toBe(
      true,
    );
    expect(CapabilityPolicySchema.safeParse({ capability: "mcp.call", mode: "deny" }).success).toBe(
      true,
    );
    expect(
      CapabilityPolicySchema.safeParse({ capability: "mcp.call", mode: "allow" }).success,
    ).toBe(false);
    const grant = {
      id,
      capability: "mcp.call",
      botId: id,
      mode: "allow",
      scope: "once",
      sessionId: null,
      generation: 1,
      approvalId: id,
      maxUses: 1,
      uses: 0,
      expiresAt: at,
      createdAt: at,
      revokedAt: null,
    };
    expect(PermissionGrantSchema.safeParse(grant).success).toBe(true);
    expect(
      PermissionGrantSchema.safeParse({
        ...grant,
        scope: "session",
        sessionId: "session",
        approvalId: null,
      }).success,
    ).toBe(false);
    expect(
      PermissionGrantSchema.safeParse({
        ...grant,
        scope: "permanent",
        generation: null,
        approvalId: null,
        maxUses: null,
        expiresAt: null,
      }).success,
    ).toBe(false);
  });
});
