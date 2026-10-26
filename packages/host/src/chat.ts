/**
 * Chat runtime (D30): one Harness attempt per turn, conversation state kept by
 * the Host.
 *
 * The pinned Harness rejects re-using a session id for a new prompt
 * (`session "...": already exists`) and `session/resume` only attaches to a
 * session owned by the same runtime, so the runtime cannot be a long-lived
 * conversation here. Each turn therefore starts a fresh session, and the Host
 * replays the recent chat history (persisted in `chat_messages`) as prompt
 * context. That keeps multi-turn chat coherent without depending on harness
 * session persistence.
 *
 * Approval-requiring tools fail closed for chat sessions on purpose in this
 * slice: chat sessions are not registered in the bridge's session registry.
 */
import { randomUUID } from "node:crypto";
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

export interface ChatHistoryEntry {
  readonly role: "user" | "assistant";
  readonly text: string;
}

interface ChatSession {
  lastSessionId: string;
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

  async send(
    bot: Bot,
    text: string,
    history: ReadonlyArray<ChatHistoryEntry> = [],
  ): Promise<TurnOutcome & { sessionId: string }> {
    let session = this.sessions.get(bot.id);
    if (session === undefined) {
      session = { lastSessionId: chatSessionIdFor(bot.id), busy: false, active: null };
      this.sessions.set(bot.id, session);
    }
    if (session.busy) {
      throw new EngineError({
        code: "RATE_LIMITED",
        message: "this bot is already answering; wait for the current turn to finish",
        retryable: true,
      });
    }
    session.busy = true;
    let attempt: HarnessAttempt | null = null;
    try {
      const inputs = await this.options.resolveBotInputs(bot).catch((error: unknown) => {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: `无法解析模型凭据：${error instanceof Error ? error.message : String(error)}。请到设置里重新保存 API Key。`,
          retryable: false,
        });
      });
      attempt = new HarnessAttempt(this.buildOptions(inputs));
      session.active = attempt;
      await attempt.start({
        cwd: inputs.workspacePath,
        provider: this.options.provider ?? "deepseek-official",
        model: inputs.profile.model,
        ...(inputs.profile.limits?.maxTokens !== undefined
          ? { maxTokens: inputs.profile.limits.maxTokens }
          : {}),
      });
      const sessionId = `chat:${bot.id}:${randomUUID()}`;
      const prompt = this.composePrompt(bot, text, history);
      const outcome = await attempt.runTurn(sessionId, prompt);
      session.lastSessionId = sessionId;
      return { ...outcome, sessionId };
    } finally {
      session.active = null;
      session.busy = false;
      if (attempt !== null) {
        await attempt.dispose().catch(() => undefined);
      }
    }
  }

  cancel(sessionId: string): boolean {
    const botId = sessionId.startsWith("chat:") ? sessionId.slice("chat:".length) : sessionId;
    const session =
      this.sessions.get(botId) ??
      [...this.sessions.values()].find((candidate) => candidate.lastSessionId === sessionId);
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

  private composePrompt(
    bot: Bot,
    text: string,
    history: ReadonlyArray<ChatHistoryEntry>,
  ): string {
    const parts: string[] = [];
    if (bot.instructions.trim().length > 0) {
      parts.push(bot.instructions.trim());
    }
    if (history.length > 0) {
      const lines = history.map(
        (entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`,
      );
      parts.push(`【最近对话】\n${lines.join("\n")}`);
    }
    parts.push(`[用户消息]\n${text}`);
    return parts.join("\n\n");
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
