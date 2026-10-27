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
 * Application tools use a per-turn private channel into the D16 gateway.
 * Native approval-requiring tools still fail closed: chat sessions are not
 * registered in the workflow engine's D08 session registry.
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
import type { ToolCaller } from "@deepseek-bot/agent-tools";
import type { ApplicationToolTurn } from "./app-tool-channel.js";

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
  controller: AbortController | null;
  settled: Promise<void> | null;
}

export interface ChatToolWiring {
  prepareProfile(): void;
  openTurn(sessionId: string, caller: ToolCaller, signal: AbortSignal): ApplicationToolTurn;
}

/** Cancelling a turn must not wait for a desktop credential RPC to return. */
async function whileActive<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const detach = () => signal.removeEventListener("abort", cancel);
    const cancel = () => {
      detach();
      reject(
        new EngineError({
          code: "CANCELLED",
          message: "chat turn was cancelled",
          retryable: false,
        }),
      );
    };
    signal.addEventListener("abort", cancel, { once: true });
    void task.then(
      (value) => {
        detach();
        resolve(value);
      },
      (error) => {
        detach();
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}

export class ChatManager {
  private readonly sessions = new Map<string, ChatSession>();
  private closed = false;

  constructor(
    private readonly options: DshSdkExecutorOptions,
    private readonly tools: ChatToolWiring,
  ) {}

  /** Live sessions (diagnostics / tests). */
  get size(): number {
    return this.sessions.size;
  }

  async send(
    bot: Bot,
    text: string,
    history: ReadonlyArray<ChatHistoryEntry> = [],
  ): Promise<TurnOutcome & { sessionId: string }> {
    if (this.closed)
      throw new EngineError({
        code: "RUNTIME_UNAVAILABLE",
        message: "chat runtime is closed",
        retryable: false,
      });
    let session = this.sessions.get(bot.id);
    if (session === undefined) {
      session = {
        lastSessionId: chatSessionIdFor(bot.id),
        busy: false,
        active: null,
        controller: null,
        settled: null,
      };
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
    const controller = new AbortController();
    session.controller = controller;
    let finish!: () => void;
    session.settled = new Promise((resolve) => {
      finish = resolve;
    });
    const sessionId = `chat:${bot.id}:${randomUUID()}`;
    session.lastSessionId = sessionId;
    let attempt: HarnessAttempt | null = null;
    let turn: ApplicationToolTurn | null = null;
    const abortAttempt = () => {
      if (attempt !== null) void attempt.kill();
    };
    controller.signal.addEventListener("abort", abortAttempt, { once: true });
    try {
      const inputs = await whileActive(
        this.options.resolveBotInputs(bot).catch((error: unknown) => {
          throw new EngineError({
            code: "INVALID_INPUT",
            message: `无法解析模型凭据：${error instanceof Error ? error.message : String(error)}。请到设置里重新保存 API Key。`,
            retryable: false,
          });
        }),
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new EngineError({
          code: "CANCELLED",
          message: "chat turn was cancelled",
          retryable: false,
        });
      try {
        this.tools.prepareProfile();
      } catch {
        throw new EngineError({
          code: "RUNTIME_UNAVAILABLE",
          message: "application tools plugin is unavailable; rebuild the Host and bridge",
          retryable: false,
        });
      }
      turn = this.tools.openTurn(
        sessionId,
        { id: chatSessionIdFor(bot.id), botId: bot.id, sessionId: chatSessionIdFor(bot.id) },
        controller.signal,
      );
      await whileActive(turn.prepare?.() ?? Promise.resolve(), controller.signal);
      const baseOptions = this.buildOptions(inputs);
      attempt = new HarnessAttempt({ ...baseOptions, env: { ...baseOptions.env, ...turn.env } });
      session.active = attempt;
      await attempt.start({
        cwd: inputs.workspacePath,
        provider: this.options.provider ?? "deepseek-official",
        model: inputs.profile.model,
        ...(inputs.profile.limits?.maxTokens !== undefined
          ? { maxTokens: inputs.profile.limits.maxTokens }
          : {}),
      });
      await turn.waitReady();
      const prompt = this.composePrompt(bot, text, history);
      const outcome = await attempt.runTurn(sessionId, prompt, controller.signal);
      session.lastSessionId = sessionId;
      return { ...outcome, sessionId };
    } finally {
      controller.abort();
      if (turn !== null) await turn.close();
      if (attempt !== null) await attempt.dispose().catch(() => undefined);
      controller.signal.removeEventListener("abort", abortAttempt);
      session.active = null;
      session.controller = null;
      session.busy = false;
      finish();
      session.settled = null;
    }
  }

  cancel(sessionId: string): boolean {
    const botId = sessionId.startsWith("chat:") ? sessionId.slice("chat:".length) : sessionId;
    const session =
      this.sessions.get(botId) ??
      [...this.sessions.values()].find((candidate) => candidate.lastSessionId === sessionId);
    if (session === undefined || !session.busy || session.controller === null) {
      return false;
    }
    session.controller.abort();
    return true;
  }

  async disposeAll(): Promise<void> {
    this.closed = true;
    for (const session of this.sessions.values()) {
      session.controller?.abort();
    }
    await Promise.allSettled(
      [...this.sessions.values()].flatMap((session) =>
        session.settled === null ? [] : [session.settled],
      ),
    );
    this.sessions.clear();
  }

  private composePrompt(bot: Bot, text: string, history: ReadonlyArray<ChatHistoryEntry>): string {
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
