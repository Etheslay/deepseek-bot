/**
 * Loopback approval bridge server (D12, ARCHITECTURE §5).
 *
 * Receives upstream `approval/request` asks from the harness-mounted bridge
 * plugin and answers them through the engine-issued permission gate of the
 * attempt that owns the harness session (SessionRegistry). This is the
 * enforcement channel that makes every side-effecting harness tool call flow
 * through the D08 gate: the ask arrives before the tool executes, and the
 * bridge only returns after a policy allow or a consumed one-time approval.
 *
 * Transport rules (ARCHITECTURE §5): bound to 127.0.0.1 on a random port,
 * authenticated by a per-launch bearer token generated here; the harness
 * child receives both through its environment (DSB_BRIDGE_URL / DSB_BRIDGE_TOKEN).
 *
 * Failure semantics mirror the upstream seam: an unknown session, an unmapped
 * tool or a gate error never resolves to a grant — the plugin receives
 * `unavailable` or `rejected` and the tool denies.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import type { SessionGateResolver } from "./dsh-executor.js";
import { mapHarnessToolCall } from "./tool-mapping.js";
import { listenOnPrivateHttpPort } from "./loopback.js";

/** Outcome vocabulary of the upstream approval seam. */
export type BridgeOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

export interface ApprovalBridgeRequest {
  readonly sessionId?: string;
  readonly toolName?: string;
  readonly callId?: string;
  readonly arguments?: unknown;
  readonly recordedToolName?: unknown;
  readonly reason?: string;
}

export interface ApprovalBridgeDecision {
  readonly outcome: BridgeOutcome;
  readonly reason?: string;
}

export interface ApprovalBridgeServerOptions {
  /** Session registry shared with the executor (sessionId → permission gate). */
  readonly sessions: SessionGateResolver;
}

export interface RunningApprovalBridge {
  /** Loopback base URL for DSB_BRIDGE_URL. */
  readonly url: string;
  /** Per-launch bearer token for DSB_BRIDGE_TOKEN. */
  readonly token: string;
  /** Stop listening and drop pending round trips. */
  readonly close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

export function startApprovalBridgeServer(
  options: ApprovalBridgeServerOptions,
): Promise<RunningApprovalBridge> {
  const token = `dsb-${randomUUID()}`;
  const server = createServer((request, response) => {
    void handleRequest(request, response, options.sessions, token);
  });
  server.on("error", () => {
    // Handled per-request through socket errors below; nothing to do here.
  });

  return new Promise((resolve, reject) => {
    void listenOnPrivateHttpPort(server).then(() => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("approval bridge server did not bind a port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        token,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    }, reject);
  });
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers["authorization"];
  if (typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const received = Buffer.from(header, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function respond(response: ServerResponse, status: number, body: ApprovalBridgeDecision): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(undefined);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(undefined));
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sessions: SessionGateResolver,
  token: string,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/approval-requests") {
    respond(response, 404, { outcome: "unavailable", reason: "not found" });
    return;
  }
  if (!authorized(request, token)) {
    respond(response, 401, { outcome: "unavailable", reason: "unauthorized" });
    return;
  }
  const raw = await readBody(request);
  if (raw === undefined) {
    respond(response, 413, { outcome: "unavailable", reason: "payload too large" });
    return;
  }
  let parsed: ApprovalBridgeRequest;
  try {
    parsed = JSON.parse(raw) as ApprovalBridgeRequest;
  } catch {
    respond(response, 400, { outcome: "unavailable", reason: "malformed JSON" });
    return;
  }
  respond(response, 200, await decide(parsed, sessions));
}

/**
 * Evaluate one bridge ask. Long-holds while the engine waits for a one-time
 * approval decision; a client disconnect (run cancelled upstream) leaves the
 * pending approval to the engine's own cancellation/TTL handling.
 */
export async function decide(
  bridgeRequest: ApprovalBridgeRequest,
  sessions: SessionGateResolver,
): Promise<ApprovalBridgeDecision> {
  const { sessionId, toolName, callId } = bridgeRequest;
  if (typeof sessionId !== "string" || typeof toolName !== "string" || typeof callId !== "string") {
    return { outcome: "unavailable", reason: "ask is missing sessionId, toolName or callId" };
  }
  const registered = sessions(sessionId);
  if (registered === undefined) {
    return { outcome: "unavailable", reason: `no active attempt owns session '${sessionId}'` };
  }
  const action = mapHarnessToolCall({
    toolName,
    callId,
    arguments: bridgeRequest.arguments,
  });
  if (action === undefined) {
    // Least privilege: an unrecognized side-effect-capable tool never executes.
    return {
      outcome: "rejected",
      reason: `harness tool '${toolName}' is not mapped to a gate action`,
    };
  }
  try {
    await registered.permissions.authorize(action);
    return { outcome: "allowed-once" };
  } catch (error) {
    if (error instanceof NodeExecutionError) {
      return { outcome: "rejected", reason: `${error.code}: ${error.message}` };
    }
    return { outcome: "unavailable", reason: "gate evaluation failed unexpectedly" };
  }
}
