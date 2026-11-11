/** Human control plane for application tools. No control method is a model tool. */
import { createHash, randomUUID } from "node:crypto";
import { stableStringify } from "@deepseek-bot/runtime";
import {
  type AppApproval,
  type CapabilityId,
  type PermissionDecisionRequest,
  UuidSchema,
} from "@deepseek-bot/contracts";
import {
  ToolRejectionError,
  type GrantCheckpoint,
  type GrantCheckResult,
  type ToolCaller,
  type ToolCallOptions,
} from "@deepseek-bot/agent-tools";
import {
  authorizePermissionCall,
  cancelPermissionApproval,
  cancelUnaskedDispatchApprovals,
  decidePermissionApproval,
  expirePermissionState,
  releaseApprovalsCoveredByPolicy,
  requestPermissionApproval,
  revalidatePermissionAuthorization,
  getPermissionApproval,
  type OpenedDatabase,
  type PermissionAuthorization,
  type PermissionCall,
} from "@deepseek-bot/storage";

const APPROVAL_TTL = 10 * 60_000;
const CAPABILITIES: Readonly<Record<string, readonly CapabilityId[]>> = {
  list_bots: ["app.read"],
  list_groups: ["app.read"],
  get_run: ["app.read"],
  get_run_events: ["app.read"],
  create_bot_draft: ["app.read"],
  create_group: ["app.create_group"],
  create_bots_batch: ["app.create_bot"],
  revoke_batch: ["app.revoke_creation"],
  ask_user: ["interaction.ask_user"],
  web_search: ["network.search"],
  memory_search: ["memory.read"],
  memory_write: ["memory.write"],
  knowledge_search: ["memory.read"],
  // v0.7 manager orchestration: workflow creation rides the existing
  // app.create_workflow capability; dispatching gets its own capability
  // (default allow — bots may message each other; see PERMISSIONS.md);
  // list_tasks is read-only (app.read, allow by default).
  save_workflow: ["app.create_workflow"],
  dispatch_task: ["app.dispatch_task"],
  list_tasks: ["app.read"],
  learn_skill: ["app.learn_skill"],
  list_skills: ["app.learn_skill"],
  schedule_message: ["app.schedule_message"],
  list_message_schedules: ["app.schedule_message"],
  cancel_message_schedule: ["app.schedule_message"],
  connector_invoke: ["connector.invoke"],
  mcp_call: ["mcp.call"],
  screen_capture: ["screen.capture"],
  device_action: ["device.action"],
  device_input: ["device.action"],
  // D26 closure: chat attachment reads ride the same D08/D16 checkpoint as
  // native filesystem reads; policy defaults to allow, audit records the path.
  read_workspace_file: ["fs.read"],
  write_document: ["fs.write"],
  edit_document: ["fs.write"],
  find_github_skill: ["network.search"],
  write_presentation: ["fs.write"],
  // D26 gateway: importing a chat attachment writes the bot workspace;
  // reading it back is the model `read` tool. Both default to allow.
  import_attachment: ["fs.write"],
  read: ["fs.read"],
  // G3: native harness tool calls inside a chat turn gate on the same
  // fs/exec capabilities; delete rides fs.write (destructive filesystem).
  fs_read: ["fs.read"],
  fs_write: ["fs.write"],
  fs_delete: ["fs.write"],
  exec_shell: ["exec.shell"],
};

/** Capability ids a gateway tool consumes. Unknown tools return undefined (fail closed). */
export function capabilitiesConsumedBy(
  tool: string,
  params: unknown,
): readonly CapabilityId[] | undefined {
  if (tool === "edit_document") {
    const action =
      params !== null && typeof params === "object" && !Array.isArray(params)
        ? (params as { action?: unknown }).action
        : undefined;
    return [action === "read" ? "fs.read" : "fs.write"];
  }
  const mapped = Object.hasOwn(CAPABILITIES, tool) ? CAPABILITIES[tool] : undefined;
  if (mapped === undefined) return undefined;
  const capabilities = [...mapped];
  if (
    tool === "create_bots_batch" &&
    params !== null &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    "newGroup" in params &&
    (params as { newGroup?: unknown }).newGroup !== undefined
  ) {
    capabilities.push("app.create_group");
  }
  return capabilities;
}

function digest(call: Omit<PermissionCall, "actionDigest">): string {
  return createHash("sha256").update(stableStringify(call)).digest("hex");
}
interface Waiter {
  finish(result: GrantCheckResult): void;
  authorize(authorization: PermissionAuthorization): void;
}

export class AgentPermissionService implements GrantCheckpoint {
  private readonly waiters = new Map<string, Waiter>();
  private closed = false;

