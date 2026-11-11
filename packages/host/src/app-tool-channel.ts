/** Private per-turn Harness -> Host application tools. Never a desktop contract. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { CapabilityId } from "@deepseek-bot/contracts";
import {
  ToolRejectionError,
  type ToolCaller,
  type ToolGateway,
  type ToolNetworkPermissions,
} from "@deepseek-bot/agent-tools";
import { stableStringify } from "@deepseek-bot/runtime";
import type { McpService, McpCatalogTool } from "./mcp.js";
import { capToolResultValue } from "./tool-result-cap.js";
import { listenOnPrivateHttpPort } from "@deepseek-bot/harness-adapter";

const APPLICATION_TOOLS = [
  "list_bots",
  "list_groups",
  "get_run",
  "get_run_events",
  "create_bot_draft",
  "create_group",
  "create_bots_batch",
  "revoke_batch",
  // v0.5 manager orchestration (keep in lockstep with
  // packages/harness-bridge/src/app-tools.ts APPLICATION_TOOL_NAMES).
  "save_workflow",
  "dispatch_task",
  "list_tasks",
  "learn_skill",
  "list_skills",
  "schedule_message",
  "list_message_schedules",
  "cancel_message_schedule",
  // D26: chat attachments land in the bot workspace; the bot reads them
  // back through this tool (keep in lockstep with the bridge list).
  "read_workspace_file",
  "write_document",
  "edit_document",
  "find_github_skill",
  "write_presentation",
] as const;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CALLS_PER_TURN = 1000;
/** One ask_user parks the turn on a human answer, so a model that asks in a
 * loop stalls the conversation; this is the ceiling the tool description promises. */
