/** Application tool definitions run inside Harness; only the Host performs writes. */
import { request as httpRequest } from "node:http";
export const APP_TOOLS_URL_ENV = "DSB_APP_TOOLS_URL";
export const APP_TOOLS_TOKEN_ENV = "DSB_APP_TOOLS_TOKEN";

export const APPLICATION_TOOL_NAMES = [
  "list_bots",
  "list_groups",
  "get_run",
  "get_run_events",
  "create_bot_draft",
  "create_group",
  "create_bots_batch",
  "revoke_batch",
] as const;

const CALL_TIMEOUT_MS = 660_000;
const ASK_USER_TIMEOUT_MS = 31 * 60_000;
const STARTUP_TIMEOUT_MS = 30_000;
const CODES = new Set([
  "INVALID_INPUT",
  "UNAUTHORIZED_PATH",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "CANCELLED",
  "TOOL_TIMEOUT",
  "RUNTIME_UNAVAILABLE",
  "RATE_LIMITED",
]);

interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
export interface ApplicationToolExecution {
  readonly agent?: { readonly session?: { readonly id?: unknown } };
  readonly callId: string;
  readonly signal?: AbortSignal;
}
export interface ApplicationToolDefinition extends ToolSchema {
  readonly output: {
    readonly schema: Record<string, unknown>;
    render(args: unknown, value: unknown): Array<{ type: "text"; text: string }>;
  };
  readonly timeoutMs: number;
  execute(args: unknown, exec: ApplicationToolExecution): Promise<unknown>;
}
export interface ApplicationToolContext {
  readonly tools?: { register(definition: ApplicationToolDefinition): () => void };
  /** Present on the Harness plugin context. Unit fixtures may omit it. */
  on?(event: string, handler: (payload: unknown) => void): void;
}