  constructor(
    private readonly db: OpenedDatabase,
    readonly generation: number,
  ) {
    expirePermissionState(db, generation);
  }

  async check(
    tool: string,
    caller: ToolCaller,
    params: unknown,
    options: ToolCallOptions,
  ): Promise<GrantCheckResult> {
    if (this.closed)
      return { allowed: false, code: "RUNTIME_UNAVAILABLE", reason: "permission host is closed" };
    if (options.signal?.aborted)
      return { allowed: false, code: "CANCELLED", reason: "tool call was cancelled" };
    this.releaseUnaskedDispatch();
    const mapped = capabilitiesConsumedBy(tool, params);
    if (
      mapped === undefined ||
      typeof caller.id !== "string" ||
      caller.id.length === 0 ||
      caller.id.length > 200 ||
      (caller.botId !== undefined && !UuidSchema.safeParse(caller.botId).success) ||
      (caller.sessionId !== undefined &&
        (typeof caller.sessionId !== "string" ||
          caller.sessionId.length === 0 ||
          caller.sessionId.length > 200))
    ) {
      return {
        allowed: false,
        code: "UNAUTHORIZED_PATH",
        reason: "trusted tool principal or capability is invalid",
        decision: "denied",
      };
    }
    const capabilities = [...mapped];
    const validatedParams = structuredClone(params) as Record<string, unknown>;
    const base = {
      invocationId: randomUUID(),
      callerId: caller.id,
      botId: caller.botId ?? null,
      sessionId: caller.sessionId ?? null,
      tool,
      capabilities,
      params: validatedParams,
      generation: this.generation,
    };
    const call: PermissionCall = { ...base, actionDigest: digest(base) };
    const authorization = authorizePermissionCall(this.db, call);
    if (authorization.allowed) return this.ticket(call, authorization, params);
    if (authorization.code !== "APPROVAL_REQUIRED") return this.denied(authorization);
    const approval = requestPermissionApproval(
      this.db,
      call,
      new Date(this.db.now().getTime() + APPROVAL_TTL).toISOString(),
    );
    return new Promise<GrantCheckResult>((resolve) => {
      const finish = (result: GrantCheckResult) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        this.waiters.delete(approval.id);
        resolve(result);
      };
      const cancel = (expired: boolean) => {
        try {
          cancelPermissionApproval(
            this.db,
            approval.id,
            expired ? "expired" : "cancelled",
            this.generation,
          );
        } catch {
          finish({
            allowed: false,
            code: "RUNTIME_UNAVAILABLE",
            reason: "permission cancellation could not be persisted",
            capabilities,
            approvalId: approval.id,
            decision: "denied",
          });
          return;
        }
        finish({
          allowed: false,
          code: expired ? "APPROVAL_EXPIRED" : "CANCELLED",
          reason: expired ? "permission approval expired" : "tool call was cancelled",
          capabilities,
          approvalId: approval.id,
          decision: "denied",
        });
      };
      const timer = setTimeout(() => cancel(true), APPROVAL_TTL);
      const abort = () => cancel(false);
      this.waiters.set(approval.id, {
        finish,
        authorize: (authorized) => finish(this.ticket(call, authorized, params)),
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }

  /**
   * A leftover ask that only covers bot-to-bot messaging is not a human
   * permission. Cancel it and release the waiter so the chat never shows a
   * card or a status line for a capability this request did not need.
   */
  releaseUnaskedDispatch(): void {
    let cancelled: AppApproval[] = [];
    try {
      cancelled = cancelUnaskedDispatchApprovals(this.db, this.generation);
    } catch {
      return;
    }
    for (const approval of cancelled) {
      this.waiters.get(approval.id)?.finish({
        allowed: false,
        code: "INVALID_INPUT",
        reason: "messaging another bot was not part of this request",
        capabilities: approval.capabilities,
        approvalId: approval.id,
        decision: "denied",
      });
    }
  }

  decide(request: PermissionDecisionRequest) {
    // A failed cancellation write may leave a durable pending row, but its
    // abandoned invocation must never mint grants through a late decision.
    if (!this.waiters.has(request.approvalId))
      throw new ToolRejectionError(
        "INVALID_INPUT",
        "permission approval is not awaiting a decision",
      );
    let result: ReturnType<typeof decidePermissionApproval>;
    try {
      result = decidePermissionApproval(this.db, request, this.generation);
    } catch (error) {
      if (getPermissionApproval(this.db, request.approvalId)?.status === "expired") {
        this.waiters.get(request.approvalId)?.finish({
          allowed: false,
          code: "APPROVAL_EXPIRED",
          reason: "permission approval expired",
          approvalId: request.approvalId,
          decision: "denied",
        });
      }
      throw error;
    }
    const waiter = this.waiters.get(request.approvalId);
    if (result.authorization !== undefined && result.call !== undefined) {
      waiter?.authorize(result.authorization);
    } else {
      waiter?.finish({
        allowed: false,
        code: "UNAUTHORIZED_PATH",
        reason: "human denied tool authorization",
        capabilities: result.approval.capabilities,
        approvalId: result.approval.id,
        decision: "denied",
      });
    }
    return { approval: result.approval, grants: result.grants };
  }

  /**
   * A new allow policy covers later calls by itself. Calls already waiting
   * on a card are released when every capability on that card is now allowed,
   * so the person is not asked again for the action they just switched off.
   */
  allowCapability(capability: CapabilityId): void {
    let released: ReturnType<typeof releaseApprovalsCoveredByPolicy> = [];
    try {
      released = releaseApprovalsCoveredByPolicy(this.db, capability, this.generation);
    } catch {
      return;
    }
    for (const item of released) {
      this.waiters.get(item.approval.id)?.authorize(item.authorization);
    }
  }

  /** A new deny policy takes effect on waiting calls immediately. */
  denyCapability(capability: CapabilityId): void {
    for (const [id, waiter] of this.waiters) {
      const approval = getPermissionApproval(this.db, id);
      if (approval?.capabilities.includes(capability)) {
        try {
          cancelPermissionApproval(this.db, id, "cancelled", this.generation);
        } catch {
          // Deny is already durable. Release the waiter even if cancelling
          // its preview row cannot be persisted; decide rejects absent waits.
        }
        waiter.finish({
          allowed: false,
          code: "UNAUTHORIZED_PATH",
          reason: "capability policy denies this action",
          capabilities: approval.capabilities,
          approvalId: id,
          decision: "denied",
        });
      }
    }
  }

  cancelMcp(filter: { connectorId?: string; botId?: string }): void {
    for (const [id, waiter] of this.waiters) {
      const approval = getPermissionApproval(this.db, id);
      if (approval?.tool !== "mcp_call" ||
          (filter.connectorId !== undefined && approval.params.connectorId !== filter.connectorId) ||
          (filter.botId !== undefined && approval.botId !== filter.botId)) continue;
      try { cancelPermissionApproval(this.db, id, "cancelled", this.generation); }
      finally { waiter.finish({ allowed: false, code: "CANCELLED", reason: "MCP authorization changed", approvalId: id, decision: "denied" }); }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, waiter] of this.waiters) {
      try {
        cancelPermissionApproval(this.db, id, "cancelled", this.generation);
      } catch {
        // Memory cleanup cannot depend on a writable database. On restart,
        // generation invalidates any row that could not be cancelled here.
      }
      waiter.finish({
        allowed: false,
        code: "RUNTIME_UNAVAILABLE",
        reason: "permission host is closed",
        approvalId: id,
        decision: "denied",
      });
    }
  }

  private denied(authorization: PermissionAuthorization): GrantCheckResult {
    return {
      allowed: false,
      code: authorization.code === "APPROVAL_REQUIRED" ? "APPROVAL_REQUIRED" : "UNAUTHORIZED_PATH",
      reason: authorization.reason ?? "tool authorization denied",
      capabilities: authorization.capabilities,
      grantIds: authorization.grantIds,
      decision: "denied",
    };
  }

  private ticket(
    call: PermissionCall,
    authorization: PermissionAuthorization,
    params: unknown,
  ): GrantCheckResult {
    return {
      allowed: true,
      capabilities: authorization.capabilities,
      grantIds: authorization.grantIds,
      ...(authorization.approvalId !== undefined ? { approvalId: authorization.approvalId } : {}),
      decision:
        authorization.approvalId !== undefined
          ? "approval"
          : authorization.grantIds.length > 0
            ? "grant"
            : "policy",
      revalidate: () => {
        if (this.closed)
          throw new ToolRejectionError("RUNTIME_UNAVAILABLE", "permission host is closed");
        const { actionDigest: _digest, ...base } = call;
        if (digest({ ...base, params: params as Record<string, unknown> }) !== call.actionDigest)
          throw new ToolRejectionError("UNAUTHORIZED_PATH", "authorized parameters changed");
        try {
          revalidatePermissionAuthorization(this.db, call, authorization);
        } catch {
          throw new ToolRejectionError(
            "UNAUTHORIZED_PATH",
            "tool authorization is no longer valid",
          );
        }
      },
    };
  }
}
