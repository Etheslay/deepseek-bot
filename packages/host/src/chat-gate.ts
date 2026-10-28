/**
 * G3: D08 gate for native harness tools inside a chat turn.
 *
 * The approval bridge resolves an incoming ask to a
 * `NodePermissionHandle.authorize(action)`; workflow nodes use the engine's
 * run-scoped gate. Chat turns have no run, so this adapter routes the same
 * closed D08 action vocabulary through the D16 permission host instead: the
 * policy layer decides allow/deny, `ask` mints a durable AppApproval (the
 * same card surface the eight application tools use, 10-minute TTL, one
 * decision) and the call resolves when the decision lands. Network stays on
 * the chat D08 network handle and native MCP tools gate on the `mcp.call`
 * capability; anything unmapped fails closed.
 *
 * The harness decides which of its own tool calls raise an ask; this gate
 * never invites one. Unrecognized actions are rejected by the bridge before
 * the gate is consulted.
 */
import {
  NodeExecutionError,
  computeActionDigest,
  type AuthorizedAction,
  type PermissionDecision,
  type ToolActionRequest,
} from "@deepseek-bot/runtime";
import type { ToolCaller } from "@deepseek-bot/agent-tools";
import type { AgentPermissionService } from "./agent-permissions.js";

export interface ChatGateWiring {
  readonly permissions: AgentPermissionService;
  /**
   * The chat D08 network policy seam (`chatNetworkPermissions`): resolves on
   * allow, throws a classified error on deny, fails closed on
   * approval-required (a chat turn has no workflow approval surface for it).
   */
  readonly network: (
    caller: ToolCaller,
    action: ToolActionRequest,
  ) => Promise<{ approvalId: string | null; resource: string }>;
  readonly botId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}

export class ChatNativeGate {
  readonly caller: ToolCaller;

  constructor(private readonly options: ChatGateWiring) {
    this.caller = {
      id: `chat-native:${options.sessionId}`,
      botId: options.botId,
      sessionId: options.sessionId,
    };
  }

  async evaluate(action: ToolActionRequest): Promise<PermissionDecision> {
    // Non-blocking preview: the bridge only calls authorize; this preview
    // grants nothing and never mints an approval.
    return {
      effect: "approval-required",
      reason: "chat native tool actions are authorized through authorize()",
      resource: resourceOf(action),
    };
  }

  async authorize(action: ToolActionRequest): Promise<AuthorizedAction> {
    switch (action.kind) {
      case "file.read":
      case "file.list":
        return this.checkCapability("fs_read", pathParams(action), action);
      case "file.write":
      case "file.delete":
        return this.checkCapability("fs_write", pathParams(action), action);
      case "shell.exec":
        return this.checkCapability(
          "exec_shell",
          commandParams(action),
          action,
        );
      case "network.request":
        return this.options.network(this.caller, action);
      case "mcp.call":
        return this.checkCapability(
          "mcp_call",
          {
            serverId: action.mcpServerId ?? "",
            ...(action.mcpToolName !== undefined ? { toolName: action.mcpToolName } : {}),
          },
          action,
        );
    }
  }

  private async checkCapability(
    tool: string,
    params: Record<string, unknown>,
    action: ToolActionRequest,
  ): Promise<AuthorizedAction> {
    const result = await this.options.permissions.check(tool, this.caller, params, {
      signal: this.options.signal,
    });
    if (result.allowed) {
      return {
        approvalId: result.approvalId ?? null,
        actionDigest: computeActionDigest({
          runId: this.options.sessionId,
          nodeRunId: this.options.sessionId,
          kind: action.kind,
          toolName: action.toolName,
          resource: resourceOf(action),
          args: action.arguments,
        }),
        resource: resourceOf(action),
      };
    }
    throw new NodeExecutionError({
      code: result.code ?? "UNAUTHORIZED_PATH",
      message: result.reason ?? "chat native tool was not authorized",
      retryable: false,
    });
  }
}

function pathParams(action: ToolActionRequest): Record<string, unknown> {
  return {
    ...(action.path !== undefined ? { path: action.path } : {}),
    toolName: action.toolName,
  };
}

function commandParams(action: ToolActionRequest): Record<string, unknown> {
  return {
    ...(action.command !== undefined ? { command: action.command } : {}),
    toolName: action.toolName,
  };
}

function resourceOf(action: ToolActionRequest): string {
  switch (action.kind) {
    case "file.read":
    case "file.list":
    case "file.write":
    case "file.delete":
      return action.path ?? "";
    case "shell.exec":
      return action.command ?? "";
    case "network.request":
      return action.url ?? "";
    case "mcp.call":
      return action.mcpToolName === undefined
        ? action.mcpServerId ?? ""
        : `${action.mcpServerId}/${action.mcpToolName}`;
  }
}
