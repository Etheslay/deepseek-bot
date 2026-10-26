/** Private per-turn Harness -> Host application tools. Never a desktop contract. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import {
  ToolRejectionError,
  type ToolCaller,
  type ToolGateway,
  type ToolNetworkPermissions,
} from "@deepseek-bot/agent-tools";
import { stableStringify } from "@deepseek-bot/runtime";

const APPLICATION_TOOLS = [
  "list_bots",
  "list_groups",
  "get_run",
  "get_run_events",
  "create_bot_draft",
  "create_group",
  "create_bots_batch",
  "revoke_batch",
] as const;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CALLS_PER_TURN = 1000;
type Result =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };
interface CallRecord {
  digest: string;
  controller: AbortController;
  result: Promise<Result>;
}
interface TurnState {
  sessionId: string;
  caller: ToolCaller;
  controller: AbortController;
  ready: Promise<void>;
  markReady(): void;
  calls: Map<string, CallRecord>;
  detach(): void;
}
export interface ApplicationToolTurn {
  readonly env: { DSB_APP_TOOLS_URL: string; DSB_APP_TOOLS_TOKEN: string };
  waitReady(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}
export interface ApplicationToolServer {
  readonly url: string;
  openTurn(options: {
    sessionId: string;
    caller: ToolCaller;
    signal: AbortSignal;
  }): ApplicationToolTurn;
  close(): Promise<void>;
}
function failure(code: string, message: string): Result {
  return { ok: false, error: { code, message } };
}
function send(response: ServerResponse, status: number, payload: unknown): void {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    length += bytes.length;
    if (length > MAX_BODY_BYTES)
      throw new ToolRejectionError("INVALID_INPUT", "application tool request is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function matches(received: string, token: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ApplicationToolChannelOptions {
  /** Bound only for web_search. Eight-tool and ask_user calls omit it. */
  readonly networkPermissions?: (caller: ToolCaller) => ToolNetworkPermissions | undefined;
}

