import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { callMcp, discoverMcp, normalizeMcpEndpoint, validateMcpArguments } from "./mcp-client.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const tool = {
  name: "echo",
  description: "Echo",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
};
async function endpoint(
  override?: (
    method: string,
    response: ServerResponse,
    request: IncomingMessage,
    id?: number,
  ) => boolean,
) {
  const calls: { method: string; params?: unknown }[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { id?: number; method: string; params?: unknown };
    calls.push(message);
    if (override?.(message.method, response, request, message.id)) return;
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : message.method === "tools/list"
          ? { tools: [tool] }
          : { content: [{ type: "text", text: "hello" }] };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture failed");
  return { url: `http://127.0.0.1:${address.port}/mcp`, calls };
}

describe("local MCP HTTP client", () => {
  it("discovers and calls tools through the real SDK", async () => {
    const local = await endpoint();
    expect(await discoverMcp(local.url)).toEqual([tool]);
    expect(await callMcp(local.url, "echo", { text: "hello" })).toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });
    expect(local.calls.some((call) => call.method === "tools/call")).toBe(true);
  });
  it("normalizes localhost and rejects unsafe endpoints", () => {
    expect(normalizeMcpEndpoint("http://localhost:123/mcp").hostname).toBe("127.0.0.1");
    for (const url of [
      "http://example.com",
      "http://127.1",
      "http://user@127.0.0.1",
      "http://127.0.0.1?token=x",
      "file:///x",
      "http://127.0.0.1/#x",
    ]) {
      expect(() => normalizeMcpEndpoint(url)).toThrow();
    }
  });
  it("rejects argument mismatches without dispatching the tool", async () => {
    const local = await endpoint();
    await expect(callMcp(local.url, "echo", { text: 42 })).rejects.toThrow(
      "MCP arguments do not match",
    );
    expect(local.calls.some((call) => call.method === "tools/call")).toBe(false);
  });
  it.each([302, 401])("rejects HTTP %s without following auth or redirect URLs", async (status) => {
    const local = await endpoint((_method, response) => {
      response
        .writeHead(status, {
          location: "https://example.com/secret",
          "www-authenticate": 'Bearer resource_metadata="https://example.com/oauth"',
        })
        .end("SECRET");
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow(/MCP (redirect|authentication)/u);
    expect(local.calls).toHaveLength(1);
  });
  it("sanitizes malformed server errors", async () => {
    const local = await endpoint((_method, response) => {
      response.setHeader("content-type", "application/json");
      response.end("SECRET malformed");
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow("MCP request failed");
  });
  it("cancels stalled requests", async () => {
    const local = await endpoint(() => true);
    const controller = new AbortController();
    const pending = discoverMcp(local.url, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("MCP request cancelled");
  });
  it("bounds discovery duration", async () => {
    const local = await endpoint(() => true);
    await expect(discoverMcp(local.url, undefined, { discoveryTimeoutMs: 30 })).rejects.toThrow(
      "MCP request timed out",
    );
  });
  it("rejects schemas that changed after approval", async () => {
    const local = await endpoint();
    await expect(
      callMcp(local.url, "echo", { text: "hello" }, undefined, {
        expectedTool: { ...tool, inputSchema: { type: "object" } },
      }),
    ).rejects.toThrow("MCP tool schema changed");
    expect(local.calls.some((call) => call.method === "tools/call")).toBe(false);
  });
  it.each([
    { type: "object", properties: { secret: { $ref: "http://example.com/schema" } } },
    { type: "object", $schema: "https://example.com/schema" },
    { type: "invalid" },
  ])("rejects unsupported schemas without fetching references", async (inputSchema) => {
    const local = await endpoint((method, response, _request, id) => {
      if (method !== "tools/list") return false;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [{ ...tool, inputSchema }] } }),
      );
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow();
    expect(local.calls.filter((call) => call.method === "tools/list")).toHaveLength(1);
  });
  it("rejects oversized streamed responses", async () => {
    const local = await endpoint((_method, response) => {
      response.setHeader("content-type", "application/json");
      response.end("x".repeat(12 * 1024 * 1024 + 1));
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow("MCP response exceeds size limit");
  });
  it("bounds empty-page pagination cycles", async () => {
    const local = await endpoint((method, response, _request, id) => {
      if (method !== "tools/list") return false;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [], nextCursor: "again" } }),
      );
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow();
  });
  it("rejects formats that cannot be validated rather than ignoring them", () => {
    expect(() =>
      validateMcpArguments(
        {
          ...tool,
          inputSchema: {
            type: "object",
            properties: { text: { type: "string", format: "unregistered-private-format" } },
          },
        },
        { text: "invalid" },
      ),
    ).toThrow("unsupported or invalid");
  });
  it("caps tool count before dispatch", async () => {
    const local = await endpoint((method, response, _request, id) => {
      if (method !== "tools/list") return false;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            tools: Array.from({ length: 201 }, (_, index) => ({ ...tool, name: `tool_${index}` })),
          },
        }),
      );
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow();
  });
  it("caps the total advertised schema budget", async () => {
    const local = await endpoint((method, response, _request, id) => {
      if (method !== "tools/list") return false;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [{ ...tool, inputSchema: { type: "object", description: "x".repeat(65536) } }],
          },
        }),
      );
      return true;
    });
    await expect(discoverMcp(local.url)).rejects.toThrow();
  });
  it("rechecks authorization immediately after discovery and before tools/call", async () => {
    let revoked = false;
    const local = await endpoint((method) => {
      if (method === "tools/list") revoked = true;
      return false;
    });
    const denial = new Error("permission revoked");
    let checked = false;
    await expect(
      callMcp(local.url, "echo", { text: "hello" }, undefined, {
        beforeCall: () => {
          checked = true;
          expect(revoked).toBe(true);
          throw denial;
        },
      }),
    ).rejects.toBe(denial);
    expect(checked).toBe(true);
    expect(local.calls.some((call) => call.method === "tools/call")).toBe(false);
  });
  it.each(["uri", "date-time", "email"])(
    "discovers standard %s schemas and rejects malformed arguments",
    async (format) => {
      const advertised = {
        ...tool,
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", format } },
          required: ["text"],
        },
      };
      const local = await endpoint((method, response, _request, id) => {
        if (method !== "tools/list") return false;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [advertised] } }));
        return true;
      });
      expect(await discoverMcp(local.url)).toEqual([advertised]);
      await expect(callMcp(local.url, "echo", { text: "malformed" })).rejects.toThrow(
        "MCP arguments do not match",
      );
      expect(local.calls.some((call) => call.method === "tools/call")).toBe(false);
      const valid =
        format === "uri"
          ? "https://example.org/resource"
          : format === "date-time"
            ? "2026-10-27T12:00:00Z"
            : "person@example.org";
      await expect(callMcp(local.url, "echo", { text: valid })).resolves.toMatchObject({
        content: [{ type: "text", text: "hello" }],
      });
    },
  );
});
