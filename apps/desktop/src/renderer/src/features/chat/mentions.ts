/**
 * Inline @mentions (D14 interaction slice): after the markdown pipeline has
 * produced sanitized HTML, a known bot name becomes a clickable chip,
 * with or without `@`. Only names in the mention table are linked.
 * The chip renders as the bot's
 * mini avatar + name (owner request 2026-10-26: no `@` glyph), built here
 * from already-escaped data so no untrusted HTML is introduced; longest
 * names match first so prefixes cannot shadow.
 */
import {
  GROK_BALL_SHAPES,
  contourPath,
  sampleContour,
  type GrokBallShapeId,
} from "../avatars/grok-ball-model.js";
import { bubbleInk } from "../avatars/avatar-meta.js";
export type MentionTarget = {
  botKey: number;
  color: string;
  shape: GrokBallShapeId;
};

const ballCache = new Map<GrokBallShapeId, string>();

function ballPath(shape: GrokBallShapeId): string {
  let path = ballCache.get(shape);
  if (path === undefined) {
    path = contourPath(sampleContour(GROK_BALL_SHAPES[shape].points, 48));
    ballCache.set(shape, path);
  }
  return path;
}

export type MentionTable = Map<string, MentionTarget>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** CJK next to a name still counts as a boundary. Latin letters do not. */
function isNameBoundary(char: string | undefined): boolean {
  if (char === undefined) {
    return true;
  }
  return !/[A-Za-z0-9_]/.test(char);
}

/**
 * Rewrite mentions inside a sanitized HTML string. The naive global regex
 * would also hit tag internals, so walk the string and skip anything that
 * looks like a tag (`<...>`); mention chips themselves carry data-mention
 * and are skipped on later passes by construction (no `@` inside).
 */
export function linkMentions(html: string, mentions: MentionTable): string {
  if (mentions.size === 0) {
    return html;
  }
  const names = [...mentions.keys()].sort((a, b) => b.length - a.length);

  let out = "";
  let cursor = 0;
  let insideTag = false;
  for (let i = 0; i < html.length; i += 1) {
    const char = html[i]!;
    if (char === "<") {
      insideTag = true;
    } else if (char === ">") {
      insideTag = false;
    }
    if (insideTag || !isNameBoundary(html[i - 1])) {
      continue;
    }
    const quoted = char === "@";
    const start = quoted ? i + 1 : i;
    const rest = html.slice(start);
    const name = names.find(
      (candidate) => rest.startsWith(candidate) && isNameBoundary(rest[candidate.length]),
    );
    if (name === undefined) {
      continue;
    }
    const target = mentions.get(name)!;
    out += html.slice(cursor, i);
    const eye = bubbleInk(target.color);
    out +=
      `<button type="button" class="mention-chip" data-mention="${escapeHtml(name)}" ` +
      `data-bot-key="${target.botKey}" style="--mention-color:${target.color}">` +
      `<svg class="mention-ball" viewBox="0 0 100 100" aria-hidden="true">` +
      `<path d="${ballPath(target.shape)}" style="fill:${target.color}"/>` +
      `<circle cx="40" cy="48" r="6.5" style="fill:${eye}"/>` +
      `<circle cx="60" cy="48" r="6.5" style="fill:${eye}"/>` +
      `</svg>${escapeHtml(name)}</button>`;
    i = start + name.length - 1;
    cursor = i + 1;
  }
  out += html.slice(cursor);
  return out;
}
