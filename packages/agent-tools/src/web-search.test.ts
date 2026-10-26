import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { WebSearchService, bindWebSearchTool } from "./web-search.js";

const servers: Server[] = [];
const services: WebSearchService[] = [];
const caller = { id: "chat:search-session/bot" };
const allow = { authorize: async () => undefined };
const secretQuery = "private search terms";

async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("not listening");
  return `http://127.0.0.1:${address.port}/search`;
}

function setup(url?: string, timeoutMs?: number, grants?: { allowed: boolean }) {
  const search = new WebSearchService({
    ...(url !== undefined ? { endpoint: url } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  services.push(search);
  const audit = new MemoryAuditSink();
  const registry = new ToolRegistry();
  registry.register(bindWebSearchTool(search));
  const gateway = new ToolGateway({
    registry,
    audit,
    ...(grants !== undefined ? { grants: { check: async () => grants } } : {}),
  });
  return { search, gateway, audit };
}

afterEach(async () => {
  for (const search of services.splice(0)) search.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("SearXNG web_search", () => {
  it("authorizes the exact POST before sending and returns bounded, deduplicated search metadata", async () => {
    let posted = "";
    let requestUrl = "";
    let authorized = false;
    const url = await endpoint(async (request, response) => {
      expect(authorized).toBe(true);
      expect(request.method).toBe("POST");
      expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
      expect(request.headers.authorization).toBeUndefined();
      requestUrl = request.url!;
      for await (const chunk of request) posted += String(chunk);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          results: [
            {
              title: "<b>First</b>",
              url: "https://example.org/a#one",
              content: "<b>Secret result</b>",
            },
            { title: "duplicate", url: "https://example.org/a#two", content: "duplicate" },
            { title: "unsafe", url: "javascript:alert(1)", content: "bad" },
            { title: "credential url", url: "https://user:password@example.org/", content: "bad" },
            { title: "Second", url: "https://example.org/b", content: "x".repeat(3_000) },
            { title: "Third", url: "https://example.org/c" },
          ],
          unresponsive_engines: [["one", "timeout"]],
        }),
      );
    });
    const { gateway, audit } = setup(url);
    const authorize = vi.fn(async (action) => {
      expect(action).toMatchObject({
        kind: "network.request",
        toolName: "web_search",
        url,
        arguments: { method: "POST", query: secretQuery, maxResults: 2, format: "json" },
      });
      authorized = true;
    });
    const result = await gateway.call(
      caller,
      "web_search",
      { query: ` ${secretQuery} `, maxResults: 2 },
      { networkPermissions: { authorize } },
    );
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(requestUrl).toBe("/search");
    expect(Object.fromEntries(new URLSearchParams(posted))).toEqual({
      q: secretQuery,
      format: "json",
      categories: "general",
      safesearch: "1",
    });
    expect(result).toMatchObject({
      provider: "searxng",
      query: secretQuery,
      results: [
        { title: "First", url: "https://example.org/a", snippet: "Secret result" },
        { title: "Second", url: "https://example.org/b", snippet: "x".repeat(2_000) },
      ],
      warnings: ["Some search engines were unavailable; results may be incomplete."],
    });
    expect(audit.records).toMatchObject([{ tool: "web_search", outcome: "ok" }]);
    expect(audit.records[0]?.resultDigest).toHaveLength(64);
    expect(JSON.stringify(audit.records)).not.toContain(secretQuery);
    expect(JSON.stringify(audit.records)).not.toContain("Secret result");
  });

  it("defaults to five results and allows a genuine empty result set", async () => {
    const url = await endpoint((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end('{"results":[]}');
    });
    const { gateway } = setup(url);
    await expect(
      gateway.call(caller, "web_search", { query: "nothing" }, { networkPermissions: allow }),
    ).resolves.toMatchObject({ results: [], warnings: [] });
  });

  it.each([
    { query: " " },
    { query: "x".repeat(513) },
    { query: "q", maxResults: 0 },
    { query: "q", maxResults: 11 },
    { query: "q", maxResults: 1.5 },
    { query: "q", endpoint: "https://untrusted.example/search" },
    { query: "q", networkPermissions: { allowed: true } },
  ])("rejects invalid tool parameters before permission or network access", async (params) => {
    const { gateway } = setup("https://search.example/search");
    const authorize = vi.fn();
    await expect(
      gateway.call(caller, "web_search", params, { networkPermissions: { authorize } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each([
    "file:///tmp/a",
    "http://public.example/search",
    "https://u:p@example.org/search",
    "https://example.org/search?q=private",
    "https://example.org/search#fragment",
    "not a URL",
  ])("rejects unsafe endpoint configuration: %s", (url) => {
    expect(() => setup(url)).toThrow();
  });

  it("fails explicitly when unconfigured or missing permission, and sanitizes permission errors", async () => {
    const { gateway: unconfigured } = setup();
    await expect(
      unconfigured.call(
        caller,
        "web_search",
        { query: secretQuery },
        { networkPermissions: allow },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    let requests = 0;
    const url = await endpoint((_request, response) => {
      requests++;
      response.end();
    });
    const { gateway, audit } = setup(url);
    await expect(gateway.call(caller, "web_search", { query: secretQuery })).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
    await expect(
      gateway.call(
        caller,
        "web_search",
        { query: secretQuery },
        {
          networkPermissions: {
            authorize: async () => {
              throw Object.assign(new Error(secretQuery), { code: "APPROVAL_REQUIRED" });
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(requests).toBe(0);
    expect(JSON.stringify(audit.records)).not.toContain(secretQuery);
  });

  it("retains the gateway grant check before the network permission handle", async () => {
    const { gateway } = setup("https://search.example/search", undefined, { allowed: false });
    const authorize = vi.fn();
    await expect(
      gateway.call(caller, "web_search", { query: "q" }, { networkPermissions: { authorize } }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each([403, 429, 500])(
    "maps HTTP %s without logging the response body or query",
    async (status) => {
      const url = await endpoint((_request, response) => {
        response.writeHead(status);
        response.end(secretQuery);
      });
      const { gateway, audit } = setup(url);
      await expect(
        gateway.call(caller, "web_search", { query: secretQuery }, { networkPermissions: allow }),
      ).rejects.toMatchObject({ code: status === 429 ? "RATE_LIMITED" : "RUNTIME_UNAVAILABLE" });
      expect(JSON.stringify(audit.records)).not.toContain(secretQuery);
    },
  );

  it.each([
    { contentType: "text/html", body: "<html>captcha</html>" },
    { contentType: "application/json", body: "invalid json" },
    { contentType: "application/json", body: '{"error":"bad"}' },
    { contentType: "application/json", body: '{"results":"invalid"}' },
  ])(
    "rejects invalid provider responses rather than reporting zero matches",
    async ({ contentType, body }) => {
      const url = await endpoint((_request, response) => {
        response.setHeader("Content-Type", contentType);
        response.end(body);
      });
      const { gateway } = setup(url);
      await expect(
        gateway.call(caller, "web_search", { query: "q" }, { networkPermissions: allow }),
      ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    },
  );

  it("does not follow redirects or fetch result URLs", async () => {
    let followups = 0;
    const destination = await endpoint((_request, response) => {
      followups++;
      response.end();
    });
    const url = await endpoint((_request, response) => {
      response.writeHead(302, { Location: destination });
      response.end();
    });
    const { gateway } = setup(url);
    await expect(
      gateway.call(caller, "web_search", { query: "q" }, { networkPermissions: allow }),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect(followups).toBe(0);
  });

  it.each([true, false])(
    "bounds response bytes with content-length present: %s",
    async (declareLength) => {
      const url = await endpoint((_request, response) => {
        response.setHeader("Content-Type", "application/json");
        const body = JSON.stringify({ results: [], padding: "x".repeat(1_048_577) });
        if (declareLength) response.setHeader("Content-Length", Buffer.byteLength(body));
        else response.setHeader("Transfer-Encoding", "chunked");
        response.end(body);
      });
      const { gateway } = setup(url);
      await expect(
        gateway.call(caller, "web_search", { query: "q" }, { networkPermissions: allow }),
      ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    },
  );

  it("times out stalled response bodies and audits a classified failure", async () => {
    const url = await endpoint((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"results":[');
    });
    const { gateway, audit } = setup(url, 100);
    await expect(
      gateway.call(caller, "web_search", { query: secretQuery }, { networkPermissions: allow }),
    ).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
    expect(audit.records).toMatchObject([{ outcome: "error", code: "TOOL_TIMEOUT" }]);
    expect(JSON.stringify(audit.records)).not.toContain(secretQuery);
  });

  it("cancels while waiting for permission and never searches after a late authorization", async () => {
    let requests = 0;
    const url = await endpoint((_request, response) => {
      requests++;
      response.end();
    });
    const { gateway } = setup(url);
    const controller = new AbortController();
    let approve!: () => void;
    const authorize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        }),
    );
    const failed = expect(
      gateway.call(
        caller,
        "web_search",
        { query: "q" },
        { signal: controller.signal, networkPermissions: { authorize } },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    controller.abort(secretQuery);
    await failed;
    approve();
    expect(requests).toBe(0);
  });

  it("cancels an active request and closes active/future searches", async () => {
    let requests = 0;
    const url = await endpoint(() => {
      requests++;
    });
    const { search, gateway, audit } = setup(url);
    const controller = new AbortController();
    const failed = expect(
      gateway.call(
        caller,
        "web_search",
        { query: secretQuery },
        { signal: controller.signal, networkPermissions: allow },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(requests).toBe(1));
    controller.abort(secretQuery);
    await failed;
    const closed = expect(
      gateway.call(caller, "web_search", { query: secretQuery }, { networkPermissions: allow }),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    await vi.waitFor(() => expect(requests).toBe(2));
    search.close();
    await closed;
    await expect(
      gateway.call(caller, "web_search", { query: secretQuery }, { networkPermissions: allow }),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect(JSON.stringify(audit.records)).not.toContain(secretQuery);
  });

  it("does not authorize a pre-cancelled search", async () => {
    const { gateway } = setup("https://search.example/search");
    const authorize = vi.fn();
    await expect(
      gateway.call(
        caller,
        "web_search",
        { query: "q" },
        { signal: AbortSignal.abort(), networkPermissions: { authorize } },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(authorize).not.toHaveBeenCalled();
  });
});
