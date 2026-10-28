import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRejectionError } from "@deepseek-bot/agent-tools";
import {
  createBot,
  createToolPolicy,
  registerConnector,
  setConnectorEnabled,
  setBotMcpGrant,
  setConnectorEndpoint,
  ensureDataLayout,
  openDatabase,
} from "@deepseek-bot/storage";

import { McpService } from "./mcp.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function setup(options?: {
  catalogTimeoutMs?: number;
  resolveCredential?: (credentialRef: string) => Promise<string>;
}) {
  const root = mkdtempSync(join(tmpdir(), "dsb-mcp-service-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(ensureDataLayout(root).dbFile);
  cleanup.push(() => db.close());
  let result: Record<string, unknown> = { content: [{ type: "text", text: "ok" }] };
  let stall = false;
  let calls = 0;
  let listGate: Promise<void> | undefined;
  let lists = 0;
  const authorizations: Array<string | undefined> = [];
  const server: Server = createServer(async (req, res) => {
    authorizations.push(
      typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
    );
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const rpc = JSON.parse(body) as { id?: number; method: string };
    if (rpc.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (rpc.method === "tools/call") {
      calls++;
      if (stall) return;
    }
    const value =
      rpc.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : rpc.method === "tools/list"
          ? {
              tools: [
                {
                  name: "echo",
                  description: "Echo",
                  inputSchema: {
                    type: "object",
                    properties: { text: { type: "string" } },
                    required: ["text"],
                    additionalProperties: false,
                  },
                },
                { name: "hidden", inputSchema: { type: "object" } },
              ],
            }
          : result;
    if (rpc.method === "tools/list") {
      lists++;
      await listGate;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: value }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("fixture failed");
  const connector = registerConnector(db, {
    name: "Local",
    kind: "mcp-http",
    endpoint: `http://127.0.0.1:${addr.port}/mcp`,
  });
  setConnectorEnabled(db, { id: connector.id, enabled: true });
  const policy = createToolPolicy(db, {
    id: randomUUID(),
    revision: randomUUID(),
    name: "test",
    filesystem: { enabled: false, operations: [] },
    shell: { mode: "disabled" },
    network: { mode: "disabled" },
    mcp: { enabled: false, requireApproval: true, servers: [] },
  }).policy;
  const at = db.now().toISOString();
  const profileId = randomUUID();
  const workspaceId = randomUUID();
  const credentialRef = `cred:${randomUUID()}`;
  db.raw
    .prepare("INSERT INTO credentials (ref,label,created_at,updated_at) VALUES (?, 'test', ?, ?)")
    .run(credentialRef, at, at);
  db.raw
    .prepare(
      "INSERT INTO model_profiles (id,provider,model,endpoint,credential_ref,limits_json,created_at,updated_at) VALUES (?, 'deepseek','deepseek-chat','https://api.deepseek.com/v1',?,'{}',?,?)",
    )
    .run(profileId, credentialRef, at, at);
  db.raw
    .prepare(
      "INSERT INTO workspaces (id,canonical_path,grants_json,created_at,updated_at) VALUES (?,?,'[]',?,?)",
    )
    .run(workspaceId, root, at, at);
  const bot = createBot(db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "test",
      instructions: "test",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policy.id,
      /* v0.7 manager orchestration: every bot carries a coordinator role. */
      role: "standard",
      archivedAt: null,
    },
  }).bot;
  const caller = { id: "chat", botId: bot.id };
  const outputs = join(root, "outputs");
  const service = new McpService(db, outputs, options);
  cleanup.push(() => service.close());
  const grant = (allowedTools = ["echo"]) =>
    setBotMcpGrant(db, { botId: bot.id, connectorId: connector.id, allowedTools });
  const catalog = () => service.catalog(caller, new AbortController().signal);
  const input = async () => ({
    ...(await catalog()).tools[0]!.invocation,
    arguments: { text: "hi" },
  });
  return {
    service,
    db,
    caller,
    connector,
    outputs,
    grant,
    catalog,
    input,
    calls: () => calls,
    authorizations: () => authorizations,
    lists: () => lists,
    delayLists: (gate: Promise<void>) => {
      listGate = gate;
    },
    result: (value: Record<string, unknown>) => {
      result = value;
    },
    stall: () => {
      stall = true;
    },
  };
}

describe("MCP authorization and output boundary", () => {
  it("bounds all discovery batches with one catalog deadline and preserves regular chat readiness", async () => {
    const f = await setup({ catalogTimeoutMs: 75 });
    f.grant();
    f.delayLists(new Promise<void>(() => undefined));
    for (let index = 0; index < 4; index++) {
      const connector = registerConnector(f.db, {
        name: `slow ${index}`,
        kind: "mcp-http",
        endpoint: f.connector.endpoint,
      });
      setConnectorEnabled(f.db, { id: connector.id, enabled: true });
      setBotMcpGrant(f.db, {
        botId: f.caller.botId,
        connectorId: connector.id,
        allowedTools: ["echo"],
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const catalog = await Promise.race([
        f.catalog(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("catalog exceeded its total deadline")), 750);
        }),
      ]);
      expect(catalog.tools).toEqual([]);
      expect(catalog.warnings.length).toBeGreaterThan(0);
      expect(f.lists()).toBeLessThanOrEqual(4);
    } finally {
      clearTimeout(timer);
    }
  });
  it("catalogs only exact per-bot grants and binds definitions to caller, metadata and live configuration", async () => {
    const f = await setup();
    expect((await f.catalog()).tools).toEqual([]);
    f.grant();
    const catalog = await f.catalog();
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0]!.name).toMatch(/^mcp__[a-f0-9]{32}__[a-f0-9]{12}$/u);
    expect(catalog.tools[0]!.parameters).toMatchObject({ required: ["text"] });
    expect(catalog.tools[0]!.description).toBe("[Local / echo] Echo");
    const input = await f.input();
    expect(() => f.service.check(input, { id: "other", botId: randomUUID() })).toThrow();
    expect(() => f.service.check({ ...input, toolName: "hidden" }, f.caller)).toThrow();
    expect(() => f.service.check({ ...input, arguments: { text: 42 } }, f.caller)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    setConnectorEndpoint(f.db, { id: f.connector.id, endpoint: "http://127.0.0.1:1/mcp" });
    expect(() => f.service.check(input, f.caller)).toThrow(
      expect.objectContaining({ code: "UNAUTHORIZED_PATH" }),
    );
    expect(f.calls()).toBe(0);
  });
  it("rejects revoked grants and released definitions", async () => {
    const f = await setup();
    f.grant();
    const catalog = await f.catalog();
    const input = { ...catalog.tools[0]!.invocation, arguments: { text: "hi" } };
    f.service.release(catalog.tools);
    expect(() => f.service.check(input, f.caller)).toThrow();
    const live = await f.input();
    f.grant([]);
    await expect(f.service.invoke(live, { caller: f.caller })).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
  });
  it("persists validated images and preserves tool failures and resource links as data", async () => {
    const f = await setup();
    f.grant();
    f.result({
      isError: true,
      content: [
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        { type: "resource_link", uri: "https://example.com/private", name: "remote" },
      ],
      structuredContent: { answer: 42 },
    });
    const result = (await f.service.invoke(await f.input(), { caller: f.caller })) as {
      isError: boolean;
      content: Array<Record<string, unknown>>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png", sizeBytes: 5 });
    expect(result.content[0]).not.toHaveProperty("data");
    expect(readFileSync(result.content[0]!.savedPath as string, "utf8")).toBe("hello");
    expect(result.content[1]).toMatchObject({
      type: "resource_link",
      uri: "https://example.com/private",
    });
    expect(f.calls()).toBe(1);
  });
  it("validates the entire output before writing any images", async () => {
    const f = await setup();
    f.grant();
    f.result({
      content: [
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        { type: "text", text: "x".repeat(512 * 1024 + 1) },
      ],
    });
    await expect(f.service.invoke(await f.input(), { caller: f.caller })).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(
      readdirSync(f.outputs, { recursive: true, withFileTypes: true }).filter((entry) =>
        entry.isFile(),
      ),
    ).toHaveLength(0);
  });
  it("includes saved image paths in the result budget before writing any files", async () => {
    const f = await setup();
    f.grant();
    f.result({
      content: Array.from({ length: 4000 }, () => ({
        type: "image",
        mimeType: "image/png",
        data: "aGVsbG8=",
      })),
    });
    await expect(f.service.invoke(await f.input(), { caller: f.caller })).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(
      readdirSync(f.outputs, { recursive: true, withFileTypes: true }).filter((entry) =>
        entry.isFile(),
      ),
    ).toHaveLength(0);
  });
  it("accepts images within the per-image limit without losing large base64 payloads", async () => {
    const f = await setup();
    f.grant();
    const bytes = Buffer.alloc(1024 * 1024, 65);
    f.result({
      content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }],
    });
    const result = (await f.service.invoke(await f.input(), { caller: f.caller })) as {
      content: Array<{ savedPath: string }>;
    };
    expect(readFileSync(result.content[0]!.savedPath)).toEqual(bytes);
  });
  it.each([
    { content: [{ type: "image", mimeType: "image/svg+xml", data: "aGVsbG8=" }] },
    { content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=\n" }] },
    {
      content: [
        {
          type: "resource",
          resource: {
            uri: "file:///secret",
            mimeType: "application/octet-stream",
            blob: "aGVsbG8=",
          },
        },
      ],
    },
    { content: [], structuredContent: { text: "x".repeat(512 * 1024 + 1) } },
  ])("rejects unsupported or oversized output without writing files", async (value) => {
    const f = await setup();
    f.grant();
    f.result(value);
    await expect(f.service.invoke(await f.input(), { caller: f.caller })).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(readdirSync(f.outputs)).toEqual([]);
  });
  it("omits unavailable services with sanitized warnings and rejects disabled discovery", async () => {
    const f = await setup();
    f.grant();
    setConnectorEndpoint(f.db, { id: f.connector.id, endpoint: "http://127.0.0.1:1/SECRET" });
    const catalog = await f.catalog();
    expect(catalog.tools).toEqual([]);
    expect(catalog.warnings).toEqual(["An authorized MCP service is unavailable."]);
    setConnectorEnabled(f.db, { id: f.connector.id, enabled: false });
    await expect(f.service.discover(f.connector.id)).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
  });
  it("aborts active calls on invalidation", async () => {
    const f = await setup();
    f.grant();
    f.stall();
    const input = await f.input();
    const pending = f.service.invoke(input, { caller: f.caller });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(f.calls()).toBe(1));
    f.service.invalidate({ connectorId: f.connector.id });
    await rejected;
  });
  it("revalidates the gateway authorization after delayed discovery before dispatch", async () => {
    const f = await setup();
    f.grant();
    const input = await f.input();
    let release!: () => void;
    f.delayLists(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    let revoked = false;
    let checks = 0;
    const pending = f.service.invoke(input, {
      caller: f.caller,
      revalidateAuthorization: () => {
        checks++;
        if (revoked) throw new ToolRejectionError("UNAUTHORIZED_PATH", "Revoked");
      },
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    await vi.waitFor(() => expect(f.lists()).toBe(2));
    revoked = true;
    release();
    await rejected;
    expect(checks).toBe(1);
    expect(f.calls()).toBe(0);
  });
  it("injects a resolved HTTP credential and does not echo a resolver failure", async () => {
    const secret = "service-mcp-token";
    const ref = `cred:${randomUUID()}`;
    const f = await setup({
      resolveCredential: async (credentialRef) => {
        if (credentialRef !== ref) throw new Error(`leak ${secret}`);
        return secret;
      },
    });
    f.db.raw.prepare("UPDATE connectors SET credential_ref = ? WHERE id = ?").run(ref, f.connector.id);
    f.grant();
    const catalog = await f.catalog();
    expect(catalog.tools).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain(secret);
    expect(f.authorizations().some((value) => value === `Bearer ${secret}`)).toBe(true);
    f.db.raw
      .prepare("UPDATE connectors SET credential_ref = ? WHERE id = ?")
      .run(`cred:${randomUUID()}`, f.connector.id);
    await expect(f.service.discover(f.connector.id)).rejects.toThrow("MCP credential is unavailable");
    await expect(f.service.discover(f.connector.id)).rejects.not.toThrow(/service-mcp-token|leak/u);
  });
});