class ApplicationToolError extends Error {
  constructor(readonly code: string) {
    super(`application tool call failed (${code})`);
    this.name = "ApplicationToolError";
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function alreadyRegistered(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already registered");
}

function catalog(value: unknown): ToolSchema[] {
  if (
    !object(value) ||
    !Array.isArray(value.tools) ||
    value.tools.length !== APPLICATION_TOOL_NAMES.length
  ) {
    throw new Error("invalid catalog");
  }
  const names = new Set<string>();
  return value.tools.map((tool: unknown) => {
    if (
      !object(tool) ||
      typeof tool.name !== "string" ||
      !(APPLICATION_TOOL_NAMES as readonly string[]).includes(tool.name) ||
      names.has(tool.name) ||
      typeof tool.description !== "string" ||
      !object(tool.parameters) ||
      tool.parameters.type !== "object"
    ) {
      throw new Error("invalid catalog");
    }
    names.add(tool.name);
    return { name: tool.name, description: tool.description, parameters: tool.parameters };
  });
}

function askUserTool(value: unknown): ToolSchema {
  if (
    !object(value) ||
    !object(value.tool) ||
    value.tool.name !== "ask_user" ||
    typeof value.tool.description !== "string" ||
    !object(value.tool.parameters) ||
    value.tool.parameters.type !== "object"
  ) {
    throw new Error("invalid catalog");
  }
  return {
    name: "ask_user",
    description: value.tool.description,
    parameters: value.tool.parameters,
  };
}

const MEMORY_TOOL_NAMES = ["memory_write", "memory_search", "knowledge_search"] as const;

function memoryTools(value: unknown): ToolSchema[] {
  if (!object(value) || !Array.isArray(value.tools) || value.tools.length !== MEMORY_TOOL_NAMES.length) {
    throw new Error("invalid catalog");
  }
  const tools: unknown[] = value.tools;
  return MEMORY_TOOL_NAMES.map((name) => {
    const tool = tools.find((item) => object(item) && item.name === name);
    if (
      !object(tool) ||
      typeof tool.description !== "string" ||
      !object(tool.parameters) ||
      tool.parameters.type !== "object"
    ) {
      throw new Error("invalid catalog");
    }
    return { name, description: tool.description, parameters: tool.parameters };
  });
}

function webSearchTool(value: unknown): ToolSchema {
  if (
    !object(value) ||
    !object(value.tool) ||
    value.tool.name !== "web_search" ||
    typeof value.tool.description !== "string" ||
    !object(value.tool.parameters) ||
    value.tool.parameters.type !== "object"
  ) {
    throw new Error("invalid catalog");
  }
  return {
    name: "web_search",
    description: value.tool.description,
    parameters: value.tool.parameters,
  };
}

/** Authenticated local transport never reflects server text, URLs, or tokens in errors. */
async function request(
  base: string,
  token: string,
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  // http.request has no hidden fetch headers deadline shorter than the
  // ten-minute human approval wait. The caller's signal owns the deadline.
  return await new Promise<unknown>((resolve, reject) => {
    const outgoing = httpRequest(
      `${base}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        signal,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error("application transport failed"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            outgoing.destroy(new Error("application response too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
          } catch {
            reject(new Error("application response is invalid"));
          }
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** Registers the Host catalog and acknowledges readiness before any prompt may run. */
export async function applyApplicationTools(ctx: ApplicationToolContext): Promise<void> {
  const base = process.env[APP_TOOLS_URL_ENV];
  const token = process.env[APP_TOOLS_TOKEN_ENV];
  if (base === undefined && token === undefined) return;
  const unregister: Array<() => void> = [];
  try {
    if (
      base === undefined ||
      token === undefined ||
      token.length === 0 ||
      ctx.tools === undefined
    ) {
      throw new Error("missing application transport");
    }
    const url = new URL(base);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("invalid application transport");
    const origin = url.origin;
    const tools = ctx.tools;
    const startupSignal = AbortSignal.timeout(STARTUP_TIMEOUT_MS);
    const schemas = catalog(await request(origin, token, "/app-tools", startupSignal));
    const askUser = askUserTool(
      await request(origin, token, "/ask-user", AbortSignal.timeout(STARTUP_TIMEOUT_MS)),
    );
    const memory = memoryTools(
      await request(origin, token, "/memory", AbortSignal.timeout(STARTUP_TIMEOUT_MS)),
    );
    const webSearch = webSearchTool(
      await request(origin, token, "/web-search", AbortSignal.timeout(STARTUP_TIMEOUT_MS)),
    );
    const bindRemote = (
      schema: ToolSchema,
      path: string,
      timeoutMs: number,
      register: (definition: ApplicationToolDefinition) => () => void = (definition) =>
        tools.register(definition),
    ): void => {
      unregister.push(
        register({
          ...schema,
          timeoutMs,
          output: {
            schema: {},
            render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
          },
          async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            if (
              typeof sessionId !== "string" ||
              sessionId.length === 0 ||
              typeof exec.callId !== "string" ||
              exec.callId.length === 0
            ) {
              throw new ApplicationToolError("INVALID_INPUT");
            }
            const timeout = AbortSignal.timeout(timeoutMs);
            const signal =
              exec.signal === undefined ? timeout : AbortSignal.any([exec.signal, timeout]);
            try {
              const payload = await request(origin, token, path, signal, {
                sessionId,
                callId: exec.callId,
                tool: schema.name,
                params: args,
              });
              if (!object(payload) || typeof payload.ok !== "boolean")
                throw new ApplicationToolError("RUNTIME_UNAVAILABLE");
              if (payload.ok) {
                if (!Object.hasOwn(payload, "result"))
                  throw new ApplicationToolError("RUNTIME_UNAVAILABLE");
                return payload.result;
              }
              const code =
                object(payload.error) &&
                typeof payload.error.code === "string" &&
                CODES.has(payload.error.code)
                  ? payload.error.code
                  : "RUNTIME_UNAVAILABLE";
              throw new ApplicationToolError(code);
            } catch (error) {
              if (exec.signal?.aborted) throw new ApplicationToolError("CANCELLED");
              if (timeout.aborted) throw new ApplicationToolError("TOOL_TIMEOUT");
              if (error instanceof ApplicationToolError) throw error;
              throw new ApplicationToolError("RUNTIME_UNAVAILABLE");
            }
          },
        }),
      );
    };
    for (const schema of schemas) bindRemote(schema, "/app-tools/call", CALL_TIMEOUT_MS);
    bindRemote(askUser, "/ask-user/call", ASK_USER_TIMEOUT_MS);
    for (const schema of memory) bindRemote(schema, "/memory/call", CALL_TIMEOUT_MS);
    // Harness already publishes a global web_search. A second global name
    // aborts plugin startup, so the chat tool is registered on each agent and
    // shadows that built-in for the session.
    try {
      bindRemote(webSearch, "/web-search/call", CALL_TIMEOUT_MS);
    } catch (error) {
      if (!alreadyRegistered(error)) throw error;
      ctx.on?.("agent/created", (payload: unknown) => {
        if (!object(payload) || !object(payload.agent)) return;
        const agentCtx = payload.agent.ctx;
        if (!object(agentCtx) || !object(agentCtx.tools) || typeof agentCtx.tools.register !== "function") {
          return;
        }
        const scoped = agentCtx.tools as {
          register(definition: ApplicationToolDefinition): () => void;
        };
        try {
          bindRemote(webSearch, "/web-search/call", CALL_TIMEOUT_MS, (definition) =>
            scoped.register(definition),
          );
        } catch (shadowError) {
          if (!alreadyRegistered(shadowError)) throw shadowError;
        }
      });
    }
    const ready = await request(origin, token, "/app-tools/ready", startupSignal, {
      tools: schemas.map((schema) => schema.name),
    });
    if (!object(ready) || ready.ok !== true) throw new Error("readiness rejected");
  } catch {
    for (const dispose of unregister.reverse()) dispose();
    throw new Error("application tool bridge is unavailable");
  }
}
