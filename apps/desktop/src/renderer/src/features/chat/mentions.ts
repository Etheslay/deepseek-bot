/**
 * Inline @mentions (D14 interaction slice): after the markdown pipeline has
 * produced sanitized HTML, known bot names mentioned as `@Name` become
 * clickable chips. Only names present in the mention table are linked —
 * arbitrary text starting with @ stays plain. The chip renders as the bot's
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  const pattern = new RegExp(
    `@(${names.map(escapeRegExp).join("|")})(?![\\w\\u4e00-\\u9fa5-])`,
    "g",
  );

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
    if (!insideTag && char === "@") {
      pattern.lastIndex = i;
      const match = pattern.exec(html);
      if (match && match.index === i) {
        const name = match[1]!;
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
        i += match[0].length - 1;
        cursor = i + 1;
      }
    }
  }
  out += html.slice(cursor);
  return out;
}
