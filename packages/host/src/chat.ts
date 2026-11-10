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
 * Native approval-requiring tools reach the D16 checkpoint through the D08
 * approval bridge: the turn registers a ChatNativeGate in the session
 * registry (G3), so policy ask mints the same AppApproval card the app
 * tools use and deny/allow/cancel follow the shared semantics.
 */
import { randomUUID } from "node:crypto";
import type {
  Bot,
  CapabilityId,
  ChatSkillInjection,
} from "@deepseek-bot/contracts";
// B6: the notice shape is pinned by the contracts package (events.ts) — one
// source of truth for the host emitter and the desktop consumer.
import { type ChatStreamNotice } from "@deepseek-bot/contracts";
import {
  EngineError,
  type NodePermissionHandle,
} from "@deepseek-bot/runtime";
import {
  HarnessAttempt,
  PINNED_DSH_VERSION,
  resolveDshSpec,
  type DshSdkExecutorOptions,
  type HarnessAttemptOptions,
  type PromptContentBlock,
  type SessionEventEnvelope,
  type TurnOutcome,
} from "@deepseek-bot/harness-adapter";
import type { ToolCaller } from "@deepseek-bot/agent-tools";
import type { ApplicationToolTurn } from "./app-tool-channel.js";
import type { UiLocale } from "./host.js";
import { composeSkillBlock, skillCapabilityAllowlist } from "./skill-injection.js";
import { resolveTurnModel, TurnUsageAccumulator, type TurnUsage } from "./usage-capture.js";

export function chatSessionIdFor(botId: string): string {
  return `chat:${botId}`;
}

type BotInputs = Awaited<ReturnType<DshSdkExecutorOptions["resolveBotInputs"]>>;

