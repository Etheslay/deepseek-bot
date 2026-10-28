import type { Readable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsModule from "ajv-formats";
import { McpToolSchema, type McpTool } from "@deepseek-bot/contracts";
import { mcpCredentialEnv, mcpStdioArgs, mcpStdioCommand } from "@deepseek-bot/storage";

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_TOOLS = 200;
const MAX_STDERR_BYTES = 1024 * 1024;
class McpLocalError extends Error {}

export interface McpClientOptions {
  discoveryTimeoutMs?: number;
  callTimeoutMs?: number;
  expectedTool?: McpTool;
  /** Revalidate live Host policy synchronously after remote discovery, just before dispatch. */
  beforeCall?: () => void;
  /**
   * Resolved secret for a bearer header. Callers must not log this value.
   * Absent means the request stays unauthenticated.
   */
  authorization?: string;
}
export interface McpStdioTarget {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Resolved secret. Injected as an environment variable, never as argv. */
  credential?: string;
  credentialEnv?: string;
}
export interface McpCallResult {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Printable ASCII only, so a secret cannot break a header or an env line. */
export function injectableCredential(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096)
    throw new McpLocalError("MCP credential is unusable");
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) throw new McpLocalError("MCP credential is unusable");
  }
  return value;
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

async function usingClient<T>(
  signal: AbortSignal | undefined,
  timeout: number,
  open: (client: Client, combined: AbortSignal) => Promise<void>,
  action: (client: Client, signal: AbortSignal) => Promise<T>,
  boundaryError: () => Error | undefined,
): Promise<T> {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("MCP deadline must be positive");
  const deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const client = new Client({ name: "deepseek-bot", version: "0.1.0" }, { capabilities: {} });
  let abort: (() => void) | undefined;
  try {
    combined.throwIfAborted();
    return await Promise.race([
      (async () => {
        await open(client, combined);
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
    if (boundaryError()) throw boundaryError();
    if (error instanceof McpLocalError) throw error;
    throw new Error("MCP request failed");
  } finally {
    if (abort) combined.removeEventListener("abort", abort);
    await client.close().catch(() => undefined);
  }
}

async function withClient<T>(
  endpoint: string,
  signal: AbortSignal | undefined,
  timeout: number,
  authorization: string | undefined,
  action: (client: Client, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const url = normalizeMcpEndpoint(endpoint);
  const bearer = authorization === undefined ? undefined : injectableCredential(authorization);
  let boundary: Error | undefined;
  let bytes = 0;
  return usingClient(
    signal,
    timeout,
    async (client, combined) => {
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
          if (bearer) headers.set("authorization", `Bearer ${bearer}`);
          const response = await fetch(requestUrl, {
            ...init,
            headers,
            redirect: "manual",
            credentials: "omit",
            signal: init?.signal ? AbortSignal.any([combined, init.signal]) : combined,
          });
          if (response.status >= 300 && response.status < 400)
            boundary = new Error("MCP redirect denied");
          else if (response.status === 401 || response.status === 403)
            boundary = new Error(
              bearer ? "MCP authentication failed" : "MCP authentication is not supported",
            );
          else if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES - bytes)
            boundary = new Error("MCP response exceeds size limit");
          if (boundary) {
            await response.body?.cancel();
            throw boundary;
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
                    boundary = new Error("MCP response exceeds size limit");
                    await reader.cancel();
                    controller.error(boundary);
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
      await client.connect(transport, { signal: combined, timeout: Math.min(timeout, 10_000) });
    },
    action,
    () => boundary,
  );
}

function stdioParameters(target: McpStdioTarget): {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
} {
  let command: string;
  let args: string[];
  try {
    command = mcpStdioCommand(target.command);
    args = mcpStdioArgs(target.args);
  } catch {
    throw new McpLocalError("MCP stdio command is not allowed");
  }
  const posix = target.cwd.startsWith("/");
  const windows = /^[A-Za-z]:[\\/]/u.test(target.cwd);
  if ((!posix && !windows) || target.cwd.split(/[\\/]/u).includes(".."))
    throw new McpLocalError("MCP stdio command is not allowed");
  if (target.credential === undefined) return { command, args, cwd: target.cwd };
  let envName: string | null;
  try {
    envName = mcpCredentialEnv(target.credentialEnv, true);
  } catch {
    throw new McpLocalError("MCP credential is unusable");
  }
  if (!envName) throw new McpLocalError("MCP credential is unusable");
  return {
    command,
    args,
    cwd: target.cwd,
    env: { [envName]: injectableCredential(target.credential) },
  };
}

function drainStderr(transport: StdioClientTransport): void {
  const stderr = transport.stderr;
  if (!stderr || !("on" in stderr)) return;
  let seen = 0;
  stderr.on("data", (chunk: Buffer | string) => {
    seen += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    if (seen > MAX_STDERR_BYTES) (stderr as Readable).destroy();
  });
}

async function withStdioClient<T>(
  target: McpStdioTarget,
  signal: AbortSignal | undefined,
  timeout: number,
  action: (client: Client, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const parameters = stdioParameters(target);
  return usingClient(
    signal,
    timeout,
    async (client, combined) => {
      const transport = new StdioClientTransport({
        command: parameters.command,
        args: parameters.args,
        cwd: parameters.cwd,
        ...(parameters.env ? { env: parameters.env } : {}),
        stderr: "pipe",
        maxBufferSize: MAX_RESPONSE_BYTES,
      });
      drainStderr(transport);
      await client.connect(transport, { signal: combined, timeout: Math.min(timeout, 10_000) });
    },
    action,
    () => undefined,
  );
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
  return withClient(
    endpoint,
    signal,
    options.discoveryTimeoutMs ?? 10_000,
    options.authorization,
    listTools,
  );
}

export function discoverMcpStdio(
  target: McpStdioTarget,
  signal?: AbortSignal,
  options: McpClientOptions = {},
): Promise<McpTool[]> {
  return withStdioClient(target, signal, options.discoveryTimeoutMs ?? 10_000, listTools);
}

async function performCall(
  client: Client,
  requestSignal: AbortSignal,
  toolName: string,
  args: Record<string, unknown>,
  options: McpClientOptions,
  beforeCallFailure: { error?: unknown },
): Promise<McpCallResult> {
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
    beforeCallFailure.error = error;
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
}

export async function callMcp(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  options: McpClientOptions = {},
): Promise<McpCallResult> {
  const beforeCallFailure: { error?: unknown } = {};
  return withClient(
    endpoint,
    signal,
    options.callTimeoutMs ?? 120_000,
    options.authorization,
    (client, requestSignal) =>
      performCall(client, requestSignal, toolName, args, options, beforeCallFailure),
  ).catch((error: unknown) => {
    // This callback is trusted Host policy, so preserve its error code/identity.
    // Only remote protocol/transport errors pass through the sanitizer above.
    if (beforeCallFailure.error) throw beforeCallFailure.error;
    throw error;
  });
}

export async function callMcpStdio(
  target: McpStdioTarget,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  options: McpClientOptions = {},
): Promise<McpCallResult> {
  const beforeCallFailure: { error?: unknown } = {};
  return withStdioClient(target, signal, options.callTimeoutMs ?? 120_000, (client, requestSignal) =>
    performCall(client, requestSignal, toolName, args, options, beforeCallFailure),
  ).catch((error: unknown) => {
    if (beforeCallFailure.error) throw beforeCallFailure.error;
    throw error;
  });
}
