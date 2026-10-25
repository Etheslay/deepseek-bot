/**
 * Per-node-run tool permission gate (D08, ARCHITECTURE.md §3).
 *
 * Every tool action passes through `authorize` BEFORE its side effect:
 * exact-parameters `tool.requested` event → policy check → allow, deny
 * (`NodeExecutionError` with a stable code) or a one-time approval whose
 * digest binds it to this precise action. After an approval the gate
 * re-validates the policy and run state and consumes the approval exactly
 * once (FR-06; QA-07).
 *
 * Approvals are stamped with the host boot generation; a decision or
 * consume for a foreign generation is rejected by the storage layer, so
 * approvals cannot be replayed across a host restart. Waiting is
 * coordinated with the run execution via `beginApprovalWait` /
 * `endApprovalWait` / the waiter registry.
 */
import { randomUUID } from "node:crypto";
import {
  isWithinMessageSizeLimit,
  type ToolPolicy,
  type Workspace,
} from "@deepseek-bot/contracts";
import {
  consumeApproval,
  createApproval,
  getApproval,
  markApprovalExpired,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { NodeExecutionError } from "../executor.js";
import { RunEventEmitter } from "../run-events.js";
import {
  computeActionDigest,
  type AuthorizedAction,
  type PermissionDecision,
  type ToolActionRequest,
} from "./actions.js";
import {
  canonicalizeScopePath,
  canonicalizeToolPath,
  InvalidToolPathError,
} from "./paths.js";
import {
  evaluateToolAction,
  toolActionResource,
  type PolicyCheckInput,
} from "./policy.js";

type WaitOutcome =
  | { readonly kind: "approved" }
  | { readonly kind: "denied" }
  | { readonly kind: "expired" }
  | { readonly kind: "cancelled" };

export interface NodeToolGateOptions {
  readonly db: OpenedDatabase;
  readonly events: RunEventEmitter;
  readonly runId: string;
  readonly nodeRunId: string;
  readonly policy: ToolPolicy;
  readonly workspace: Workspace | undefined;
  readonly artifactsRoot: string | undefined;
  readonly bootGeneration: number;
  readonly approvalTtlMs: number;
  readonly now: () => Date;
  /** False once the run is cancelling or finished. */
  readonly isRunActive: () => boolean;
  /** Run-execution owned flip running → waiting_approval; false if impossible. */
  readonly beginApprovalWait: (nodeRunId: string, reason: string) => boolean;
  /** Run-execution owned flip waiting_approval → running when still waiting. */
  readonly endApprovalWait: (nodeRunId: string, reason: string) => void;
  /** Registry used by the run execution to settle waits by approval id. */
  readonly registerWaiter: (approvalId: string, gate: NodeToolGate) => void;
  readonly unregisterWaiter: (approvalId: string) => void;
}

interface PendingWait {
  readonly timer: NodeJS.Timeout;
  readonly resolve: (outcome: WaitOutcome) => void;
}

function cancelledError(): NodeExecutionError {
  return new NodeExecutionError({
    code: "CANCELLED",
    message: "run is not active; tool action not executed",
    retryable: false,
  });
}

export class NodeToolGate {
  private readonly waits = new Map<string, PendingWait>();
  /** Serializes concurrent authorize calls of one node attempt. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Scope canonicalization is lazy and cached: grant scopes must go through
   * the same canonicalizeToolPath implementation as tool paths, or forms can
   * diverge (Windows 8.3 short names) and containment silently fails.
   */
  private scopesPromise: Promise<PolicyCheckInput> | undefined;

  constructor(private readonly options: NodeToolGateOptions) {}

  /** Non-blocking policy preview of an action (no events, no approvals). */
  async evaluate(action: ToolActionRequest): Promise<PermissionDecision> {
    try {
      const [canonicalPath, policyInput] = await Promise.all([
        this.canonicalizePath(action),
        this.policyInput(),
      ]);
      return evaluateToolAction(action, canonicalPath, policyInput);
    } catch (error) {
      return {
        effect: "deny",
        code: "INVALID_INPUT",
        message:
          error instanceof InvalidToolPathError
            ? error.message
            : `tool action could not be evaluated: ${String(error)}`,
        resource: "",
      };
    }
  }

  /**
   * Mandatory pre-execution gate. Resolves only for policy-allowed actions
   * or one-time-approved ones; every other path throws NodeExecutionError
   * and the action is not performed.
   */
  authorize(action: ToolActionRequest): Promise<AuthorizedAction> {
    const run = this.queue.then(
      () => this.authorizeInner(action),
      // A rejected predecessor must not poison the queue; each call is
      // independently guarded.
      () => this.authorizeInner(action),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async authorizeInner(action: ToolActionRequest): Promise<AuthorizedAction> {
    if (action.arguments !== undefined && !isWithinMessageSizeLimit({ arguments: action.arguments })) {
      throw new NodeExecutionError({
        code: "INVALID_INPUT",
        message: "tool arguments exceed the message size limit; pass artifact references instead",
        retryable: false,
      });
    }
    const [canonicalPath, policyInput] = await Promise.all([
      this.canonicalizeOrThrow(action),
      this.policyInput(),
    ]);
    const resource = toolActionResource(action, canonicalPath);
    this.options.events.emit("tool.requested", {
      nodeRunId: this.options.nodeRunId,
      callId: action.callId,
      toolName: action.toolName,
      arguments: action.arguments,
      resource,
    });
    const decision = evaluateToolAction(action, canonicalPath, policyInput);
    if (decision.effect === "allow") {
      return {
        approvalId: null,
        actionDigest: this.digest(action, resource),
        resource,
      };
    }
    if (decision.effect === "deny") {
      throw new NodeExecutionError({
        code: decision.code,
        message: decision.message,
        retryable: false,
      });
    }
    return this.requestApproval(action, canonicalPath, resource, policyInput, decision.reason);
  }

  private async requestApproval(
    action: ToolActionRequest,
    canonicalPath: string | undefined,
    resource: string,
    policyInput: PolicyCheckInput,
    reason: string,
  ): Promise<AuthorizedAction> {
    if (!this.options.isRunActive()) {
      throw cancelledError();
    }
    if (!this.options.beginApprovalWait(this.options.nodeRunId, reason)) {
      throw cancelledError();
    }
    const actionDigest = this.digest(action, resource);
    const expiresAt = new Date(
      this.options.now().getTime() + this.options.approvalTtlMs,
    ).toISOString();
    const approval = createApproval(
      this.options.db,
      {
        id: randomUUID(),
        runId: this.options.runId,
        nodeRunId: this.options.nodeRunId,
        actionDigest,
        resource,
        expiresAt,
        status: "pending",
      },
      { generation: this.options.bootGeneration },
    );
    this.options.events.emit("approval.requested", { approval });
    this.options.registerWaiter(approval.id, this);

    const outcome = await new Promise<WaitOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.onApprovalTtl(approval.id);
      }, this.options.approvalTtlMs);
      this.waits.set(approval.id, { timer, resolve });
    });

    switch (outcome.kind) {
      case "approved": {
        // Re-validate policy and run state, then consume exactly once
        // (ARCHITECTURE §3: 批准后必须再次校验参数、权限和运行状态).
        if (!this.options.isRunActive()) {
          // Cancellation owns the waiting node's terminal transition.
          throw cancelledError();
        }
        const recheck = evaluateToolAction(action, canonicalPath, policyInput);
        if (recheck.effect === "deny") {
          this.options.endApprovalWait(this.options.nodeRunId, "policy rejected after approval");
          throw new NodeExecutionError({
            code: recheck.code,
            message: `policy rejected the action after approval: ${recheck.message}`,
            retryable: false,
          });
        }
        try {
          consumeApproval(this.options.db, {
            id: approval.id,
            generation: this.options.bootGeneration,
          });
        } catch (error) {
          this.options.endApprovalWait(this.options.nodeRunId, "approved action could not be consumed");
          throw new NodeExecutionError({
            code: "APPROVAL_REQUIRED",
            message: `approved action could not be consumed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            retryable: false,
          });
        }
        this.options.endApprovalWait(this.options.nodeRunId, "tool approval granted");
        return { approvalId: approval.id, actionDigest, resource };
      }
      case "denied": {
        // Flip back to running so the executor's failure settles normally.
        this.options.endApprovalWait(this.options.nodeRunId, "tool approval denied");
        throw new NodeExecutionError({
          code: "APPROVAL_REQUIRED",
          message: "tool action denied by user",
          retryable: false,
        });
      }
      case "expired": {
        this.options.endApprovalWait(this.options.nodeRunId, "tool approval expired");
        throw new NodeExecutionError({
          code: "APPROVAL_EXPIRED",
          message: "tool approval validity window passed",
          retryable: false,
        });
      }
      case "cancelled": {
        // The run cancelled: node status is already terminal, nothing to flip.
        throw cancelledError();
      }
    }
  }

  /** Settle a pending wait (decision, expiry or cancellation). */
  settleWait(approvalId: string, outcome: WaitOutcome): boolean {
    const wait = this.waits.get(approvalId);
    if (wait === undefined) {
      return false;
    }
    this.waits.delete(approvalId);
    clearTimeout(wait.timer);
    this.options.unregisterWaiter(approvalId);
    wait.resolve(outcome);
    return true;
  }

  pendingApprovalIds(): string[] {
    return [...this.waits.keys()];
  }

  private onApprovalTtl(approvalId: string): void {
    if (!this.waits.has(approvalId)) {
      return;
    }
    const approval = getApproval(this.options.db, approvalId);
    if (approval === undefined || approval.status !== "pending") {
      // Decided meanwhile; the decide path settles the wait.
      return;
    }
    markApprovalExpired(this.options.db, { id: approvalId });
    this.options.events.emit("approval.resolved", {
      approvalId,
      decision: "expired",
      resolvedAt: this.options.now().toISOString(),
    });
    this.settleWait(approvalId, { kind: "expired" });
  }

  /**
   * Canonicalize the pinned scopes once per gate with the same function tool
   * paths use, so containment compares identical path forms. A scope that
   * cannot be canonicalized falls back to its normalized lexical form.
   */
  private policyInput(): Promise<PolicyCheckInput> {
    this.scopesPromise ??= this.canonicalizeScopes();
    return this.scopesPromise;
  }

  private async canonicalizeScopes(): Promise<PolicyCheckInput> {
    const { policy, workspace, artifactsRoot } = this.options;
    const canonicalWorkspace = workspace === undefined
      ? undefined
      : {
          ...workspace,
          canonicalPath: await canonicalizeScopePath(workspace.canonicalPath),
          grants: await Promise.all(
            workspace.grants.map(async (grant) => ({
              ...grant,
              scopePath: await canonicalizeScopePath(grant.scopePath),
            })),
          ),
        };
    const canonicalArtifactsRoot = artifactsRoot === undefined
      ? undefined
      : await canonicalizeScopePath(artifactsRoot);
    return {
      policy,
      workspace: canonicalWorkspace,
      artifactsRoot: canonicalArtifactsRoot,
    };
  }

  private digest(action: ToolActionRequest, resource: string): string {
    return computeActionDigest({
      runId: this.options.runId,
      nodeRunId: this.options.nodeRunId,
      kind: action.kind,
      toolName: action.toolName,
      resource,
      args: action.arguments,
    });
  }

  private async canonicalizePath(
    action: ToolActionRequest,
  ): Promise<string | undefined> {
    if (
      action.kind !== "file.read" &&
      action.kind !== "file.list" &&
      action.kind !== "file.write" &&
      action.kind !== "file.delete"
    ) {
      return undefined;
    }
    return canonicalizeToolPath(action.path ?? "");
  }

  private async canonicalizeOrThrow(
    action: ToolActionRequest,
  ): Promise<string | undefined> {
    try {
      return await this.canonicalizePath(action);
    } catch (error) {
      throw new NodeExecutionError({
        code: "INVALID_INPUT",
        message:
          error instanceof InvalidToolPathError
            ? error.message
            : `tool path could not be canonicalized: ${String(error)}`,
        retryable: false,
      });
    }
  }
}
