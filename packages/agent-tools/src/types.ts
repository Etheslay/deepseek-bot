/**
 * Gateway core types (D15, AGENT_PLATFORM §2/§3).
 *
 * 模型只能通过工具网关产生副作用；网关之外没有任何"后门"写入路径。Every
 * dispatch flows: capability lookup → grant checkpoint → parameter schema →
 * execute → audit. The grant checkpoint is a D15 stub (read layer default
 * allow) with the D16 three-layer grant/审批 model as its caller.
 */
import type { z } from "zod";
import type { ErrorCode } from "@deepseek-bot/contracts";

/** Stable gateway rejection codes (CONTRACTS §6 vocabulary). */
export type GatewayRejectionCode = Extract<
  ErrorCode,
  "INVALID_INPUT" | "UNAUTHORIZED_PATH" | "APPROVAL_REQUIRED" | "APPROVAL_EXPIRED"
  | "CANCELLED" | "TOOL_TIMEOUT" | "RUNTIME_UNAVAILABLE"
>;

/** Who invoked the tool (audit "谁"). v0.1 callers: chat agents and the UI. */
export interface ToolCaller {
  /** e.g. "chat:<sessionId>/<botId>" or "ui:<windowId>" — opaque string. */
  readonly id: string;
}

/** Context handed to a capability handler after validation. */
export interface ToolContext {
  readonly caller: ToolCaller;
  readonly signal?: AbortSignal;
}

export interface ToolCallOptions {
  readonly signal?: AbortSignal;
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
}

/** Grant checkpoint (D15 stub): read layer default-allow; D16 layers here. */
export interface GrantCheckpoint {
  check(tool: string, caller: ToolCaller): Promise<{ allowed: boolean; reason?: string }>;
}

/** Default read-layer grant: everything registered is allowed (D15 阶段一). */
export class AllowAllGrants implements GrantCheckpoint {
  async check(): Promise<{ allowed: true }> {
    return { allowed: true };
  }
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
}

export interface AuditSink {
  append(record: AuditRecord): void | Promise<void>;
}
