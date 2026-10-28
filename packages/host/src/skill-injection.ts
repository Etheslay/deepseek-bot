/**
 * Inject a saved skill into one chat turn (D17).
 *
 * The renderer still owns the library. chat.send carries the snapshot for
 * this turn only; nothing here is written to the skill library.
 */
import type { CapabilityId, ChatSkillInjection } from "@deepseek-bot/contracts";
import { MAX_CHAT_SKILL_INSTRUCTIONS } from "@deepseek-bot/contracts";

/** Union of declared capability ids. Empty means the turn does not narrow tools. */
export function skillCapabilityAllowlist(
  skills: readonly ChatSkillInjection[],
): readonly CapabilityId[] | undefined {
  const ids: CapabilityId[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    for (const id of skill.capabilities) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids.length === 0 ? undefined : ids;
}

/** Longest run of backticks, so the fence can outgrow the skill text. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    if (char === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * Bounded, fence-safe skill block. Same shape the renderer used to prepend,
 * now composed by the Host so the stored user message stays the user's text.
 */
export function composeSkillBlock(skills: readonly ChatSkillInjection[]): string {
  if (skills.length === 0) return "";
  const body = skills
    .map((skill) => `### ${skill.name}（v${skill.version}）\n${skill.instructions}`)
    .join("\n\n");
  const capped =
    body.length > MAX_CHAT_SKILL_INSTRUCTIONS
      ? // Model-facing context, not interface copy.
        `${body.slice(0, MAX_CHAT_SKILL_INSTRUCTIONS)}\n…（技能上下文已截断）`
      : body;
  const fence = "`".repeat(Math.max(3, longestBacktickRun(capped) + 1));
  return [
    `已为该 bot 启用 ${skills.length} 个技能（按绑定顺序）：`,
    fence,
    capped,
    fence,
  ].join("\n");
}
