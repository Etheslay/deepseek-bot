import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsModule from "ajv-formats";
import { McpToolSchema, type McpTool } from "@deepseek-bot/contracts";

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_TOOLS = 200;
class McpLocalError extends Error {}

export interface McpClientOptions {
  discoveryTimeoutMs?: number;
  callTimeoutMs?: number;
  expectedTool?: McpTool;
  /** Revalidate live Host policy synchronously after remote discovery, just before dispatch. */
  beforeCall?: () => void;
}
export interface McpCallResult {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Literal loopback only. Resolve localhost ourselves so DNS cannot rebind it. */
export function normalizeMcpEndpoint(endpoint: string): URL {
  const authority = /^https?:\/\/([^/?#]+)/u.exec(endpoint)?.[1];
  if (!authority || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?$/iu.test(authority)) {
    throw new Error("MCP endpoint must use local loopback HTTP");
  }
  const url = new URL(endpoint);
  if (url.username || url.password || endpoint.includes("?") || endpoint.includes("#")) {
    throw new Error("MCP endpoint must not contain credentials, query or fragment");
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url;
}

function schemaValidator(tool: McpTool) {
  try {
    if (Buffer.byteLength(JSON.stringify(tool.inputSchema)) > MAX_SCHEMA_BYTES) throw new Error();
    // Never compile asynchronous schemas or resolve references outside this document.
    const pending: { value: unknown; depth: number }[] = [{ value: tool.inputSchema, depth: 0 }];
    while (pending.length) {
      const entry = pending.pop()!;
      if (entry.depth > 64) throw new Error();
      if (entry.value && typeof entry.value === "object") {
        for (const [key, value] of Object.entries(entry.value)) {
          if (
            (key === "$ref" || key === "$dynamicRef" || key === "$recursiveRef") &&
            (typeof value !== "string" || !value.startsWith("#"))
          )
            throw new Error();
          if (key === "$async") throw new Error();
          pending.push({ value, depth: entry.depth + 1 });
        }
      }
    }
    const dialect = tool.inputSchema.$schema;
    if (
      dialect !== undefined &&
      dialect !== "http://json-schema.org/draft-07/schema#" &&
      dialect !== "https://json-schema.org/draft/2020-12/schema"
    )
      throw new Error();
    const Constructor = dialect === "https://json-schema.org/draft/2020-12/schema" ? Ajv2020 : Ajv;
    const validator = new Constructor({ strict: true, allErrors: false, validateFormats: true });
    formatsModule.default(validator);
    return validator.compile(tool.inputSchema);
  } catch {
    throw new McpLocalError("MCP tool schema is unsupported or invalid");
  }
}

export function validateMcpArguments(tool: McpTool, args: Record<string, unknown>): void {
  if (!schemaValidator(tool)(args))
    throw new McpLocalError("MCP arguments do not match tool schema");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

async function withClient<T>(
  endpoint: string,
  signal: AbortSignal | undefined,
  timeout: number,
  action: (client: Client, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const url = normalizeMcpEndpoint(endpoint);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("MCP deadline must be positive");
  const deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let boundaryError: Error | undefined;
  let bytes = 0;
  const client = new Client({ name: "deepseek-bot", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(url, {
    onInsufficientScope: "throw",
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (input, init) => {
      const requestUrl = normalizeMcpEndpoint(String(input));
      if (requestUrl.href !== url.href) throw new Error("MCP request target changed");
      const headers = new Headers(init?.headers);
      headers.delete("authorization");
      headers.delete("cookie");
      const response = await fetch(requestUrl, {
        ...init,
        headers,
        redirect: "manual",
        credentials: "omit",
        signal: init?.signal ? AbortSignal.any([combined, init.signal]) : combined,
      });
      if (response.status >= 300 && response.status < 400)
        boundaryError = new Error("MCP redirect denied");
      else if (response.status === 401 || response.status === 403)
        boundaryError = new Error("MCP authentication is not supported");
      else if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES - bytes)
        boundaryError = new Error("MCP response exceeds size limit");
      if (boundaryError) {
        await response.body?.cancel();
        throw boundaryError;
      }
      if (!response.body) return response;
      const reader = response.body.getReader();
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                controller.close();
                return;
              }
              bytes += chunk.value.byteLength;
              if (bytes > MAX_RESPONSE_BYTES) {
                boundaryError = new Error("MCP response exceeds size limit");
                await reader.cancel();
                controller.error(boundaryError);
                return;
              }
              controller.enqueue(chunk.value);
            } catch (error) {
              controller.error(error);
            }
          },
          async cancel() {
            await reader.cancel();
          },
        }),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      );
    },
  });
  let abort: (() => void) | undefined;
  try {
    combined.throwIfAborted();
    return await Promise.race([
      (async () => {
        await client.connect(transport, { signal: combined, timeout: Math.min(timeout, 10_000) });
        return action(client, combined);
      })(),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("aborted"));
        combined.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } catch (error) {
    if (signal?.aborted) throw new Error("MCP request cancelled");
    if (deadline.aborted) throw new Error("MCP request timed out");
    if (boundaryError) throw boundaryError;
    if (error instanceof McpLocalError) throw error;
    throw new Error("MCP request failed");
  } finally {
    if (abort) combined.removeEventListener("abort", abort);
    await client.close().catch(() => undefined);
  }
}

async function listTools(client: Client, signal: AbortSignal): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let schemaBytes = 0;
  do {
    // An explicit empty first cursor bypasses SDK auto-pagination so our limits apply per page.
    const result = await client.listTools({ cursor: cursor ?? "" }, { signal });
    for (const raw of result.tools) {
      const tool = McpToolSchema.parse(raw);
      if (tools.length >= MAX_TOOLS || tools.some((item) => item.name === tool.name))
        throw new Error("invalid tool catalog");
      schemaBytes += Buffer.byteLength(JSON.stringify(tool.inputSchema));
      if (schemaBytes > MAX_SCHEMA_BYTES) throw new Error("schema budget exceeded");
      schemaValidator(tool);
      tools.push(tool);
    }
    cursor = result.nextCursor;
    if (cursor !== undefined) {
      if (cursors.has(cursor) || cursors.size >= MAX_TOOLS)
        throw new Error("pagination limit exceeded");
      cursors.add(cursor);
    }
  } while (cursor !== undefined);
  return tools;
}

export function discoverMcp(
  endpoint: string,
  signal?: AbortSignal,
  options: McpClientOptions = {},
): Promise<McpTool[]> {
  return withClient(endpoint, signal, options.discoveryTimeoutMs ?? 10_000, listTools);
}

export async function callMcp(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  options: McpClientOptions = {},
): Promise<McpCallResult> {
  let beforeCallFailure: { error: unknown } | undefined;
  return withClient(
    endpoint,
    signal,
    options.callTimeoutMs ?? 120_000,
    async (client, requestSignal) => {
      const discoveryDeadline = AbortSignal.timeout(options.discoveryTimeoutMs ?? 10_000);
      let tools: McpTool[];
      try {
        tools = await listTools(client, AbortSignal.any([requestSignal, discoveryDeadline]));
      } catch (error) {
        if (discoveryDeadline.aborted) throw new McpLocalError("MCP request timed out");
        throw error;
      }
      const tool = tools.find((entry) => entry.name === toolName);
      if (!tool) throw new McpLocalError("MCP tool is unavailable");
      if (
        options.expectedTool &&
        (options.expectedTool.name !== tool.name ||
          stable(options.expectedTool.inputSchema) !== stable(tool.inputSchema))
      )
        throw new McpLocalError("MCP tool schema changed");
      validateMcpArguments(tool, args);
      try {
        options.beforeCall?.();
      } catch (error) {
        beforeCallFailure = { error };
        throw error;
      }
      const result = await client.callTool(
        { name: toolName, arguments: args },
        { signal: requestSignal, timeout: options.callTimeoutMs ?? 120_000 },
      );
      return {
        content: result.content,
        ...(result.isError !== undefined ? { isError: result.isError } : {}),
        ...(result.structuredContent &&
        typeof result.structuredContent === "object" &&
        !Array.isArray(result.structuredContent)
          ? { structuredContent: result.structuredContent as Record<string, unknown> }
          : {}),
      };
    },
  ).catch((error: unknown) => {
    // This callback is trusted Host policy, so preserve its error code/identity.
    // Only remote protocol/transport errors pass through the sanitizer above.
    if (beforeCallFailure) throw beforeCallFailure.error;
    throw error;
  });
}
