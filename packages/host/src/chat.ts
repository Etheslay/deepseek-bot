/**
 * Chat runtime (D30): one Harness conversation per bot, one attempt per turn.
 *
 * Each `chat.send` spawns a fresh pinned-Harness attempt and resumes the bot's
 * stable session id (`chat:<botId>`), so conversation context lives in the
 * Harness home (the same `session/resume` path D01 verified) instead of a
 * long-lived child process. Approval-requiring tools fail closed for chat
 * sessions on purpose in this slice: chat sessions are not registered in the
 * bridge's session registry.
 */
import type { Bot } from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";
import {
  HarnessAttempt,
  PINNED_DSH_VERSION,
  resolveDshSpec,
  type DshSdkExecutorOptions,
  type HarnessAttemptOptions,
  type TurnOutcome,
} from "@deepseek-bot/harness-adapter";

export function chatSessionIdFor(botId: string): string {
  return `chat:${botId}`;
}

type BotInputs = Awaited<ReturnType<DshSdkExecutorOptions["resolveBotInputs"]>>;

interface ChatSession {
  readonly sessionId: string;
  turns: number;
  busy: boolean;
  active: HarnessAttempt | null;
}

export class ChatManager {
  private readonly sessions = new Map<string, ChatSession>();

  constructor(private readonly options: DshSdkExecutorOptions) {}

  /** Live sessions (diagnostics / tests). */
  get size(): number {
    return this.sessions.size;
  }

  async send(bot: Bot, text: string): Promise<TurnOutcome & { sessionId: string }> {
    const sessionId = chatSessionIdFor(bot.id);
    let session = this.sessions.get(sessionId);
    if (session === undefined) {
      session = { sessionId, turns: 0, busy: false, active: null };
      this.sessions.set(sessionId, session);
    }
    if (session.busy) {
      throw new EngineError({
        code: "RATE_LIMITED",
        message: "this bot is already answering; wait for the current turn to finish",
        retryable: true,
      });
    }
    session.busy = true;
    const inputs = await this.options.resolveBotInputs(bot);
    const attempt = new HarnessAttempt(this.buildOptions(inputs));
    session.active = attempt;
    try {
      await attempt.start({
        cwd: inputs.workspacePath,
        provider: this.options.provider ?? "deepseek-official",
        model: inputs.profile.model,
        ...(inputs.profile.limits?.maxTokens !== undefined
          ? { maxTokens: inputs.profile.limits.maxTokens }
          : {}),
      });
      if (session.turns > 0) {
        // Continuation turn: pull the stored conversation back into this child.
        await attempt.resume(sessionId).catch(() => undefined);
      }
      const prompt = `${bot.instructions}\n\n[用户消息]\n${text}`;
      const outcome = await attempt.runTurn(sessionId, prompt);
      session.turns += 1;
      return { ...outcome, sessionId };
    } finally {
      session.active = null;
      session.busy = false;
      await attempt.dispose().catch(() => undefined);
    }
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.active === null) {
      return false;
    }
    void session.active.dispose().catch(() => undefined);
    session.active = null;
    return true;
  }

  async disposeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.active !== null) {
        await session.active.dispose().catch(() => undefined);
      }
    }
    this.sessions.clear();
  }

  private buildOptions(inputs: BotInputs): HarnessAttemptOptions {
    const patches = this.options.patches ?? [];
    const spec = this.options.dshBin === undefined ? resolveDshSpec(PINNED_DSH_VERSION) : undefined;
    const dshBin = this.options.dshBin ?? spec?.dshBin;
    if (dshBin === undefined) {
      throw new EngineError({
        code: "RUNTIME_UNAVAILABLE",
        message: "harness runtime binary could not be resolved for chat",
        retryable: false,
      });
    }
    const parent = this.options.childEnv?.(process.env) ?? process.env;
    return {
      command: spec?.command ?? process.execPath,
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

