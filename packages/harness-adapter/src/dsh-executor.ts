/**
 * DshSdkExecutor: the real Harness adapter behind the runtime package's
 * NodeExecutor port (D12, ARCHITECTURE §2/§3).
 *
 * One node attempt = one pinned-version Harness subprocess bound to one
 * session, running in the bot's workspace with the model route resolved from
 * the bot's model profile. Permission enforcement does not live here: the
 * adapter registers each attempt's engine-issued permission handle under its
 * harness session id, and the approval bridge answers upstream
 * `approval/request` decisions through that registry — every side-effecting
 * tool action the runtime takes flows through the D08 gate.
 *
 * The adapter owns no storage: model route, workspace path and the decrypted
 * model credential arrive per attempt through host-supplied resolution, so
 * the adapter can run without the database and the key never enters workflow
 * data, events or the UI (SECURITY_DATA §3).
 *
 * Cancellation and timeouts are the engine's policy: the executor observes
 * `context.signal` and tears its own subprocess down immediately (upstream
 * has no cancel method, D01 §8.2).
 */
import type { Bot, ModelProfile } from "@deepseek-bot/contracts";
import {
  NodeExecutionError,
  type BotNodeExecutionContext,
  type BotNodeExecutionResult,
  type NodeExecutor,
} from "@deepseek-bot/runtime";
import {
  HarnessAttempt,
  type HarnessAttemptOptions,
} from "./harness-attempt.js";
import {
  PINNED_DSH_VERSION,
  resolveDshSpec,
  type DshLaunchSpec,
} from "./launch.js";
import { composeNodePrompt } from "./prompt.js";
import { TurnUsageAccumulator } from "./usage.js";

/** Everything the host resolves from storage for one attempt. */
export interface BotRuntimeInputs {
  readonly profile: ModelProfile;
  /** Absolute canonical workspace path the session runs in. */
  readonly workspacePath: string;
  /** Decrypted model credential; injected into the child environment only. */
  readonly apiKey: string;
}

export interface DshSdkExecutorOptions {
  /**
   * Absolute dsh CLI path override. Omitted resolves the pinned
   * `@deepseek-ai/dsh` dependency and asserts its manifest version;
   * tests inject a fake runtime script here.
   */
  readonly dshBin?: string;
  /** Absolute Harness home (the app's dedicated DSH_HOME, ARCHITECTURE §4). */
  readonly dshHome: string;
  /** Profile serving the SDK protocol; the default upstream composition. */
  readonly profile?: string;
  /** Absolute per-launch cordis patch files (telemetry DISABLED, approval bridge). */
  readonly patches?: readonly string[];
  /** Extra child environment (auth token for the approval bridge, scrubbing). */
  readonly childEnv?: (parentEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  /** Provider route for SDK-created agents (upstream default `deepseek-official`). */
  readonly provider?: string;
  /** Per-attempt storage resolution supplied by the host. */
  readonly resolveBotInputs: (bot: Bot) => Promise<BotRuntimeInputs>;
  /** Timeout overrides forwarded to each attempt. */
  readonly initializeTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

/** Permission handle plus the run/node ids the bridge reports with decisions. */
export interface RegisteredSessionContext {
  readonly runId: string;
  readonly nodeRunId: string;
  readonly permissions: BotNodeExecutionContext["permissions"];
}

export type SessionGateResolver = (sessionId: string) => RegisteredSessionContext | undefined;

/**
 * Session → permission-handle registry shared with the approval bridge: the
 * bridge resolves the harness session id of an incoming approval request to
 * the engine-issued gate of the attempt that owns the session.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, RegisteredSessionContext>();

  register(sessionId: string, context: RegisteredSessionContext): void {
    this.sessions.set(sessionId, context);
  }

  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  resolve(sessionId: string): RegisteredSessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }
}

export interface DshExecutorWiring {
  /** Registry the approval bridge consults; defaults to a private instance. */
  readonly sessionRegistry?: SessionRegistry;
}

export class DshSdkExecutor implements NodeExecutor {
  private readonly spec: DshLaunchSpec | undefined;
  private readonly sessionRegistry: SessionRegistry;

