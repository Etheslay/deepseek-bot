/**
 * Tool policy evaluator (D08, SECURITY_DATA.md §3).
 *
 * Pure decision logic over the pinned per-bot policy and workspace grants:
 * no I/O, no state. The gate canonicalizes paths first and passes the
 * canonical path here, so evaluations cannot be skewed by un-normalized
 * input. Least privilege: every disabled capability denies, every unlisted
 * resource denies, dangerous operations (file deletion, shell, network and
 * MCP per policy) require an explicit per-action approval.
 */
import type { ToolPolicy, Workspace } from "@deepseek-bot/contracts";
import {
  type PermissionDecision,
  type ToolActionKind,
  type ToolActionRequest,
} from "./actions.js";
import { isPathWithinScope } from "./paths.js";

export interface PolicyCheckInput {
  readonly policy: ToolPolicy;
  /** The bot's workspace; `undefined` denies all filesystem access. */
  readonly workspace: Workspace | undefined;
  /**
   * Canonical run artifact directory; granted read/write when filesystem
   * access is enabled at all (SECURITY_DATA §1: 产物目录).
   */
  readonly artifactsRoot: string | undefined;
}

export type FileOperation = "read" | "write";

const FILE_OPERATION_BY_KIND: Partial<Record<ToolActionKind, FileOperation>> = {
  "file.read": "read",
  "file.list": "read",
  "file.write": "write",
  "file.delete": "write",
};

/** Exact resource string used for events, approvals and the action digest. */
export function toolActionResource(
  action: ToolActionRequest,
  canonicalPath: string | undefined,
): string {
  switch (action.kind) {
    case "file.read":
    case "file.list":
    case "file.write":
    case "file.delete":
      return canonicalPath ?? action.path ?? "";
    case "shell.exec":
      return action.command ?? "";
    case "network.request":
      return action.url ?? "";
    case "mcp.call":
      return `mcp://${action.mcpServerId ?? ""}/${action.mcpToolName ?? ""}`;
  }
}

function deny(
  code: "UNAUTHORIZED_PATH" | "INVALID_INPUT",
  message: string,
  resource: string,
): PermissionDecision {
  return { effect: "deny", code, message, resource };
}

export function evaluateToolAction(
  action: ToolActionRequest,
  canonicalPath: string | undefined,
  input: PolicyCheckInput,
): PermissionDecision {
  switch (action.kind) {
    case "file.read":
    case "file.list":
    case "file.write":
    case "file.delete":
      return evaluateFileAction(action.kind, canonicalPath, input);
    case "shell.exec":
      return evaluateShellAction(action, input.policy);
    case "network.request":
      return evaluateNetworkAction(action, input.policy);
    case "mcp.call":
      return evaluateMcpAction(action, input.policy);
  }
}

function evaluateFileAction(
  kind: ToolActionKind,
  canonicalPath: string | undefined,
  input: PolicyCheckInput,
): PermissionDecision {
  const resource = canonicalPath ?? "";
  if (canonicalPath === undefined) {
    return deny("INVALID_INPUT", "file action requires a path", resource);
  }
  const { policy, workspace, artifactsRoot } = input;
  if (!policy.filesystem.enabled) {
    return deny(
      "UNAUTHORIZED_PATH",
      "filesystem tools are disabled for this bot",
      resource,
    );
  }
  const operation = FILE_OPERATION_BY_KIND[kind];
  if (operation === undefined) {
    return deny("INVALID_INPUT", `unknown file action kind: ${kind}`, resource);
  }
  // Both layers must allow: the policy caps the bot's file operations, the
  // workspace grant caps paths and operations (least privilege).
  if (!policy.filesystem.operations.includes(operation)) {
    return deny(
      "UNAUTHORIZED_PATH",
      `file ${operation} operations are not allowed by the tool policy`,
      resource,
    );
  }
  const artifactGranted =
    artifactsRoot !== undefined &&
    isPathWithinScope(canonicalPath, artifactsRoot);
  const workspaceGranted =
    workspace !== undefined &&
    workspace.grants.some(
      (grant) =>
        grant.operations.includes(operation) &&
        isPathWithinScope(canonicalPath, grant.scopePath),
    );
  if (!artifactGranted && !workspaceGranted) {
    return deny(
      "UNAUTHORIZED_PATH",
      `path is outside the authorized ${operation} scopes`,
      resource,
    );
  }
  // Deletion is never silent: a granted write scope only makes it askable.
  if (kind === "file.delete") {
    return {
      effect: "approval-required",
      reason: "file deletion requires explicit approval",
      resource,
    };
  }
  return { effect: "allow", resource };
}

function evaluateShellAction(
  action: ToolActionRequest,
  policy: ToolPolicy,
): PermissionDecision {
  const resource = action.command ?? "";
  if (policy.shell.mode === "disabled") {
    return deny("UNAUTHORIZED_PATH", "shell execution is disabled for this bot", resource);
  }
  if (action.command === undefined || action.command === "") {
    return deny("INVALID_INPUT", "shell action requires a command", resource);
  }
  // v0.1 has no unattended shell mode: approval-required is the only
  // non-disabled state the policy schema can express.
  return {
    effect: "approval-required",
    reason: "shell execution requires explicit approval",
    resource,
  };
}

function evaluateNetworkAction(
  action: ToolActionRequest,
  policy: ToolPolicy,
): PermissionDecision {
  const resource = action.url ?? "";
  if (policy.network.mode === "disabled") {
    return deny("UNAUTHORIZED_PATH", "network access is disabled for this bot", resource);
  }
  if (action.url === undefined || action.url === "") {
    return deny("INVALID_INPUT", "network action requires a URL", resource);
  }
  if (policy.network.mode === "approval-required") {
    return {
      effect: "approval-required",
      reason: "network requests require explicit approval",
      resource,
    };
  }
  return { effect: "allow", resource };
}

function evaluateMcpAction(
  action: ToolActionRequest,
  policy: ToolPolicy,
): PermissionDecision {
  const resource = `mcp://${action.mcpServerId ?? ""}/${action.mcpToolName ?? ""}`;
  if (!policy.mcp.enabled) {
    return deny("UNAUTHORIZED_PATH", "MCP tools are disabled for this bot", resource);
  }
  if (action.mcpServerId === undefined || action.mcpToolName === undefined) {
    return deny("INVALID_INPUT", "MCP action requires serverId and tool name", resource);
  }
  const grant = policy.mcp.servers.find(
    (server) => server.serverId === action.mcpServerId,
  );
  if (grant === undefined) {
    return deny(
      "UNAUTHORIZED_PATH",
      `MCP server '${action.mcpServerId}' is not authorized`,
      resource,
    );
  }
  if (!grant.allowedTools.includes(action.mcpToolName)) {
    return deny(
      "UNAUTHORIZED_PATH",
      `MCP tool '${action.mcpToolName}' is not authorized for server '${action.mcpServerId}'`,
      resource,
    );
  }
  if (policy.mcp.requireApproval) {
    return {
      effect: "approval-required",
      reason: "MCP tool calls require explicit approval",
      resource,
    };
  }
  return { effect: "allow", resource };
}
