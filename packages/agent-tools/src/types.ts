/**
 * Gateway core types (D15, AGENT_PLATFORM §2/§3).
 *
 * 模型只能通过工具网关产生副作用；网关之外没有任何"后门"写入路径。Every
 * dispatch flows: capability lookup → parameter schema → authorization →
 * revalidation → execute → audit. An absent checkpoint denies every call.
 */
import type { z } from "zod";
import type { CapabilityId, ErrorCode } from "@deepseek-bot/contracts";

/** Stable gateway rejection codes (CONTRACTS §6 vocabulary). */
export type GatewayRejectionCode = Extract<
  ErrorCode,
  "INVALID_INPUT" | "UNAUTHORIZED_PATH" | "APPROVAL_REQUIRED" | "APPROVAL_EXPIRED"
  | "CANCELLED" | "TOOL_TIMEOUT" | "RUNTIME_UNAVAILABLE" | "RATE_LIMITED"
>;

/** Who invoked the tool (audit "谁"). v0.1 callers: chat agents and the UI. */
export interface ToolCaller {
  /** e.g. "chat:<sessionId>/<botId>" or "ui:<windowId>" — opaque string. */
  readonly id: string;
  /** Bound by the trusted Host caller, never parsed from id or model params. */
  readonly botId?: string;
  readonly sessionId?: string;
}

/** Context handed to a capability handler after validation. */
export interface ToolContext {
  readonly caller: ToolCaller;
  readonly signal?: AbortSignal;
  readonly networkPermissions?: ToolNetworkPermissions;
  /**
   * Authorization references the checkpoint accepted for THIS call (D16),
   * when it minted or consumed an approval/grant. The v0.7 relay chain
   * stores them on the root task so later hops can revalidate without
   * re-prompting (TASK_MANAGER_ORCHESTRATION.md R-13.6).
   */
  readonly authorization?: {
    readonly approvalId?: string;
    readonly grantIds?: readonly string[];
  };
  /** Trusted lease recheck before a side effect after asynchronous preparation. */
  readonly revalidateAuthorization?: () => void;
}

export interface ToolCallOptions {
  readonly signal?: AbortSignal;
  /** Trusted in-process D08 handle; never accepted in model parameters. */
  readonly networkPermissions?: ToolNetworkPermissions;
}

/** Structurally compatible with D08 NodePermissionHandle, without a runtime dependency. */
export interface ToolNetworkPermissions {
  authorize(action: {
    readonly kind: "network.request";
    readonly callId: string;
    readonly toolName: string;
    readonly url: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
}

export class ToolRejectionError extends Error {
  readonly code: GatewayRejectionCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: GatewayRejectionCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolRejectionError";
    this.code = code;
    this.details = details;
  }
}

export interface ToolOutcome<T = unknown> {
  readonly ok: true;
  readonly result: T;
}

/** One registered capability. The input schema is the only accepted shape. */
export interface ToolCapability<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: S;
  readonly handler: (params: z.output<S>, context: ToolContext) => Promise<unknown> | unknown;
  /** Protocol-level failures may return useful content while still needing an error audit. */
  readonly resultFailed?: (result: unknown) => boolean;
}

export interface GrantCheckResult {
  readonly allowed: boolean;
  readonly code?: GatewayRejectionCode;
  readonly reason?: string;
  readonly capabilities?: readonly CapabilityId[];
  readonly grantIds?: readonly string[];
  readonly approvalId?: string;
  readonly decision?: "policy" | "grant" | "approval" | "denied";
  /** Synchronous lease check immediately before dispatch; no second use charge. */
  readonly revalidate?: () => void;
}

/** Host supplies the persistent D16 policy/grant/approval checkpoint. */
export interface GrantCheckpoint {
  check(tool: string, caller: ToolCaller, params: unknown, options: ToolCallOptions): Promise<GrantCheckResult>;
}

/** One audit record (谁/何时/调了什么/参数摘要/结果摘要). */
export interface AuditRecord {
  readonly timestamp: string;
  readonly caller: string;
  readonly tool: string;
  /** sha256 over the canonical params JSON. */
  readonly paramsDigest: string;
  /** sha256 over the canonical result JSON ("-" when rejected before execution). */
  readonly resultDigest: string;
  readonly outcome: "ok" | "rejected" | "error";
  readonly code?: GatewayRejectionCode | "RUNTIME_ERROR";
  readonly reason?: string;
  readonly botId?: string;
  readonly sessionId?: string;
  readonly capabilities?: readonly CapabilityId[];
  readonly grantIds?: readonly string[];
  readonly approvalId?: string;
  /** "chain" marks host-side relay-hop records (T7) that bypass the gateway. */
  readonly decision?: GrantCheckResult["decision"] | "chain";
}

export interface AuditSink {
  append(record: AuditRecord): void | Promise<void>;
}