  constructor(
    private readonly options: DshSdkExecutorOptions,
    wiring?: DshExecutorWiring,
  ) {
    this.sessionRegistry = wiring?.sessionRegistry ?? new SessionRegistry();
    if (options.dshBin === undefined) {
      this.spec = resolveDshSpec(PINNED_DSH_VERSION);
    }
  }

  /** Registry handle for the approval bridge / diagnostics. */
  get sessions(): SessionRegistry {
    return this.sessionRegistry;
  }

  /** The launch spec resolved at construction (undefined with a dshBin override). */
  get launchSpec(): DshLaunchSpec | undefined {
    return this.spec;
  }

  async executeBotNode(context: BotNodeExecutionContext): Promise<BotNodeExecutionResult> {
    const inputs = await this.resolveInputs(context);
    const sessionId = harnessSessionId(context.nodeRun.id, context.nodeRun.attempt);
    const attempt = new HarnessAttempt(this.attemptOptions(context, inputs));
    this.sessionRegistry.register(sessionId, {
      runId: context.run.id,
      nodeRunId: context.nodeRun.id,
      permissions: context.permissions,
    });
    try {
      await attempt.start({
        cwd: inputs.workspacePath,
        provider: this.options.provider ?? "deepseek-official",
        model: inputs.profile.model,
        ...(inputs.profile.limits?.maxTokens !== undefined
          ? { maxTokens: inputs.profile.limits.maxTokens }
          : {}),
      });
      const prompt = composeNodePrompt(context.bot, context.node, context.inputs);
      const outcome = await attempt.runTurn(sessionId, prompt, context.signal);
      /* G4 residual: a workflow model turn is billed like any other; the same
         defensive reader the chat path uses turns the attempt's collected
         session events into counts (an estimate when no frame carried usage). */
      const turnUsage = new TurnUsageAccumulator();
      for (const event of outcome.events) turnUsage.observe(event);
      return {
        outputs: {
          response: outcome.finalResponse,
          turnEndKind: outcome.turnEndKind ?? null,
        },
        sessionId,
        usage: turnUsage.finish(prompt, outcome.finalResponse),
      };
    } finally {
      this.sessionRegistry.unregister(sessionId);
      await attempt.dispose();
    }
  }

  private async resolveInputs(context: BotNodeExecutionContext): Promise<BotRuntimeInputs> {
    try {
      return await this.options.resolveBotInputs(context.bot);
    } catch (error) {
      throw new NodeExecutionError({
        code: "INVALID_INPUT",
        message: `runtime inputs for bot '${context.bot.id}' could not be resolved: ${
          error instanceof Error ? error.message : String(error)
        }`,
        retryable: false,
      });
    }
  }

  private attemptOptions(
    context: BotNodeExecutionContext,
    inputs: BotRuntimeInputs,
  ): HarnessAttemptOptions {
    const patches = this.options.patches ?? [];
    const dshBin = this.options.dshBin ?? this.spec?.dshBin;
    if (dshBin === undefined) {
      throw new NodeExecutionError({
        code: "RUNTIME_UNAVAILABLE",
        message: "harness runtime binary could not be resolved",
        retryable: false,
      });
    }
    const parent = this.options.childEnv?.(process.env) ?? process.env;
    return {
      command: this.spec?.command ?? process.execPath,
      args: [
        dshBin,
        "--profile",
        this.options.profile ?? "sdk",
        ...patches.flatMap((patch) => ["--patch", patch]),
      ],
      cwd: inputs.workspacePath,
      env: {
        ...parent,
        DSH_HOME: this.options.dshHome,
        DEEPSEEK_API_KEY: inputs.apiKey,
      },
      ...(this.options.initializeTimeoutMs !== undefined
        ? { initializeTimeoutMs: this.options.initializeTimeoutMs }
        : {}),
      ...(this.options.shutdownTimeoutMs !== undefined
        ? { shutdownTimeoutMs: this.options.shutdownTimeoutMs }
        : {}),
    };
  }
}

/** Session id for a node attempt — stable and traceable across host restarts. */
export function harnessSessionId(nodeRunId: string, attempt: number): string {
  return `dsb-${nodeRunId}-a${attempt}`;
}
