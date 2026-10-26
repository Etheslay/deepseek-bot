/**
 * Inline @mentions (D14 interaction slice): after the markdown pipeline has
 * produced sanitized HTML, known bot names mentioned as `@Name` become
 * clickable chips. Only names present in the mention table are linked —
 * arbitrary text starting with @ stays plain. The chip itself is
 * constructed here from the (already-escaped) name, so no untrusted HTML
 * is introduced; longest names match first so prefixes cannot shadow.
 */
export type MentionTarget = {
  botKey: number;
  color: string;
};

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
        out += `<button type="button" class="mention-chip" data-mention="${escapeHtml(
          name,
        )}" data-bot-key="${target.botKey}" style="--mention-color:${target.color}">@${escapeHtml(
          name,
        )}</button>`;
        i += match[0].length - 1;
        cursor = i + 1;
      }
    }
  }
  out += html.slice(cursor);
  return out;
}
