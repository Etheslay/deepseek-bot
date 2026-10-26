/**
 * Capability registry + dispatch pipeline (D15 阶段一 read layer).
 *
 * Dispatch rejects before touching anything on: unknown capability,
 * denied grant, or schema-invalid parameters — each rejection is audited.
 * Successful calls audit params/result digests (full values never enter the
 * audit trail; digests + registered schema are the trace).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ToolRejectionError,
  type AuditRecord,
  type AuditSink,
  type GatewayRejectionCode,
  type GrantCheckpoint,
  type GrantCheckResult,
  type ToolCaller,
  type ToolCapability,
  type ToolContext,
  type ToolCallOptions,
} from "./types.js";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export class ToolRegistry {
  private readonly capabilities = new Map<string, ToolCapability>();

  register(capability: ToolCapability): void {
    if (this.capabilities.has(capability.name)) {
      throw new ToolRejectionError(
        "INVALID_INPUT",
        `capability already registered: ${capability.name}`,
      );
    }
    this.capabilities.set(capability.name, capability);
  }

  get size(): number {
    return this.capabilities.size;
  }

  get(name: string): ToolCapability | undefined {
    return this.capabilities.get(name);
  }

  list(): Array<{ name: string; description: string }> {
    return [...this.capabilities.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  /** Model-facing input schemas; validation still belongs to call(). */
  schemas(names: readonly string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return names.map((name) => {
      const capability = this.capabilities.get(name);
      if (capability === undefined) throw new Error("required application capability is missing");
      return {
        name,
        description: capability.description,
        parameters: z.toJSONSchema(capability.inputSchema, { io: "input", unrepresentable: "any" }),
      };
    });
  }
}

export interface ToolGatewayOptions {
  readonly registry: ToolRegistry;
  readonly audit: AuditSink;
  /** Missing checkpoint fails closed; the Host installs D16 authorization. */
  readonly grants?: GrantCheckpoint;
  /** Wall clock for audit timestamps (tests inject). */
  readonly now?: () => Date;
}

export class ToolGateway {
  constructor(private readonly options: ToolGatewayOptions) {}

  get capabilities(): ToolRegistry {
    return this.options.registry;
  }

  /**
   * Dispatch one tool call. Rejects with ToolRejectionError on unknown
   * capability, denied grant or invalid parameters; handler failures
   * propagate as-is after being audited as errors.
   */
  async call(
    caller: ToolCaller,
    tool: string,
    params: unknown,
    options: ToolCallOptions = {},
  ): Promise<unknown> {
    caller = Object.freeze({ ...caller });
    const now = this.options.now ?? (() => new Date());
    const capability = this.lookup(tool);
    if (capability === undefined) {
      await this.audit(caller.id, tool, params, undefined, "rejected", "INVALID_INPUT", `unknown capability '${tool}'`, now, undefined, caller);
      throw new ToolRejectionError("INVALID_INPUT", `unknown capability '${tool}'`);
    }
    const parsed = capability.inputSchema.safeParse(params ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      // Zod messages and paths can contain attacker-supplied object keys.
      // Persist only issue codes; detailed validation stays in the response.
      const auditIssues = parsed.error.issues.map((issue) => ({ code: issue.code }));
      await this.audit(caller.id, tool, params, undefined, "rejected", "INVALID_INPUT", "parameters failed schema validation", now, { issues: auditIssues }, caller);
      throw new ToolRejectionError("INVALID_INPUT", `parameters for '${tool}' failed validation`, { issues });
    }
    const context: ToolContext = {
      caller,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.networkPermissions !== undefined ? { networkPermissions: options.networkPermissions } : {}),
    };    let grant: GrantCheckResult | undefined;
    let executing = false;
    try {
      grant = await this.options.grants?.check(tool, caller, parsed.data, options)
        ?? { allowed: false, code: "UNAUTHORIZED_PATH", reason: "authorization checkpoint is not configured", decision: "denied" };
      if (!grant.allowed) throw new ToolRejectionError(grant.code ?? "UNAUTHORIZED_PATH", grant.reason ?? "tool authorization denied");
      if (options.signal?.aborted) throw new ToolRejectionError("CANCELLED", "tool call was cancelled");
      grant.revalidate?.();
      executing = true;
      const contextWithGrant: ToolContext =
        grant.approvalId !== undefined || grant.grantIds !== undefined
          ? {
              ...context,
              authorization: {
                ...(grant.approvalId !== undefined ? { approvalId: grant.approvalId } : {}),
                ...(grant.grantIds !== undefined ? { grantIds: grant.grantIds } : {}),
              },
            }
          : context;
      const result = await capability.handler(parsed.data, contextWithGrant);
      await this.audit(caller.id, tool, parsed.data, result, "ok", undefined, undefined, now, undefined, caller, grant);
      return result;
    } catch (error) {
      const code: GatewayRejectionCode | "RUNTIME_ERROR" =
        error instanceof ToolRejectionError ? error.code : "RUNTIME_ERROR";
      // Handler/checkpoint exception text can echo raw tool arguments.
      const reason = executing ? "tool execution failed" : "tool authorization failed";
      await this.audit(caller.id, tool, parsed.data, undefined, executing ? "error" : "rejected", code, reason, now, undefined, caller, grant);
      throw error;
    }
  }

  private lookup(tool: string): ToolCapability | undefined {
    return this.options.registry.get(tool);
  }

  private async audit(
    callerId: string,
    tool: string,
    params: unknown,
    result: unknown,
    outcome: AuditRecord["outcome"],
    code: GatewayRejectionCode | "RUNTIME_ERROR" | undefined,
    reason: string | undefined,
    now: () => Date,
    extraDetails?: Record<string, unknown>,
    principal?: ToolCaller,
    authorization?: GrantCheckResult,
  ): Promise<void> {
    const record: AuditRecord & Record<string, unknown> = {
      timestamp: now().toISOString(),
      caller: callerId,
      tool,
      paramsDigest: digest(params),
      resultDigest: result === undefined ? "-" : digest(result),
      outcome,
      ...(code !== undefined ? { code } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(extraDetails !== undefined ? { details: extraDetails } : {}),
      ...(principal?.botId !== undefined ? { botId: principal.botId } : {}),
      ...(principal?.sessionId !== undefined ? { sessionId: principal.sessionId } : {}),
      ...(authorization?.capabilities !== undefined ? { capabilities: authorization.capabilities } : {}),
      ...(authorization?.grantIds !== undefined ? { grantIds: authorization.grantIds } : {}),
      ...(authorization?.approvalId !== undefined ? { approvalId: authorization.approvalId } : {}),
      ...(authorization?.decision !== undefined ? { decision: authorization.decision } : {}),
    };
    await this.options.audit.append(record);
  }
}
