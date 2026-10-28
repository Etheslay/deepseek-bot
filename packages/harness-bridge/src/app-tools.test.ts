import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply } from "./index.js";

const names = [
  "list_bots",
  "list_groups",
  "get_run",
  "get_run_events",
  "create_bot_draft",
  "create_group",
  "create_bots_batch",
  "revoke_batch",
  "save_workflow",
  "dispatch_task",
  "list_tasks",
  "read_workspace_file",
];
interface Definition {
  name: string;
  parameters: unknown;
  output: { render(args: unknown, value: unknown): unknown };
  timeoutMs?: number;
  execute(
    args: unknown,
    exec: { agent?: { session?: { id?: unknown } }; callId: string; signal?: AbortSignal },
  ): Promise<unknown>;
}
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(
  options: {
    badCatalog?: boolean;
    status?: number;
    failure?: boolean;
    slow?: boolean;
    mcp?: unknown;
    mcpStatus?: number;
    mcpSlow?: boolean;
    screen?: unknown;
    result?: unknown;
  } = {},
) {
  const calls: unknown[] = [];
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url!);
    expect(request.headers.authorization).toBe("Bearer per-turn-secret");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks as Buffer[]).toString();
    response.setHeader("content-type", "application/json");
    if (request.url === "/mcp") {
      if (options.mcpSlow) return;
      response.statusCode = options.mcpStatus ?? 200;
      response.end(JSON.stringify(options.mcp ?? { tools: [], warnings: [] }));
    } else if (request.url === "/screen") {
      response.end(JSON.stringify(options.screen ?? { tools: [] }));
    } else if (request.url === "/web-search") {
      response.end(
        JSON.stringify({
          tool: {
            name: "web_search",
            description: "web_search",
            parameters: { type: "object", additionalProperties: false, properties: {} },
          },
        }),
      );
    } else if (request.url === "/memory") {
      response.end(
        JSON.stringify({
          tools: [
            {
              name: "memory_write",
              description: "memory_write",
              parameters: { type: "object", additionalProperties: false, properties: {} },
            },
            {
              name: "memory_search",
              description: "memory_search",
              parameters: { type: "object", additionalProperties: false, properties: {} },
            },
            {
              name: "knowledge_search",
              description: "knowledge_search",
              parameters: { type: "object", additionalProperties: false, properties: {} },
            },
          ],
        }),
      );
    } else if (request.url === "/connectors") {
      response.end(
        JSON.stringify({
          tools: [
            {
              name: "connector_invoke",
              description: "connector_invoke",
              parameters: { type: "object", additionalProperties: false, properties: {} },
            },
          ],
        }),
      );
    } else if (request.url === "/ask-user") {
      response.end(
        JSON.stringify({
          tool: {
            name: "ask_user",
            description: "ask_user",
            parameters: { type: "object", additionalProperties: false, properties: {} },
          },
        }),
      );
    } else if (request.url === "/app-tools") {
      response.statusCode = options.status ?? 200;
      response.end(
        JSON.stringify({
          tools: (options.badCatalog ? [...names, "permission.policy.set"] : names).map((name) => ({
            name,
            description: name,
            parameters: { type: "object", additionalProperties: false, properties: {} },
          })),
        }),
      );
    } else if (request.url === "/app-tools/ready") {
      calls.push(JSON.parse(body));
      response.end(JSON.stringify({ ok: true }));
    } else {
      calls.push(JSON.parse(body));
      if (options.slow) return;
      response.end(
        JSON.stringify(
          options.failure
            ? {
                ok: false,
                error: { code: "UNAUTHORIZED_PATH", message: "private original question" },
              }
            : { ok: true, result: options.result ?? { group: { id: "g1" } } },
        ),
      );
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("not listening");
  vi.stubEnv("DSB_APP_TOOLS_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("DSB_APP_TOOLS_TOKEN", "per-turn-secret");
  const tools: Definition[] = [];
  const ctx = {
    on: vi.fn(),
    tools: {
      register: (tool: Definition) => {
        tools.push(tool);
        return () => tools.splice(tools.indexOf(tool), 1);
      },
    },
  };
  return { ctx, tools, calls, requests };
}

describe("application tool plugin", () => {
  const mcpName = `mcp__${"a".repeat(32)}__${"b".repeat(12)}`;
  const mcpSchema = {
    name: mcpName,
    description: "Read authorized MCP data",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  };

  it("binds authorized MCP schemas over the authenticated Host channel", async () => {
    const result = {
      content: [
        { type: "text", text: "answer" },
        { type: "image", savedPath: "C:/data/image.png" },
      ],
    };
    const { ctx, tools, calls, requests } = await fixture({
      mcp: { tools: [mcpSchema], warnings: ["unavailable server"] },
      result,
    });
    await apply(ctx);
    const tool = tools.find((item) => item.name === mcpName)!;
    expect(tool).toBeDefined();
    expect(tool.parameters).toEqual(mcpSchema.parameters);
    expect(tool.timeoutMs).toBeGreaterThanOrEqual(720_000);
    expect(calls[0]).toEqual({ tools: names });
    const params = { query: "local" };
    expect(
      await tool.execute(params, { agent: { session: { id: "mcp-session" } }, callId: "mcp-call" }),
    ).toEqual(result);
    expect(requests.at(-1)).toBe("/mcp/call");
    expect(calls.at(-1)).toEqual({
      sessionId: "mcp-session",
      callId: "mcp-call",
      tool: mcpName,
      params,
    });
    expect(JSON.stringify(tool.output.render(params, result))).toContain("savedPath");
  });

  it.each([
    { tools: [{ ...mcpSchema, name: "permission.policy.set" }], warnings: [] },
    { tools: [{ ...mcpSchema, name: "list_bots" }], warnings: [] },
    { tools: [{ ...mcpSchema, name: "connector_invoke" }], warnings: [] },
    { tools: [{ ...mcpSchema, name: `${mcpName}suffix` }], warnings: [] },
    { tools: [mcpSchema, mcpSchema], warnings: [] },
    { tools: [{ ...mcpSchema, parameters: { type: "array" } }], warnings: [] },
    { tools: [mcpSchema], warnings: "invalid" },
    { tools: Array.from({ length: 201 }, () => mcpSchema), warnings: [] },
    { tools: [{ ...mcpSchema, description: "x".repeat(256 * 1024) }], warnings: [] },
  ])("fails closed on an invalid optional MCP directory and preserves readiness", async (mcp) => {
    const { ctx, tools, calls } = await fixture({ mcp });
    await apply(ctx);
    expect(tools).toHaveLength(18); // v0.7 adds save_workflow, dispatch_task, list_tasks; D26 adds read_workspace_file
    expect(tools.some((tool) => tool.name.startsWith("mcp__"))).toBe(false);
    expect(calls).toEqual([{ tools: names }]);
  });

  it("keeps regular tools ready when the MCP endpoint is unavailable", async () => {
    const { ctx, tools, calls } = await fixture({ mcpStatus: 503 });
    await apply(ctx);
    expect(tools).toHaveLength(18); // v0.7 adds save_workflow, dispatch_task, list_tasks; D26 adds read_workspace_file
    expect(calls).toEqual([{ tools: names }]);
  });

  it("keeps regular tools ready after MCP discovery times out", async () => {
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) =>
        originalTimeout(milliseconds === 30_000 ? 200 : milliseconds),
      );
    try {
      const { ctx, tools, calls } = await fixture({ mcpSlow: true });
      await apply(ctx);
      expect(tools).toHaveLength(18); // v0.7 adds save_workflow, dispatch_task, list_tasks; D26 adds read_workspace_file
      expect(calls).toEqual([{ tools: names }]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("preserves stable MCP error and cancellation semantics", async () => {
    const { ctx, tools } = await fixture({
      mcp: { tools: [mcpSchema], warnings: [] },
      failure: true,
    });
    await apply(ctx);
    const tool = tools.find((item) => item.name === mcpName)!;
    expect(tool).toBeDefined();
    await expect(
      tool.execute({}, { agent: { session: { id: "s" } }, callId: "c" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
      message: "application tool call failed (UNAUTHORIZED_PATH)",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute(
        {},
        { agent: { session: { id: "s" } }, callId: "cancel", signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("registers the eight Host schemas before readiness and forwards exact runtime identity", async () => {
    const { ctx, tools, calls, requests } = await fixture();
    await apply(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([
      ...names,
      "ask_user",
      "memory_write",
      "memory_search",
      "knowledge_search",
      "connector_invoke",
      "web_search",
    ]);
    expect(calls).toEqual([{ tools: names }]);
    const tool = tools.find((item) => item.name === "create_group")!;
    expect(tool.timeoutMs).toBeGreaterThan(600_000);
    const params = { name: "research" };
    expect(
      await tool.execute(params, { agent: { session: { id: "physical-session" } }, callId: "c1" }),
    ).toEqual({ group: { id: "g1" } });
    expect(calls[1]).toEqual({
      sessionId: "physical-session",
      callId: "c1",
      tool: "create_group",
      params,
    });
    expect(tool.output.render(params, { ok: true })).toEqual([
      { type: "text", text: '{"ok":true}' },
    ]);
    const ask = tools.find((item) => item.name === "ask_user")!;
    expect(ask.timeoutMs).toBeGreaterThan(30 * 60_000);
    expect(
      await ask.execute(
        { question: "Which first?" },
        { agent: { session: { id: "physical-session" } }, callId: "q1" },
      ),
    ).toEqual({ group: { id: "g1" } });
    expect(calls[2]).toEqual({
      sessionId: "physical-session",
      callId: "q1",
      tool: "ask_user",
      params: { question: "Which first?" },
    });
    const search = tools.find((item) => item.name === "web_search")!;
    expect(search.timeoutMs).toBe(tool.timeoutMs);
    expect(
      await search.execute(
        { query: "local docs" },
        { agent: { session: { id: "physical-session" } }, callId: "s1" },
      ),
    ).toEqual({ group: { id: "g1" } });
    expect(calls[3]).toEqual({
      sessionId: "physical-session",
      callId: "s1",
      tool: "web_search",
      params: { query: "local docs" },
    });
    expect(requests).toEqual([
      "/app-tools",
      "/ask-user",
      "/memory",
      "/connectors",
      "/web-search",
      "/screen",
      "/mcp",
      "/app-tools/ready",
      "/app-tools/call",
      "/ask-user/call",
      "/web-search/call",
    ]);
  });

  it("rejects unsupported control tools without registering any tool", async () => {
    const { ctx, tools, requests } = await fixture({ badCatalog: true });
    await expect(apply(ctx)).rejects.toThrow("application tool bridge is unavailable");
    expect(tools).toEqual([]);
    expect(requests).toEqual(["/app-tools"]);
  });

  it("fails startup on catalog HTTP failure", async () => {
    const { ctx, tools } = await fixture({ status: 401 });
    await expect(apply(ctx)).rejects.toThrow("application tool bridge is unavailable");
    expect(tools).toEqual([]);
  });

  it("returns a stable failure without reflecting raw Host error text", async () => {
    const { ctx, tools } = await fixture({ failure: true });
    await apply(ctx);
    await expect(
      tools[0]!.execute({}, { agent: { session: { id: "s1" } }, callId: "c1" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
      message: "application tool call failed (UNAUTHORIZED_PATH)",
    });
  });

  it("forwards cancellation and rejects missing runtime session before HTTP", async () => {
    const { ctx, tools, calls } = await fixture({ slow: true });
    await apply(ctx);
    await expect(tools[0]!.execute({}, { callId: "c1" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(calls).toHaveLength(1);
    const controller = new AbortController();
    const pending = tools[0]!.execute(
      {},
      { agent: { session: { id: "s1" } }, callId: "c2", signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("shadows a built-in web_search on the agent instead of failing startup", async () => {
    const { ctx, tools, calls, requests } = await fixture();
    const listeners = new Map<string, (payload: unknown) => void>();
    (ctx as { on: (event: string, handler: (payload: unknown) => void) => void }).on = (
      event,
      handler,
    ) => {
      listeners.set(event, handler);
    };
    const register = ctx.tools.register;
    ctx.tools.register = (tool: Definition) => {
      if (tool.name === "web_search") throw new Error('tool "web_search" is already registered');
      return register(tool);
    };
    await apply(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([
      ...names,
      "ask_user",
      "memory_write",
      "memory_search",
      "knowledge_search",
      "connector_invoke",
    ]);
    expect(calls[0]).toEqual({ tools: names });
    const agentTools: Definition[] = [];
    listeners.get("agent/created")?.({
      agent: {
        ctx: {
          tools: {
            register: (tool: Definition) => {
              agentTools.push(tool);
              return () => undefined;
            },
          },
        },
      },
    });
    expect(agentTools.map((tool) => tool.name)).toEqual(["web_search"]);
    expect(
      await agentTools[0]!.execute(
        { query: "local docs" },
        { agent: { session: { id: "physical-session" } }, callId: "s1" },
      ),
    ).toEqual({ group: { id: "g1" } });
    expect(requests).toContain("/web-search/call");
  });

  it("registers screen_capture only when the host catalog publishes it", async () => {
    const hidden = await fixture();
    await apply(hidden.ctx);
    expect(hidden.tools.map((tool) => tool.name)).not.toContain("screen_capture");
    const { ctx, tools, requests } = await fixture({
      screen: {
        tools: [
          {
            name: "screen_capture",
            description: "screen_capture",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: { mode: { type: "string" } },
            },
          },
        ],
      },
    });
    await apply(ctx);
    const tool = tools.find((item) => item.name === "screen_capture");
    expect(tool?.timeoutMs).toBeGreaterThan(600_000);
    expect(
      await tool!.execute(
        { mode: "image" },
        { agent: { session: { id: "physical-session" } }, callId: "sc1" },
      ),
    ).toEqual({ group: { id: "g1" } });
    expect(requests).toContain("/screen");
    expect(requests).toContain("/screen/call");
  });
});
