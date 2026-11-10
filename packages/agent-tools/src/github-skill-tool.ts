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
      "Return the PowerPoint skill, then follow it. When the user asks for a PPT, slides, " +
      "a deck, or a presentation, call this before write_presentation. The first call searches " +
      "GitHub and saves the skill on this machine. Later calls return that saved skill and do " +
      "not use the network. Do not hand-write the deck. query describes the task, for example " +
      "\"powerpoint pptx\". Follow the instructions, then call write_presentation with a " +
      "pptxgenjs script. The host provides pres and saves the file.",
    inputSchema: FindGithubSkillInputSchema,
    async handler(params, context) {
      requireBot(context);
      try {
        const found = await finder.find(params.query, context.signal);
        return {
          ...found,
          next: found.cached
            ? "This skill is already saved. Do not search GitHub again. Follow it and call " +
              "write_presentation with a pptxgenjs script that uses pres. pres.layout is already " +
              "LAYOUT_WIDE (13.3 by 7.5 inches). Do not import, require, or write the file yourself."
            : "Saved for the next deck. Follow this skill and call write_presentation with a " +
              "pptxgenjs script that uses pres. pres.layout is already LAYOUT_WIDE (13.3 by 7.5 " +
              "inches). Do not import, require, or write the file yourself.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub skill search failed";
        throw new ToolRejectionError("RUNTIME_UNAVAILABLE", message);
      }
    },
  };
}
