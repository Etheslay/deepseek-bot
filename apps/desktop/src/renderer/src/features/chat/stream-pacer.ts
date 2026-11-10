/**
 * Reply pacing for chat bubbles (adaptive replay).
 *
 * The live chat path does not use this. Dripping a finished segment sentence
 * by sentence left a half-written line on screen while the turn was still
 * going, and that pause read as a freeze. Segments are spoken whole; this
 * module stays for a caller that really does have to replay a long text.
 *
 * The Host answers `chat.send` with the whole reply text, so the renderer has
 * nothing incremental to forward — whatever we show is a replay. Emitting that
 * replay in one tick (the old behaviour: `reply.match(/[\s\S]{1,32}/g)` in a
 * synchronous loop) renders the entire answer at once, which is why replies
 * "popped" instead of streaming.
 *
 * This module decides how the replay is sliced and how fast it advances, with
 * the same goals hosted agents optimise for: short answers read at a natural
 * pace, long answers must not make the reader wait for a typewriter. Hence:
 *
 * - short text (≤2 lines, ≤140 chars): sentence-sized chunks;
 * - long text: one line per tick (line-by-line streaming, the shape people know
 *   from long model answers), with very short lines merged so a wall of
 *   one-word lines does not stutter;
 * - the interval is derived from the length — a target replay duration is
 *   spread over the chunks and clamped, so long replies advance at the 12 ms
 *   floor (visibly fast) while short replies keep a 40–120 ms beat.
 *
 * Pure on purpose: when the Host eventually streams real deltas, only the
 * caller changes — the slicing/interval rules stay testable here.
 */
export type PaceMode = "sentence" | "line";

export type PacePlan = {
  /** Chunks to emit in order; concatenating them yields the original text. */
  readonly chunks: readonly string[];
  /** Delay between two chunks (the first one is emitted immediately). */
  readonly intervalMs: number;
  readonly mode: PaceMode;
  /** Upper bound on how long the whole replay is expected to take. */
  readonly expectedMs: number;
};

/** Below this size the reply reads better as sentences than as lines. */
export const SHORT_REPLY_MAX_CHARS = 140;
export const SHORT_REPLY_MAX_LINES = 2;
/** A reply should finish replaying within this window. */
export const REPLAY_MIN_MS = 800;
export const REPLAY_MAX_MS = 7_000;
/** Per-character budget used to derive the target duration. */
export const REPLAY_MS_PER_CHAR = 6;
export const REPLAY_BASE_MS = 600;
/** Fastest acceptable beat: long replies advance at this floor. */
export const MIN_INTERVAL_MS = 12;
/** Slowest acceptable beat: keeps short replies from feeling sluggish. */
export const MAX_INTERVAL_MS = 120;
/** Lines shorter than this are merged with the following one while slicing. */
export const MIN_LINE_CHARS = 24;
/**
 * A single line longer than this is split further: a wall of text without line
 * breaks would otherwise arrive in one chunk and not stream at all.
 */
export const MAX_CHUNK_CHARS = 240;

/** Split one over-long line at sentence marks, falling back to a hard cut. */
function splitLongLine(line: string): string[] {
  if (line.length <= MAX_CHUNK_CHARS) {
    return [line];
  }
  const out: string[] = [];
  let rest = line;
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    const boundary = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("；"),
      window.lastIndexOf(". "),
      window.lastIndexOf(";"),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
      window.lastIndexOf("，"),
    );
    const cut = boundary > MIN_LINE_CHARS ? boundary + 1 : MAX_CHUNK_CHARS;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) {
    out.push(rest);
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Sentence-ish boundaries, keeping the terminator with its sentence. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const boundary = /[。！？!?；;\n]/g;
  for (let match = boundary.exec(text); match !== null; match = boundary.exec(text)) {
    const end = match.index + match[0].length;
    const piece = text.slice(start, end);
    if (piece.length > 0) {
      out.push(piece);
    }
    start = end;
  }
  if (start < text.length) {
    out.push(text.slice(start));
  }
  return out.length > 0 ? out : [text];
}

/**
 * One chunk per line. Lines stay whole (that is the point of line-by-line
 * streaming); only a run of very short lines is merged so the replay does not
 * flicker. Concatenation always reproduces the input.
 */
function splitLines(text: string): string[] {
  const lines = text.split(/(?<=\n)/);
  const out: string[] = [];
  let pending = "";
  for (const line of lines) {
    pending += line;
    if (pending.length >= MIN_LINE_CHARS) {
      out.push(...splitLongLine(pending));
      pending = "";
    }
  }
  if (pending.length > 0) {
    out.push(...splitLongLine(pending));
  }
  return out.length > 0 ? out : [text];
}

export function planPacing(text: string): PacePlan {
  if (text.length === 0) {
    return { chunks: [""], intervalMs: MIN_INTERVAL_MS, mode: "sentence", expectedMs: 0 };
  }
  const lineCount = text.split("\n").length;
  const short = text.length <= SHORT_REPLY_MAX_CHARS && lineCount <= SHORT_REPLY_MAX_LINES;
  const mode: PaceMode = short ? "sentence" : "line";
  const chunks = short ? splitSentences(text) : splitLines(text);
  const target = clamp(
    REPLAY_BASE_MS + text.length * REPLAY_MS_PER_CHAR,
    REPLAY_MIN_MS,
    REPLAY_MAX_MS,
  );
  /**
   * Emitting every chunk on its own tick would exceed the replay window once the
   * count passes `target / MIN_INTERVAL_MS` (a 4000-line answer). Group that many
   * chunks per tick so a very long reply streams faster instead of longer — the
   * same trade long model answers make.
   */
  const maxTicks = Math.max(1, Math.floor(target / MIN_INTERVAL_MS));
  const perTick = Math.max(1, Math.ceil(chunks.length / maxTicks));
  const groups: string[] = [];
  for (let index = 0; index < chunks.length; index += perTick) {
    groups.push(chunks.slice(index, index + perTick).join(""));
  }
  const intervalMs = clamp(target / groups.length, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  return {
    chunks: groups,
    intervalMs,
    mode,
    expectedMs: Math.round(intervalMs * Math.max(0, groups.length - 1)),
  };
}
