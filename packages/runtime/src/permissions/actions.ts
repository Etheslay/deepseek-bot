/**
 * Tool action requests and permission decisions (D08, ARCHITECTURE.md §3).
 *
 * The future Harness adapter describes every tool action through
 * `ToolActionRequest` before any side effect; the permission gate answers
 * with allow / deny / approval-required. `actionDigest` covers the action
 * kind, the exact canonical resource and the full arguments (stable JSON),
 * so an approval is bound to one precise action (CONTRACTS §2 Approval,
 * FR-06: 展示精确参数).
 *
 * Denials reuse the frozen v0.1 error codes: `UNAUTHORIZED_PATH` for any
 * unauthorized resource (paths, MCP servers/tools, network targets) and
 * `INVALID_INPUT` for structurally invalid actions.
 */
import { createHash } from "node:crypto";

export const TOOL_ACTION_KINDS = [
  "file.read",
  "file.list",
  "file.write",
  "file.delete",
  "shell.exec",
  "network.request",
  "mcp.call",
] as const;
export type ToolActionKind = (typeof TOOL_ACTION_KINDS)[number];

export interface ToolActionRequest {
  readonly kind: ToolActionKind;
  /** Harness call identifier; carried into `tool.requested` for correlation. */
  readonly callId: string;
  readonly toolName: string;
  /** Absolute target path (file.* actions); canonicalized before checks. */
  readonly path?: string;
  /** Exact command line (shell.exec). */
  readonly command?: string;
  /** Outbound URL (network.request). */
  readonly url?: string;
  /** Authorized MCP server identity (mcp.call). */
  readonly mcpServerId?: string;
  /** MCP tool name inside the server (mcp.call). */
  readonly mcpToolName?: string;
  /** Full tool arguments; hashed into the action digest, never executed. */
  readonly arguments?: unknown;
}

export type PermissionDecision =
  | { readonly effect: "allow"; readonly resource: string }
  | {
      readonly effect: "deny";
      readonly code: "UNAUTHORIZED_PATH" | "INVALID_INPUT";
      readonly message: string;
      readonly resource: string;
    }
  | {
      readonly effect: "approval-required";
      readonly reason: string;
      readonly resource: string;
    };

/** A gate-authorized action: policy allowed it, or an approval was consumed. */
export interface AuthorizedAction {
  /** Null when the policy allowed the action without an approval. */
  readonly approvalId: string | null;
  readonly actionDigest: string;
  readonly resource: string;
}

/**
 * Deterministic JSON with recursively sorted object keys, so the same
 * arguments always produce the same digest regardless of key insertion
 * order. Arrays keep their order (parameter order is significant).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

/** Digest input describing one exact action (CONTRACTS §2: 完整参数摘要哈希). */
export interface ActionDigestInput {
  readonly runId: string;
  readonly nodeRunId: string;
  readonly kind: ToolActionKind;
  readonly toolName: string;
  /** Canonical resource: canonical path, URL, command or MCP identity. */
  readonly resource: string;
  readonly args: unknown;
}

export function computeActionDigest(input: ActionDigestInput): string {
  return createHash("sha256")
    .update(
      stableStringify({
        runId: input.runId,
        nodeRunId: input.nodeRunId,
        kind: input.kind,
        toolName: input.toolName,
        resource: input.resource,
        arguments: input.args ?? null,
      }),
    )
    .digest("hex");
}
