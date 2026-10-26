/**
 * Capability registry + dispatch pipeline (D15 阶段一 read layer).
 *
 * Dispatch rejects before touching anything on: unknown capability,
 * denied grant, or schema-invalid parameters — each rejection is audited.
 * Successful calls audit params/result digests (full values never enter the
 * audit trail; digests + registered schema are the trace).
 */
import { createHash } from "node:crypto";
import {
  ToolRejectionError,
  type AuditRecord,
  type AuditSink,
  type GatewayRejectionCode,
  type GrantCheckpoint,
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
}

export interface ToolGatewayOptions {
  readonly registry: ToolRegistry;
  readonly audit: AuditSink;
  /** Defaults to the read-layer allow-all stub (D16 replaces this). */
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
    const now = this.options.now ?? (() => new Date());
    const capability = this.lookup(tool);
    if (capability === undefined) {
      await this.audit(caller.id, tool, params, undefined, "rejected", "INVALID_INPUT", `unknown capability '${tool}'`, now);
      throw new ToolRejectionError("INVALID_INPUT", `unknown capability '${tool}'`);
    }
    const grant = await this.options.grants?.check(tool, caller) ?? { allowed: true };
    if (!grant.allowed) {
      await this.audit(caller.id, tool, params, undefined, "rejected", "UNAUTHORIZED_PATH", grant.reason ?? "grant denied", now);
      throw new ToolRejectionError(
        "UNAUTHORIZED_PATH",
        grant.reason ?? `tool '${tool}' is not granted for caller '${caller.id}'`,
      );
    }
    const parsed = capability.inputSchema.safeParse(params ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      await this.audit(caller.id, tool, params, undefined, "rejected", "INVALID_INPUT", "parameters failed schema validation", now, { issues });
      throw new ToolRejectionError("INVALID_INPUT", `parameters for '${tool}' failed validation`, { issues });
    }
    const context: ToolContext = {
      caller,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };
    try {
      const result = await capability.handler(parsed.data, context);
      await this.audit(caller.id, tool, parsed.data, result, "ok", undefined, undefined, now);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const code: GatewayRejectionCode | "RUNTIME_ERROR" =
        error instanceof ToolRejectionError ? error.code : "RUNTIME_ERROR";
      await this.audit(caller.id, tool, parsed.data, undefined, "error", code, reason, now);
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
    };
    await this.options.audit.append(record);
  }
}
