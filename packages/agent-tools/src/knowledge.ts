/**
 * Per-bot knowledge search tool. Read-only over the bot's own imported
 * documents; the model cannot name a bot, write or delete a doc. The
 * trusted caller.botId is the only owner this handler accepts.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const KnowledgeSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    limit: z.int().min(1).max(10).default(5),
  })
  .strict();

export interface KnowledgeSearchHit {
  readonly docId: string;
  readonly title: string;
  readonly score: number;
  readonly snippet: string;
  readonly at: string;
}

export interface KnowledgeStore {
  search(
    botId: string,
    query: string,
    limit: number,
  ): readonly KnowledgeSearchHit[] | Promise<readonly KnowledgeSearchHit[]>;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "knowledge caller is not bound to a bot");
  }
  return botId;
}

export function bindKnowledgeTools(
  store: KnowledgeStore,
): [ToolCapability<typeof KnowledgeSearchInputSchema>] {
  return [
    {
      name: "knowledge_search",
      description:
        "Search this bot's imported knowledge documents (long-form text the user imported). " +
        "Returns ranked snippets from this bot's documents only; other bots' knowledge is not " +
        "included, and there is no parameter for choosing a bot.",
      inputSchema: KnowledgeSearchInputSchema,
      async handler(params, context) {
        const hits = await store.search(requireBot(context), params.query, params.limit);
        return { hits: hits.map((hit) => ({ ...hit })) };
      },
    },
  ];
}
