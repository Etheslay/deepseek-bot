/**
 * Token usage capture from harness session events.
 *
 * The harness reports per-turn usage inside its session events, but the exact
 * envelope has varied (snake_case `input_tokens`, camelCase `totalTokens`, and
 * cached-token details nested one level deeper), so this module reads
 * defensively: it walks the event's data for a usage-shaped object and picks the
 * counts it recognises. Anything it cannot find stays zero.
 *
 * A turn whose events never carried usage is recorded from a local estimate and
 * marked `estimated`, so the settings page can label it instead of presenting a
 * guess as billed usage.
 *
 * This lives in the adapter because the adapter owns the session-event wire
 * shape: both chat turns (live accumulator) and workflow node turns (events
 * collected by one `HarnessAttempt.runTurn`) read usage here.
 */
import type { SessionEventEnvelope } from "./harness-attempt.js";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  model: string | null;
}

const INPUT_KEYS = ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"] as const;
const OUTPUT_KEYS = ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"] as const;
const CACHED_KEYS = [
  "cache_read_input_tokens",
  "cacheReadInputTokens",
  "cached_input_tokens",
  "cachedInputTokens",
] as const;
const MODEL_KEYS = ["model", "modelId", "model_id"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCount(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.round(raw);
  }
  return null;
}

function readText(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

/** Find the usage object inside one event, if the event carries one. */
function usageRecord(event: SessionEventEnvelope): Record<string, unknown> | null {
  const data = asRecord(event.data);
  if (data === null) return null;
  const candidates = [data, asRecord(data.usage), asRecord(data.tokenUsage), asRecord(data.token_usage)];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    if (
      readCount(candidate, INPUT_KEYS) !== null ||
      readCount(candidate, OUTPUT_KEYS) !== null
    ) {
      return candidate;
    }
  }
  /* some frames carry the counts on the envelope itself */
  const direct = asRecord(event);
  if (direct !== null && (readCount(direct, INPUT_KEYS) !== null || readCount(direct, OUTPUT_KEYS) !== null)) {
    return direct;
  }
  return null;
}

/**
 * The model this turn should be billed to. A name the harness reported wins.
 * When the frame omitted it (or said "unknown"), the model the turn was
 * started with — the bot's profile, the same one a connection test uses —
 * is the name. Null only when neither side named one.
 */
export function resolveTurnModel(
  reported: string | null,
  requested: string | null | undefined,
): string | null {
  const named = reported?.trim() ?? "";
  if (named.length > 0 && named.toLowerCase() !== "unknown") return named;
  const fallback = requested?.trim() ?? "";
  return fallback.length > 0 ? fallback : null;
}

/** Usage carried by one event, or null when the event has none. */
export function extractUsageFromEvent(event: SessionEventEnvelope): TurnUsage | null {
  const record = usageRecord(event);
  if (record === null) return null;
  const inputTokens = readCount(record, INPUT_KEYS) ?? 0;
  const outputTokens = readCount(record, OUTPUT_KEYS) ?? 0;
  const cachedInputTokens = readCount(record, CACHED_KEYS) ?? 0;
  const model = readText(record, MODEL_KEYS);
  if (inputTokens === 0 && outputTokens === 0 && cachedInputTokens === 0) return null;
  return { inputTokens, outputTokens, cachedInputTokens, model };
}

/**
 * Rough count for a turn the harness did not report usage for, and the meter
 * numerator elsewhere. Weighted per UTF-16 code unit: ASCII (letters, digits,
 * common punctuation) ≈ 0.25 tokens per unit, CJK (han ideographs, kana,
 * Hangul syllables) ≈ 1.0, everything else (fullwidth punctuation, emoji,
 * other scripts) ≈ 0.5 — a surrogate pair therefore lands at 1.0, not 0.5.
 *
 * The scale is deliberately conservative: it must over-estimate rather than
 * under-estimate, because a low estimate lets the context meter trigger
 * compression too late and a request can overflow at the API layer. It can be
 * calibrated later against the provider tokenizer (real usage frames from chat
 * turns give counts to fit against); until then it stays on the high side.
 */
const ASCII_TOKEN_WEIGHT = 0.25;
const CJK_TOKEN_WEIGHT = 1.0;
const OTHER_TOKEN_WEIGHT = 0.5;

/** Token weight of one UTF-16 code unit; shared with slice-budget callers. */
export function tokenWeight(unit: number): number {
  if (unit < 0x80) return ASCII_TOKEN_WEIGHT;
  if (
    (unit >= 0x4e00 && unit <= 0x9fff) || // CJK unified ideographs
    (unit >= 0x3400 && unit <= 0x4dbf) || // CJK extension A
    (unit >= 0x3040 && unit <= 0x30ff) || // hiragana + katakana
    (unit >= 0xac00 && unit <= 0xd7af) // Hangul syllables
  ) {
    return CJK_TOKEN_WEIGHT;
  }
  return OTHER_TOKEN_WEIGHT;
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    total += tokenWeight(trimmed.charCodeAt(index));
  }
  return Math.max(1, Math.ceil(total));
}

/** Accumulates the usage events of one turn. */
export class TurnUsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedInputTokens = 0;
  private model: string | null = null;
  private seen = false;

  /** Feed one session event; returns true when it carried usage. */
  observe(event: SessionEventEnvelope): boolean {
    const usage = extractUsageFromEvent(event);
    if (usage === null) return false;
    this.seen = true;
    this.inputTokens = Math.max(this.inputTokens, usage.inputTokens);
    this.outputTokens = Math.max(this.outputTokens, usage.outputTokens);
    this.cachedInputTokens = Math.max(this.cachedInputTokens, usage.cachedInputTokens);
    if (usage.model !== null) this.model = usage.model;
    return true;
  }

  get hasUsage(): boolean {
    return this.seen;
  }

  /**
   * Final counts for the turn. When no event carried usage, it falls back to the
   * prompt/reply estimates and marks the result as estimated.
   */
  finish(prompt: string, reply: string): TurnUsage & { estimated: boolean } {
    if (this.seen) {
      return {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        cachedInputTokens: this.cachedInputTokens,
        model: this.model,
        estimated: false,
      };
    }
    return {
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(reply),
      cachedInputTokens: 0,
      model: this.model,
      estimated: true,
    };
  }
}