export interface ChatHistoryEntry {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/**
 * Real turn stages, derived from live harness session events (never guessed):
 * `preparing` covers credential/profile resolution and the harness handshake,
 * `thinking` means the model is generating (no tool in flight), `tool` means a
 * tool call from the wire is currently executing.
 */
export type TurnStage = "preparing" | "thinking" | "tool";

export interface TurnProgress {
  readonly stage: TurnStage;
  readonly toolName?: string;
  readonly startedAt: string;
}

/**
 * B6 incremental streaming: one live assistant segment from a running turn.
 * The pinned harness settles a whole assistant message per model attempt
 * (there are no token-level deltas on the wire), so a tool-using turn
 * streams its narration segment by segment; the turn's authoritative reply
 * stays the last one (`chat.send` response). The shape is pinned by the
 * contracts package (`ChatStreamNoticeSchema`, events.ts) — one source of
 * truth for the host emitter and the desktop consumer.
 */
export type { ChatStreamNotice };

interface ChatSession {
  lastSessionId: string;
  busy: boolean;
  active: HarnessAttempt | null;
  controller: AbortController | null;
  settled: Promise<void> | null;
  /**
   * The next send waits on this, then replaces it with its own gate.
   * Starts resolved so the first message does not wait.
   */
  gate: Promise<void>;
  /** Lines the user inserted while this turn is running. Drained before the reply is committed. */
  asides: string[];
  /** Live progress of the running turn; null while idle. */
  progress: TurnProgress | null;
}

export interface ChatToolWiring {
  prepareProfile(): void;
  openTurn(
    sessionId: string,
    caller: ToolCaller,
    signal: AbortSignal,
    skillCapabilities?: readonly CapabilityId[],
  ): ApplicationToolTurn;
  /**
   * G3: register/unregister the turn's native-tool gate with the D08 approval
   * bridge. Present only when the host wires the bridge; absent means native
   * approval asks keep failing closed exactly as before.
   */
  readonly bridgeRegistration?: {
    register(sessionId: string, permissions: NodePermissionHandle): void;
    unregister(sessionId: string): void;
  };
  readonly nativeGate?: (input: {
    readonly sessionId: string;
    readonly botId: string;
    readonly signal: AbortSignal;
  }) => NodePermissionHandle;
}

/** A mid-turn line: an intent change or a supplement, read before the reply is committed. */
function asidePrompt(lines: readonly string[]): string {
  return [
    "用户在这一轮还没结束时插了话。这通常是用意的变更，或是对正在做的事的补充。",
    "请把下面每一句读进你正在进行的思考，按新的用意继续。已经做完的部分保留，不要推倒重来，也不要只回复“收到”。",
    "",
    ...lines.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}

/**
 * A deck request has to leave as a file. The model otherwise invents a broken
 * tool channel and answers with an outline. write_presentation is already
 * bound on this turn.
 */
function deckDeliveryRule(text: string): string {
  if (!/pptx|幻灯片|演示文稿|课件|(?:^|[^a-z])ppt(?:[^a-z]|$)/i.test(text)) return "";
  return [
    "【必须交付演示文稿】",
    "用户要的是本机上的一个 .pptx 文件。这一轮只调用一次 write_presentation，把内容写进这个文件。",
    "这个工具已经接在这一轮。工作区写入允许时，它直接创建 .pptx，不启动 Python，不打开 PowerPoint，也不需要浏览器。",
    "【演示文稿技能】",
    "path 用工作区相对路径，以 .pptx 结尾，例如 认识分数.pptx。",
    "ir.brief 写 topic、audience、goal、slide_budget、lang。lang 用 zh-CN。slide_budget 等于你交的页数。用户点名要留在文稿里的句子放进 must_keep。",
    "slides 第一页 layout 是 cover，最后一页是 end。满 8 页时，封面后加一页 section。标题写成结论：封面不超过 18 字，章节不超过 12 字，其余不超过 24 字。",
    "每一页的 blocks 只用 bullets、callout、kv、table、chart。要点放进 bullets.items。页上的数字照用户的原话写。",
    "最小形状：{\"path\":\"认识分数.pptx\",\"ir\":{\"brief\":{\"topic\":\"认识分数\",\"audience\":\"三年级学生和家长\",\"goal\":\"讲清比较大小\",\"slide_budget\":2,\"lang\":\"zh-CN\",\"must_keep\":[\"1/2 大于 1/4\"]},\"slides\":[{\"id\":\"s01\",\"layout\":\"cover\",\"title\":\"一半大于四分之一\"},{\"id\":\"s02\",\"layout\":\"end\",\"title\":\"分母相同看分子\",\"blocks\":[{\"type\":\"bullets\",\"items\":[\"1/2 大于 1/4\"]}]}]}}",
    "Host 会补上缺的封面、收束、章节、标题长度和数字台账，然后把文件写进工作区。不要先交文字大纲，也不要因为页数或数字先放弃。",
    "前面如果说过工具通道断了、让用户点「下载可编辑」、双击 bat、或自己装 python-pptx，那些话作废。不要再重复。",
    "不要写 .bat，不要写安装脚本，不要说备用方案，不要用文字稿、互动页或导出按钮代替这个文件。",
    "工具返回后，把文件路径告诉用户。",
  ].join("\n");
}

/** Concatenated text blocks of one assistant message (harness-attempt shape). */
function assistantTextOf(event: SessionEventEnvelope): string | null {
  const content = (event.data as { message?: { content?: unknown } } | undefined)?.message
    ?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/** Cancelling a turn must not wait for a desktop credential RPC to return. */
async function whileActive<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {  return new Promise<T>((resolve, reject) => {
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
    /** Live UI language for Host-authored turn errors (settings.update { ui.locale }). */
    private readonly locale: () => UiLocale = () => "zh",
    /** Receives the token usage of every finished turn (usage.summary source). */
    private readonly onTurnUsage:
      | ((usage: TurnUsage & { estimated: boolean; botId: string; sessionId: string }) => void)
      | undefined = undefined,
    /** B6: receives each live assistant segment while a chat turn runs. */
    private readonly onTurnStream: ((notice: ChatStreamNotice) => void) | undefined = undefined,
  ) {}

  /** Live sessions (diagnostics / tests). */
  get size(): number {
    return this.sessions.size;
  }

  async send(
    bot: Bot,
    text: string,
    history: ReadonlyArray<ChatHistoryEntry> = [],
    skills: readonly ChatSkillInjection[] = [],
    options: {
      primitive?: boolean;
      summary?: string;
      /** B3'': canonical base64 rasters riding this turn as image blocks. */
      images?: ReadonlyArray<{
        data: string;
        mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      }>;
    } = {},
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
        gate: Promise.resolve(),
        asides: [],
        progress: null,
      };
      this.sessions.set(bot.id, session);
    }
    // A second send is allowed. Rejecting it raced a cancel and showed
    // "already answering". Take a place in line, then run once the previous
    // turn has released the bot. A line the composer keeps on this turn goes
    // through enqueueAside instead, and is read before the reply is committed.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const earlier = session.gate;
    session.gate = gate;
    try {
    // Stay synchronous until the controller is installed when nobody else
    // owns the bot. Awaiting an already-resolved gate would yield, and a
    // cancel arriving in that gap would find no turn to abort.
    if (session.busy) {
      await earlier;
      if (this.closed) {
        throw new EngineError({
          code: "RUNTIME_UNAVAILABLE",
          message: "chat runtime is closed",
          retryable: false,
        });
      }
    }
    session.busy = true;
    session.progress = { stage: "preparing", startedAt: new Date().toISOString() };
    /**
     * Mirror the wire into the session's live progress. Only real harness
     * events move it: the receipt means the model took the message
     * ("thinking"), a `tool/call` names the tool now executing, a
     * `tool/result` hands control back to the model ("thinking" again).
     */
    const turnUsage = new TurnUsageAccumulator();
    const observeEvent = (event: SessionEventEnvelope): void => {
      /* usage rides on its own frames, independent of progress state */
      turnUsage.observe(event);
      if (event.type === "assistant/message") {
        // B6: forward the settled segment live. A throwing sink must never
        // break the turn, mirroring the usage path above.
        const text = assistantTextOf(event);
        if (text !== null && text.length > 0) {
          try {
            this.onTurnStream?.({ botId: bot.id, sessionId, text });
          } catch {
            /* stream forwarding is best-effort */
          }
        }
      }
      const current = session.progress;
      if (current === null) {
        return;
      }
      if (event.type === "tool/call") {
        const name = (event.data as { name?: unknown } | undefined)?.name;
        if (typeof name === "string" && name.length > 0) {
          session.progress = { ...current, stage: "tool", toolName: name };
        }
        return;
      }
      if (event.type === "tool/result" && current.stage === "tool") {
        // Keep the document or presentation tool name so the chat line can
        // stay on "制作文档" or "制作演示文稿" until the reply text arrives.
        session.progress =
          current.toolName === "edit_document" || current.toolName === "write_presentation"
            ? { stage: "thinking", startedAt: current.startedAt, toolName: current.toolName }
            : { stage: "thinking", startedAt: current.startedAt };
      } else if (current.stage === "preparing") {
        // The enqueue receipt (or any turn traffic) means the harness took
        // the prompt: the model is generating now.
        session.progress = { stage: "thinking", startedAt: current.startedAt };
      }
    };
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
    let registered = false;
    const abortAttempt = () => {
      if (attempt !== null) void attempt.kill();
    };
    controller.signal.addEventListener("abort", abortAttempt, { once: true });
    try {
      const inputs = await whileActive(
        this.options.resolveBotInputs(bot).catch((error: unknown) => {
          // 人性化提醒 (humanized errors): raw system errors (ENOENT, paths,
          // decrypt failures) never reach the chat — they go to stderr for
          // diagnosis, and the user gets one calm sentence with the fix.
          const detail = error instanceof Error ? error.message : String(error);
          process.stderr.write(`[host] model credential resolution failed: ${detail}\n`);
          const missingKey = /ENOENT|no such file|credential|decrypt|api key/i.test(detail);
          throw new EngineError({
            code: "INVALID_INPUT",
            message:
              this.locale() === "en"
                ? missingKey
                  ? "I can't start yet — no usable API Key is saved on this machine for me. Re-save your key in Settings, then send that again."
                  : "I can't resolve my model credentials. Check the API Key and model configuration in Settings, then try again."
                : missingKey
                  ? "还开不了对话：这台电脑上还没有我能用的 API Key（可能已失效）。到 设置 里重新保存一次，再把刚才的话发一遍就好。"
                  : "模型凭据解析失败。到 设置 里检查 API Key 与模型配置，再试一次。",
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
        skillCapabilityAllowlist(skills),
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
      // G3: register the turn's native-tool gate so harness approval asks
      // reach the D16 checkpoint; chat.cancel aborts the turn signal, which
      // cancels any pending approval waiter.
      if (
        this.tools.bridgeRegistration !== undefined &&
        this.tools.nativeGate !== undefined
      ) {
        this.tools.bridgeRegistration.register(
          sessionId,
          this.tools.nativeGate({
            sessionId,
            botId: bot.id,
            signal: controller.signal,
          }),
        );
        registered = true;
      }
      const prompt = this.composePrompt(bot, text, history, skills, {
        primitive: options.primitive === true,
        ...(options.summary !== undefined ? { summary: options.summary } : {}),
      });
      // B3'': the prompt text rides as the first block, admitted image blocks
      // follow. The upstream LLM layer gates per model — a text-only route
      // receives the deterministic text projection (TASK_B3P_VISION_INPUT.md).
      const contentBlocks: PromptContentBlock[] = [
        { type: "text", text: prompt },
        ...(options.images ?? []).map((image) => ({
          type: "image" as const,
          data: image.data,
          mimeType: image.mimeType,
        })),
      ];
      let outcome = await attempt.runTurn(sessionId, contentBlocks, controller.signal, observeEvent);
      // An aside arrived while this turn was running. Read it on the same
      // session before the reply is committed, so a change of intent or a
      // supplement is part of the thinking the user is waiting on.
      while (session.asides.length > 0 && !controller.signal.aborted) {
        const lines = session.asides.splice(0, session.asides.length);
        outcome = await attempt.runTurn(sessionId, asidePrompt(lines), controller.signal, observeEvent);
      }
      session.lastSessionId = sessionId;
      /*
       * Accounting must never fail a turn: a usage write error is swallowed so
       * the reply the user is waiting for still reaches them.
       */
      try {
        const counted = turnUsage.finish(prompt, outcome.finalResponse);
        this.onTurnUsage?.({
          ...counted,
          model: resolveTurnModel(counted.model, inputs.profile.model),
          botId: bot.id,
          sessionId,
        });
      } catch {
        /* usage accounting is best-effort */
      }
      return { ...outcome, sessionId };
    } finally {
      if (registered) this.tools.bridgeRegistration?.unregister(sessionId);
      controller.abort();
      if (turn !== null) await turn.close();
      if (attempt !== null) await attempt.dispose().catch(() => undefined);
      controller.signal.removeEventListener("abort", abortAttempt);
      session.active = null;
      session.controller = null;
      session.busy = false;
      session.asides = [];
      session.progress = null;
      finish();
      session.settled = null;
    }
    } finally {
      releaseGate();
    }
  }

  /**
   * Keep a line the user sent while this bot is answering. The open turn
   * reads it before committing a reply. Returns false when no turn is open,
   * so the caller can start an ordinary send.
   */
  enqueueAside(botId: string, text: string): boolean {
    const session = this.sessions.get(botId);
    if (session === undefined || !session.busy) return false;
    session.asides.push(text);
    return true;
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

  /**
   * Context-meter compression turn (TASK_CONTEXT_METER.md): one bare model
   * turn with the given prompt. Nothing lands in `chat_messages`, no
   * approval gate is registered (the summarization prompt calls no tools),
   * and the turn's own usage still flows through `onTurnUsage` — it is a
   * real token cost and the billing page stays honest about it.
   */
  async compressTurn(bot: Bot, prompt: string): Promise<string> {
    if (this.closed)
      throw new EngineError({
        code: "RUNTIME_UNAVAILABLE",
        message: "chat runtime is closed",
        retryable: false,
      });
    const controller = new AbortController();
    let attempt: HarnessAttempt | null = null;
    let turn: ApplicationToolTurn | null = null;
    const sessionId = `chat-summary:${bot.id}:${randomUUID()}`;
    try {
      const inputs = await this.options.resolveBotInputs(bot);
      this.tools.prepareProfile();
      turn = this.tools.openTurn(
        sessionId,
        { id: chatSessionIdFor(bot.id), botId: bot.id, sessionId: chatSessionIdFor(bot.id) },
        controller.signal,
        [],
      );
      await turn.prepare?.();
      const baseOptions = this.buildOptions(inputs);
      attempt = new HarnessAttempt({ ...baseOptions, env: { ...baseOptions.env, ...turn.env } });
      await attempt.start({
        cwd: inputs.workspacePath,
        provider: this.options.provider ?? "deepseek-official",
        model: inputs.profile.model,
        ...(inputs.profile.limits?.maxTokens !== undefined
          ? { maxTokens: inputs.profile.limits.maxTokens }
          : {}),
      });
      await turn.waitReady();
      const turnUsage = new TurnUsageAccumulator();
      const outcome = await attempt.runTurn(
        sessionId,
        prompt,
        controller.signal,
        (event: SessionEventEnvelope) => {
          turnUsage.observe(event);
        },
      );
      try {
        const counted = turnUsage.finish(prompt, outcome.finalResponse);
        this.onTurnUsage?.({
          ...counted,
          model: resolveTurnModel(counted.model, inputs.profile.model),
          botId: bot.id,
          sessionId,
        });
      } catch {
        /* usage accounting is best-effort */
      }
      return outcome.finalResponse;
    } finally {
      controller.abort();
      if (turn !== null) await turn.close();
      if (attempt !== null) await attempt.dispose().catch(() => undefined);
    }
  }

  /**
   * Live progress of a bot's turn, for the chat UI's status line. Only real
   * harness events feed it; when no turn is running the bot reports idle.
   */
  status(botId: string): { active: boolean; stage: "idle" | TurnStage; toolName?: string; startedAt?: string } {
    const session = this.sessions.get(botId);
    const progress = session?.progress ?? null;
    if (progress === null) {
      return { active: false, stage: "idle" };
    }
    return {
      active: true,
      stage: progress.stage,
      ...(progress.toolName !== undefined ? { toolName: progress.toolName } : {}),
      startedAt: progress.startedAt,
    };
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

  /**
   * Primitive mode (原始人模式) composes a one-step terse turn: no persona
   * instructions, no history replay, only the explicitly attached skill block,
   * one terse directive and this message. Persisted rows and history replay
   * are untouched — the flag shapes this prompt only.
   *
   * `summary` (context meter) folds everything before a watermark into one
   * digest block; the caller still passes only the post-watermark rows as
   * `history`, so the replay shrinks without deleting anything.
   */
  private composePrompt(
    bot: Bot,
    text: string,
    history: ReadonlyArray<ChatHistoryEntry>,
    skills: readonly ChatSkillInjection[],
    opts: { primitive?: boolean; summary?: string } = {},
  ): string {
    const primitive = opts.primitive === true;
    const summary = opts.summary?.trim();
    const parts: string[] = [];
    if (!primitive && bot.instructions.trim().length > 0) {
      parts.push(bot.instructions.trim());
    }
    const skillBlock = composeSkillBlock(skills);
    if (skillBlock.length > 0) {
      parts.push(skillBlock);
    }
    if (!primitive && summary !== undefined && summary.length > 0) {
      parts.push(`【更早对话摘要】\n${summary}`);
    }
    if (primitive) {
      parts.push("【原始人模式】只回答下面这一步：不铺垫、不复述上下文、不做总结；直接给最短可用的答案。");
    } else if (history.length > 0) {
      const lines = history.map(
        (entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`,
      );
      parts.push(`【最近对话】\n${lines.join("\n")}`);
    }
    parts.push(`[用户消息]\n${text}`);
    // After the history on purpose. Earlier replies that invented a broken
    // channel would otherwise outrank a rule placed above them.
    const deckRule = deckDeliveryRule([text, ...history.map((entry) => entry.text)].join("\n"));
    if (deckRule.length > 0) parts.push(deckRule);
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
