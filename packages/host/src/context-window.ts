/**
 * Context window resolution for the chat meter (the `chat.contextUsage`
 * denominator and the ≥80% compression trigger).
 *
 * Precedence, highest first:
 *  1. `DSB_CONTEXT_WINDOW_TOKENS` — debug-only override; a valid value is a
 *     decimal safe integer in (0, 1_000_000]. Anything else is ignored.
 *  2. the bot's model profile `model` in `MODEL_CONTEXT_WINDOWS`.
 *  3. the host's fallback denominator (constructor option ?? 65_536).
 *
 * The result is computed per call — nothing is cached in settings or module
 * state — so a table edit shows up on the next `chat.contextUsage` read.
 */
export const CONTEXT_WINDOW_ENV_VAR = "DSB_CONTEXT_WINDOW_TOKENS";
/** Ceiling for the debug env override; also rejects obvious nonsense (9999999). */
export const MAX_ENV_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 65_536;

/**
 * Per-model context window in tokens. Values must match the provider's
 * documented window: claiming more than the model accepts makes the meter
 * under-report and lets a request overflow at the API layer. Keys are model
 * names that actually occur in this repository. Sources: api-docs.deepseek.com
 * — the DeepSeek-V3.1 release note states a 128K context for `deepseek-chat`
 * (non-thinking) and `deepseek-reasoner` (thinking) on the API; verified
 * 2026-10-30. The Models & Pricing page states "CONTEXT LENGTH 1M" (max
 * output 384K) for `deepseek-flash` on a row shared with deepseek-v4-pro;
 * verified 2026-11-01 — that page no longer lists chat/reasoner, whose
 * entries keep the V3.1 citation. New models: only add a key once the
 * provider doc states its window — unknown names fall back instead of
 * guessing.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek-chat": 128_000,
  "deepseek-reasoner": 128_000,
  "deepseek-flash": 1_000_000,
};

/**
 * Read the debug override from `env`. Returns null when the variable is
 * absent or not a plain decimal safe integer inside (0, 1_000_000] — an
 * invalid value must fall through the normal resolution, never produce a
 * NaN or zero denominator.
 */
export function readEnvContextWindowTokens(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[CONTEXT_WINDOW_ENV_VAR];
  if (raw === undefined) return null;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_ENV_CONTEXT_WINDOW_TOKENS) {
    return null;
  }
  return parsed;
}

export interface ContextWindowInput {
  /** The bot's model profile model name; null when unresolvable. */
  readonly model: string | null | undefined;
  /** Host fallback denominator (constructor option ?? 65_536). */
  readonly fallbackTokens: number;
  /** Pre-read env value; defaults to reading process.env at call time. */
  readonly envTokens?: number | null;
}

/** Resolve one context window per the precedence above. */
export function resolveContextWindowTokens(input: ContextWindowInput): number {
  const envTokens =
    input.envTokens === undefined ? readEnvContextWindowTokens() : input.envTokens;
  if (envTokens !== null) return envTokens;
  if (input.model !== null && input.model !== undefined) {
    const fromTable = MODEL_CONTEXT_WINDOWS[input.model];
    if (fromTable !== undefined) return fromTable;
  }
  return input.fallbackTokens;
}

/** Provider error phrasings that mean "the request overran the context". */
const CONTEXT_OVERFLOW_PATTERN = /context length|maximum context|too many tokens/i;

/** True when a provider error message says the request exceeded the context. */
export function isContextOverflowMessage(message: string): boolean {
  return CONTEXT_OVERFLOW_PATTERN.test(message);
}

/**
 * Safety net: when the provider rejects a turn for exceeding its context, the
 * configured window is probably larger than what the model actually accepts.
 * Log one warn line with the tokens we know about — never adjust the window
 * here, the mismatch is for a human (or the table) to fix.
 */
export function reportContextOverflow(
  error: unknown,
  info: {
    botId: string;
    model: string | null;
    windowTokens: number;
    lastInputTokens: number | null;
  },
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!isContextOverflowMessage(message)) return;
  process.stderr.write(
    `[host] warn: provider reported a context overflow for bot ${info.botId} ` +
      `(model ${info.model ?? "unknown"}): last recorded input tokens ` +
      `${info.lastInputTokens ?? "unknown"}, meter windowTokens ${info.windowTokens} — ` +
      `the configured window may exceed what the model actually accepts. Detail: ${message}\n`,
  );
}
