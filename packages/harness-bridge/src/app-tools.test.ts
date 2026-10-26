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
  options: { badCatalog?: boolean; status?: number; failure?: boolean; slow?: boolean } = {},
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
    if (request.url === "/ask-user") {
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
            : { ok: true, result: { group: { id: "g1" } } },
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
  it("registers the eight Host schemas before readiness and forwards exact runtime identity", async () => {
    const { ctx, tools, calls, requests } = await fixture();
    await apply(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([...names, "ask_user"]);
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
    expect(requests).toEqual([
      "/app-tools",
      "/ask-user",
      "/app-tools/ready",
      "/app-tools/call",
      "/ask-user/call",
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
});
