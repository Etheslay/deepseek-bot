/**
 * Skills the calling bot learns in conversation.
 *
 * The person can paste a skill or ask the bot to find one. The bot saves
 * the instructions and binds them to itself. Settings stay optional.
 */
import { z } from "zod";
import { TEXT_LIMITS } from "@deepseek-bot/contracts";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const LearnSkillInputSchema = z
  .object({
    name: z.string().trim().min(1).max(TEXT_LIMITS.name),
    instructions: z.string().trim().min(1).max(4_000),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

export const ListSkillsInputSchema = z.object({}).strict();

export interface LearnedSkillView {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly description?: string;
}

export interface SkillLearnStore {
  learn(
    botId: string,
    input: { name: string; instructions: string; description?: string },
  ): { created: boolean; skill: LearnedSkillView } | Promise<{
    created: boolean;
    skill: LearnedSkillView;
  }>;
  list(botId: string): readonly LearnedSkillView[] | Promise<readonly LearnedSkillView[]>;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "skill caller is not bound to a bot");
  }
  return botId;
}

export function bindSkillTools(store: SkillLearnStore): [
  ToolCapability<typeof LearnSkillInputSchema>,
  ToolCapability<typeof ListSkillsInputSchema>,
] {
  return [
    {
      name: "learn_skill",
      description:
        "Learn a skill for this bot and use it on later turns. Call this when the person " +
        "asks you to learn, study, or install a skill, or pastes / attaches a skill for you " +
        "to learn. If they ask you to find one, call web_search first, then save the useful " +
        "procedure here in your own words or in the text they supplied. Do not tell them to " +
        "open Settings or create a skill by hand. name is a short title. instructions are " +
        "what you will follow later, at most 4000 characters. Learning adds instructions " +
        "only; it does not grant new computer permissions. The same name updates the skill " +
        "you already have instead of adding a second copy.",
      inputSchema: LearnSkillInputSchema,
      async handler(params, context) {
        return store.learn(requireBot(context), {
          name: params.name,
          instructions: params.instructions,
          ...(params.description !== undefined ? { description: params.description } : {}),
        });
      },
    },
    {
      name: "list_skills",
      description:
        "List the skills this bot has learned: name, version, and description. Read-only. " +
        "Use it when the person asks what you already know.",
      inputSchema: ListSkillsInputSchema,
      async handler(_params, context) {
        return { skills: await store.list(requireBot(context)) };
      },
    },
  ];
}
