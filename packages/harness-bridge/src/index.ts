/**
 * Approval bridge plugin for the DeepSeek Harness profile (D12).
 *
 * Mounted inside the harness process through a profile patch row; answers the
 * upstream `approval/request` waterfall (@deepseek-ai/dsh-user-approval) by
 * forwarding the exact tool call to the app Host over loopback HTTP, where the
 * D08 permission gate evaluates it. Fail-closed end to end:
 *
 * - no bridge URL configured → no listener; the upstream chain resolves
 *   `unavailable` and the tool denies;
 * - HTTP failure or a non-2xx response → `unavailable`;
 * - request signal aborted (run cancelled upstream) → `cancelled`;
 * - any listener error is contained by the upstream service into
 *   `unavailable`, never a tool success.
 *
 * The full tool arguments never ride on the approval request itself — the
 * ask carries only toolName/callId/reason (upstream tools/src/index.ts
 * `serviceAsk`). Like the upstream service reads its policy, this bridge
 * walks the agent's durable session log backwards to the `tool/call` record
 * carrying the callId, which the agent loop appends before the permission
 * check, so the Host authorizes the exact parameters.
 *
 * Outcome vocabulary (upstream ApprovalOutcome): 'allowed-once' | 'rejected'
 * | 'cancelled' | 'unavailable'.
 */

/** Structural view of the pieces of the upstream agent this plugin touches. */
export interface BridgeSessionLike {
  readonly id?: unknown;
  readonly seq?: number;
  eventAt?(seq: number): { type: unknown; data?: unknown } | undefined;
}

export interface BridgeAgentLike {
  readonly session?: BridgeSessionLike;
}

export interface BridgeRequestLike {
  readonly agent?: BridgeAgentLike;
  readonly toolName?: unknown;
  readonly callId?: unknown;
  readonly reason?: unknown;
  readonly signal?: AbortSignal;
}

export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

/** Answerer signature: return an outcome to claim the request, or call next(). */
export type ApprovalAnswerer = (
  request: BridgeRequestLike,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>;

export interface ApprovalBridgeConfig {
  /** Loopback base URL of the Host's approval bridge server. */
  readonly bridgeUrl?: string;
  /** Per-launch bearer token for the bridge (defaults to DSB_BRIDGE_TOKEN). */
  readonly bridgeToken?: string;
  /** HTTP fetch implementation (tests inject a stub). */
  readonly fetchImpl?: typeof fetch;
  /** Bound on the bridge round trip; the upstream ask has its own lifetime. */
  readonly timeoutMs?: number;
}

/** Environment variables the Host sets on the harness child. */
export const BRIDGE_URL_ENV = "DSB_BRIDGE_URL";
export const BRIDGE_TOKEN_ENV = "DSB_BRIDGE_TOKEN";

/** Stable Cordis plugin name. */
export const name = "dsb-approval-bridge";

/** Scan bound so a pathological session log cannot stall the ask. */
const SESSION_SCAN_LIMIT = 2000;

/**
 * Read the recorded `tool/call` event for `callId` from the session log. The
 * agent loop appends it (with full arguments) before the permission check
 * runs, so a missing record means the ask is not bound to a durable call.
 */
export function readToolCallRecord(
  session: BridgeSessionLike | undefined,
  callId: string,
): { name?: unknown; arguments?: unknown } | undefined {
  if (session?.eventAt === undefined || typeof session.seq !== "number") {
    return undefined;
  }
  const start = session.seq - 1;
  const floor = Math.max(-1, start - SESSION_SCAN_LIMIT);
  for (let seq = start; seq > floor; seq -= 1) {
    const event = session.eventAt(seq);
    if (event === undefined) continue;
    if (event.type !== "tool/call") continue;
    const data = event.data as { callId?: unknown; name?: unknown; arguments?: unknown } | undefined;
    if (data?.callId === callId) {
      return { name: data.name, arguments: data.arguments };
    }
  }
  return undefined;
}

/**
 * Build the answerer for the `approval/request` waterfall. Without a bridge
 * URL there is no enforcement channel, so no listener is returned at all and
 * the upstream chain fails closed.
 */
export function createApprovalAnswerer(config: ApprovalBridgeConfig): ApprovalAnswerer | undefined {
  const url = config.bridgeUrl;
  if (url === undefined || url.length === 0) {
    return undefined;
  }
  const token = config.bridgeToken ?? globalThis.process?.env?.[BRIDGE_TOKEN_ENV];
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 600_000;

  return async (request, next) => {
    if (typeof request.callId !== "string" || request.callId.length === 0) {
      // Nothing to bind an exact-parameter decision to; let the chain fail
      // closed rather than authorize an unidentifiable action.
      return next();
    }
    const session = request.agent?.session;
    const sessionId = typeof session?.id === "string" ? session.id : undefined;
    const record = readToolCallRecord(session, request.callId);
    const body = {
      sessionId,
      toolName: request.toolName,
      callId: request.callId,
      ...(record !== undefined ? { recordedToolName: record.name, arguments: record.arguments } : {}),
      ...(typeof request.reason === "string" ? { reason: request.reason } : {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    if (request.signal !== undefined) {
      if (request.signal.aborted) return "cancelled";
      request.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const response = await doFetch(`${url.replace(/\/$/, "")}/approval-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token !== undefined && token.length > 0 ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        return "unavailable";
      }
      const payload = (await response.json()) as { outcome?: unknown };
      return payload.outcome === "allowed-once" ||
        payload.outcome === "rejected" ||
        payload.outcome === "cancelled"
        ? payload.outcome
        : "unavailable";
    } catch {
      if (request.signal?.aborted) return "cancelled";
      return "unavailable";
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Cordis plugin entry (upstream bundle shape: name + apply). Registers the
 * answerer when a bridge URL is available; no-op otherwise so a mount without
 * the Host environment stays fail-closed instead of erroring the profile.
 */
export function apply(ctx: { on(event: string, handler: unknown): void }, config: ApprovalBridgeConfig = {}): void {
  const bridgeUrl = config.bridgeUrl ?? globalThis.process?.env?.[BRIDGE_URL_ENV];
  const answerer = createApprovalAnswerer({
    ...config,
    ...(bridgeUrl !== undefined ? { bridgeUrl } : {}),
  });
  if (answerer === undefined) {
    return;
  }
  ctx.on("approval/request", answerer);
}
