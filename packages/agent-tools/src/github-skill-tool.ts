/**
 * The first step when someone asks for a deck: look on GitHub, do not invent slides.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const FindGithubSkillInputSchema = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export interface FoundSkill {
  readonly name: string;
  readonly url: string;
  readonly instructions: string;
  readonly cached?: boolean;
}

export interface GithubSkillFinder {
  find(query: string | undefined, signal?: AbortSignal): Promise<FoundSkill> | FoundSkill;
}

function requireBot(context: ToolContext): void {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "skill search is not bound to a bot");
  }
}

export function bindFindGithubSkillTool(
  finder: GithubSkillFinder,
): ToolCapability<typeof FindGithubSkillInputSchema> {
  return {
    name: "find_github_skill",
    description:
      "Search GitHub for an agent skill and return its instructions. Use this when the user " +
      "asks to learn or look up a skill. A deck is still written with write_presentation ir; " +
      "do not turn a skill into coordinates or a script. The first call searches GitHub and " +
      "saves the skill. Later calls return the saved skill and do not use the network.",
    inputSchema: FindGithubSkillInputSchema,
    async handler(params, context) {
      requireBot(context);
      try {
        const found = await finder.find(params.query, context.signal);
        return {
          ...found,
          next: found.cached
            ? "This skill is already saved. Do not search GitHub again. A deck still uses " +
              "write_presentation ir. Do not invent coordinates."
            : "Saved for next time. A deck still uses write_presentation ir. Do not invent coordinates.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub skill search failed";
        throw new ToolRejectionError("RUNTIME_UNAVAILABLE", message);
      }
    },
  };
}