export async function startApplicationToolServer(
  gateway: ToolGateway,
  options: ApplicationToolChannelOptions = {},
): Promise<ApplicationToolServer> {
  const turns = new Map<string, TurnState>();
  const schemas = gateway.capabilities.schemas(APPLICATION_TOOLS);
  const askUserSchema = gateway.capabilities.schemas(["ask_user"])[0];
  const webSearchSchema = gateway.capabilities.schemas(["web_search"])[0];
  const memorySchemas = gateway.capabilities.schemas([
    "memory_write",
    "memory_search",
    "knowledge_search",
  ]);
  let closed = false;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() =>
      send(response, 400, failure("INVALID_INPUT", "invalid application tool request")),
    );
  });
  server.requestTimeout = 12 * 60_000;
  server.timeout = 0;
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const header = request.headers.authorization;
    const token =
      typeof header === "string"
        ? [...turns.keys()].find((candidate) => matches(header, candidate))
        : undefined;
    const turn = token === undefined ? undefined : turns.get(token);
    if (turn === undefined) {
      send(response, 401, failure("UNAUTHORIZED_PATH", "application tool authentication failed"));
      return;
    }
    if (closed || turn.controller.signal.aborted) {
      send(response, 410, failure("CANCELLED", "chat turn is no longer active"));
      return;
    }
    if (request.method === "GET" && request.url === "/app-tools") {
      send(response, 200, { tools: schemas });
      return;
    }
    if (request.method === "GET" && request.url === "/ask-user") {
      send(response, 200, { tool: askUserSchema });
      return;
    }
    if (request.method === "GET" && request.url === "/web-search") {
      send(response, 200, { tool: webSearchSchema });
      return;
    }
    if (request.method === "GET" && request.url === "/memory") {
      send(response, 200, { tools: memorySchemas });
      return;
    }
    if (
      request.method !== "POST" ||
      (request.url !== "/app-tools/ready" &&
        request.url !== "/app-tools/call" &&
        request.url !== "/ask-user/call" &&
        request.url !== "/web-search/call" &&
        request.url !== "/memory/call")
    ) {
      send(response, 404, failure("INVALID_INPUT", "unknown application tool route"));
      return;
    }
    const parsed = await body(request);
    if (request.url === "/app-tools/ready") {
      if (
        !object(parsed) ||
        Object.keys(parsed).length !== 1 ||
        !Array.isArray(parsed.tools) ||
        parsed.tools.length !== APPLICATION_TOOLS.length ||
        [...parsed.tools].sort().join("\n") !== [...APPLICATION_TOOLS].sort().join("\n")
      ) {
        send(response, 400, failure("INVALID_INPUT", "application tools did not load completely"));
        return;
      }
      turn.markReady();
      send(response, 200, { ok: true });
      return;
    }
    if (
      !object(parsed) ||
      Object.keys(parsed).some((key) => !["sessionId", "callId", "tool", "params"].includes(key)) ||
      typeof parsed.callId !== "string" ||
      parsed.callId.length === 0 ||
      parsed.callId.length > 200 ||
      typeof parsed.tool !== "string" ||
      !Object.hasOwn(parsed, "params")
    ) {
      send(response, 400, failure("INVALID_INPUT", "invalid application tool invocation"));
      return;
    }
    if (parsed.sessionId !== turn.sessionId) {
      send(response, 403, failure("UNAUTHORIZED_PATH", "application tool session mismatch"));
      return;
    }
    const toolAllowed =
      request.url === "/ask-user/call"
        ? parsed.tool === "ask_user"
        : request.url === "/web-search/call"
          ? parsed.tool === "web_search"
          : request.url === "/memory/call"
            ? parsed.tool === "memory_write" ||
              parsed.tool === "memory_search" ||
              parsed.tool === "knowledge_search"
            : (APPLICATION_TOOLS as readonly string[]).includes(parsed.tool);
    if (!toolAllowed) {
      send(response, 400, failure("INVALID_INPUT", "tool is not available in chat"));
      return;
    }
    const digest = createHash("sha256")
      .update(stableStringify({ tool: parsed.tool, params: parsed.params }))
      .digest("hex");
    let record = turn.calls.get(parsed.callId);
    if (record !== undefined && record.digest !== digest) {
      send(response, 409, failure("INVALID_INPUT", "call ID was reused with different arguments"));
      return;
    }
    if (record === undefined) {
      if (turn.calls.size >= MAX_CALLS_PER_TURN) {
        send(response, 429, failure("RATE_LIMITED", "chat tool call limit reached"));
        return;
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      turn.controller.signal.addEventListener("abort", abort, { once: true });
      // The ledger is populated synchronously before another HTTP request can dispatch.
      const networkPermissions =
        parsed.tool === "web_search" ? options.networkPermissions?.(turn.caller) : undefined;
      const result = gateway
        .call(
          turn.caller,
          parsed.tool,
          parsed.params,
          networkPermissions === undefined
            ? { signal: controller.signal }
            : { signal: controller.signal, networkPermissions },
        )
        .then((value): Result => ({ ok: true, result: value }))
        .catch(
          (error: unknown): Result =>
            failure(
              error instanceof ToolRejectionError ? error.code : "RUNTIME_UNAVAILABLE",
              "application tool invocation did not complete",
            ),
        )
        .finally(() => turn.controller.signal.removeEventListener("abort", abort));
      record = { digest, controller, result };
      turn.calls.set(parsed.callId, record);
      if (turn.controller.signal.aborted) controller.abort();
    }
    const active = record;
    const disconnect = () => {
      if (!response.writableEnded) active.controller.abort();
    };
    response.once("close", disconnect);
    if (response.destroyed) active.controller.abort();
    try {
      send(response, 200, await active.result);
    } finally {
      response.removeListener("close", disconnect);
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("application tools server did not bind");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    openTurn(options): ApplicationToolTurn {
      if (closed || options.signal.aborted)
        throw new ToolRejectionError("CANCELLED", "chat turn is cancelled");
      if ([...turns.values()].some((turn) => turn.sessionId === options.sessionId))
        throw new Error("chat session is already registered");
      const token = randomBytes(32).toString("hex");
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal.addEventListener("abort", abort, { once: true });
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        markReady = resolve;
      });
      const state: TurnState = {
        sessionId: options.sessionId,
        caller: Object.freeze({ ...options.caller }),
        controller,
        ready,
        markReady,
        calls: new Map(),
        detach: () => options.signal.removeEventListener("abort", abort),
      };
      turns.set(token, state);
      return {
        env: { DSB_APP_TOOLS_URL: url, DSB_APP_TOOLS_TOKEN: token },
        waitReady(timeoutMs = 15_000): Promise<void> {
          return new Promise<void>((resolve, reject) => {
            const finish = (error?: ToolRejectionError) => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", cancel);
              if (error) reject(error);
              else resolve();
            };
            const cancel = () =>
              finish(new ToolRejectionError("CANCELLED", "chat turn is cancelled"));
            const timer = setTimeout(
              () =>
                finish(
                  new ToolRejectionError(
                    "RUNTIME_UNAVAILABLE",
                    "application tools plugin did not become ready",
                  ),
                ),
              timeoutMs,
            );
            controller.signal.addEventListener("abort", cancel, { once: true });
            void ready.then(() => finish());
            if (controller.signal.aborted) cancel();
          });
        },
        async close(): Promise<void> {
          controller.abort();
          state.detach();
          turns.delete(token);
          await Promise.allSettled([...state.calls.values()].map((call) => call.result));
          state.calls.clear();
        },
      };
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const active = [...turns.values()];
      for (const turn of active) {
        turn.controller.abort();
        turn.detach();
      }
      await Promise.allSettled(
        active.flatMap((turn) => [...turn.calls.values()].map((call) => call.result)),
      );
      turns.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