const MAX_ASK_USER_PER_TURN = 3;
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
  /** Successful ask_user dispatches this turn; replays of a counted call do not re-count. */
  askUserCalls: number;
  /** Present only when injected skills declared at least one capability. */
  skillCapabilities?: readonly CapabilityId[];
  /** False when this user message did not ask to hand work to another bot. */
  allowDispatch: boolean;
  mcpCatalog?: Promise<{ tools: McpCatalogTool[]; warnings: string[] }>;
  detach(): void;
}
export interface ApplicationToolTurn {
  readonly env: { DSB_APP_TOOLS_URL: string; DSB_APP_TOOLS_TOKEN: string };
  /** Resolve optional MCP services before spending the Harness initialization deadline. */
  prepare?(): Promise<void>;
  waitReady(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}
export interface ApplicationToolServer {
  readonly url: string;
  openTurn(options: {
    sessionId: string;
    caller: ToolCaller;
    signal: AbortSignal;
    skillCapabilities?: readonly CapabilityId[];
    /**
     * When false, dispatch_task is refused before authorization. Omitted
     * means the turn may dispatch (non-chat callers and explicit handoffs).
     */
    allowDispatch?: boolean;
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
  readonly mcp?: McpService;
  /** Empty unless this turn's bot is allowed to see screen_capture. */
  readonly screenCatalog?: (
    caller: ToolCaller,
  ) => ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

export async function startApplicationToolServer(
  gateway: ToolGateway,
  options: ApplicationToolChannelOptions = {},
): Promise<ApplicationToolServer> {
  const turns = new Map<string, TurnState>();
  const mcp = options.mcp;
  const schemas = gateway.capabilities.schemas(APPLICATION_TOOLS);
  const askUserSchema = gateway.capabilities.schemas(["ask_user"])[0];
  const webSearchSchema = gateway.capabilities.schemas(["web_search"])[0];
  const readSchema = gateway.capabilities.schemas(["read"])[0];
  const memorySchemas = gateway.capabilities.schemas([
    "memory_write",
    "memory_search",
    "knowledge_search",
  ]);
  const connectorSchemas = gateway.capabilities.schemas(["connector_invoke"]);
  let closed = false;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() =>
      send(response, 400, failure("INVALID_INPUT", "invalid application tool request")),
    );
  });
  server.requestTimeout = 12 * 60_000;
  server.timeout = 0;
  function mcpCatalog(turn: TurnState) {
    return (turn.mcpCatalog ??=
      mcp?.catalog(turn.caller, turn.controller.signal) ??
      Promise.resolve({ tools: [], warnings: [] }));
  }
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
    if (request.method === "GET" && request.url === "/read") {
      send(response, 200, { tool: readSchema });
      return;
    }
    if (request.method === "GET" && request.url === "/memory") {
      send(response, 200, { tools: memorySchemas });
      return;
    }
    if (request.method === "GET" && request.url === "/connectors") {
      send(response, 200, { tools: connectorSchemas });
      return;
    }
    if (request.method === "GET" && request.url === "/screen") {
      send(response, 200, { tools: options.screenCatalog?.(turn.caller) ?? [] });
      return;
    }
    if (request.method === "GET" && request.url === "/mcp") {
      const catalog = await mcpCatalog(turn);
      send(response, 200, {
        tools: catalog.tools.map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
        warnings: catalog.warnings,
      });
      return;
    }
    if (
      request.method !== "POST" ||
      (request.url !== "/app-tools/ready" &&
        request.url !== "/app-tools/call" &&
        request.url !== "/ask-user/call" &&
        request.url !== "/web-search/call" &&
        request.url !== "/read/call" &&
        request.url !== "/memory/call" &&
        request.url !== "/connectors/call" &&
        request.url !== "/screen/call" &&
        request.url !== "/mcp/call")
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
    const mcpEntry =
      request.url === "/mcp/call"
        ? (await mcpCatalog(turn)).tools.find((tool) => tool.name === parsed.tool)
        : undefined;
    const toolAllowed =
      request.url === "/ask-user/call"
        ? parsed.tool === "ask_user"
        : request.url === "/web-search/call"
          ? parsed.tool === "web_search"
          : request.url === "/read/call"
            ? parsed.tool === "read"
            : request.url === "/memory/call"
              ? parsed.tool === "memory_write" ||
                parsed.tool === "memory_search" ||
                parsed.tool === "knowledge_search"
              : request.url === "/mcp/call"
                ? true // Unknown aliases still enter gateway validation and audit.
                : request.url === "/connectors/call"
                  ? parsed.tool === "connector_invoke"
                  : request.url === "/screen/call"
                    ? parsed.tool === "screen_capture"
                    : (APPLICATION_TOOLS as readonly string[]).includes(parsed.tool);
    if (!toolAllowed) {
      send(response, 400, failure("INVALID_INPUT", "tool is not available in chat"));
      return;
    }
    // A deck or any other single-bot request must not raise "派发任务给其他
    // bot". Refuse before the gateway so no approval card is minted.
    if (parsed.tool === "dispatch_task" && !turn.allowDispatch) {
      send(
        response,
        200,
        failure(
          "INVALID_INPUT",
          "用户没有让你把这件事交给其他 bot。不要派发，也不要索要这个权限，用你自己的工具做完。",
        ),
      );
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
      if (request.url === "/ask-user/call" && turn.askUserCalls >= MAX_ASK_USER_PER_TURN) {
        send(response, 429, failure("RATE_LIMITED", "ask_user turn limit reached"));
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
          request.url === "/mcp/call" ? "mcp_call" : parsed.tool,
          request.url === "/mcp/call"
            ? { ...mcpEntry?.invocation, arguments: parsed.params }
            : parsed.params,
          {
            signal: controller.signal,
            ...(networkPermissions !== undefined ? { networkPermissions } : {}),
            ...(turn.skillCapabilities !== undefined
              ? { skillCapabilities: turn.skillCapabilities }
              : {}),
          },
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
      if (request.url === "/ask-user/call") turn.askUserCalls += 1;
      if (turn.controller.signal.aborted) controller.abort();
    }
    const active = record;
    const disconnect = () => {
      if (!response.writableEnded) active.controller.abort();
    };
    response.once("close", disconnect);
    if (response.destroyed) active.controller.abort();
    try {
      // Single-result cap: the bridge renders this value verbatim into the
      // harness prompt, so an oversized tool output is cut here (the raw data
      // stays wherever the tool persisted it).
      const outcome = await active.result;
      send(
        response,
        200,
        outcome.ok
          ? { ok: true, result: capToolResultValue(outcome.result).value }
          : outcome,
      );
    } finally {
      response.removeListener("close", disconnect);
    }
  }
  await listenOnPrivateHttpPort(server);
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
        askUserCalls: 0,
        ...(options.skillCapabilities !== undefined
          ? { skillCapabilities: Object.freeze([...options.skillCapabilities]) }
          : {}),
        allowDispatch: options.allowDispatch !== false,
        detach: () => options.signal.removeEventListener("abort", abort),
      };
      const releaseMcp = () => {
        void state.mcpCatalog
          ?.then((catalog) => mcp?.release(catalog.tools))
          .catch(() => undefined);
      };
      controller.signal.addEventListener("abort", releaseMcp, { once: true });
      turns.set(token, state);
      return {
        env: { DSB_APP_TOOLS_URL: url, DSB_APP_TOOLS_TOKEN: token },
        async prepare(): Promise<void> {
          await mcpCatalog(state);
        },
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
