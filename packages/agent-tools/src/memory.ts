/**
 * Per-bot memory tools. The model cannot name a bot or delete a note.
 * The trusted caller.botId is the only owner these handlers accept.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const MemoryWriteInputSchema = z
  .object({
    text: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const MemorySearchInputSchema = z
  .object({
    query: z.string().trim().max(4_000).optional(),
    limit: z.int().min(1).max(50).default(20),
  })
  .strict();

export interface MemoryRecord {
  readonly id: string;
  readonly text: string;
  readonly at: string;
}

export interface MemoryStore {
  write(botId: string, text: string): MemoryRecord | Promise<MemoryRecord>;
  search(
    botId: string,
    query: string,
    limit: number,
  ): readonly MemoryRecord[] | Promise<readonly MemoryRecord[]>;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "memory caller is not bound to a bot");
  }
  return botId;
}

export function bindMemoryTools(store: MemoryStore): [
  ToolCapability<typeof MemoryWriteInputSchema>,
  ToolCapability<typeof MemorySearchInputSchema>,
] {
  return [
    {
      name: "memory_write",
      description:
        "Save one private note for this bot. The note is not shared with other bots. There is no parameter for choosing a bot. " +
        "Write only what the user explicitly stated and will stay useful across conversations — a durable preference, " +
        "constraint or fact about them or this bot's setup (for example '记住：我喜欢简洁的中文回答'). Never write during " +
        "greetings or small talk, never while a clarifying question is still open, and never speculative guesses or " +
        "one-off task details. The write needs the user's approval first, so do not propose it lightly.",
      inputSchema: MemoryWriteInputSchema,
      async handler(params, context) {
        return store.write(requireBot(context), params.text);
      },
    },
    {
      name: "memory_search",
      description:
        "Search this bot's private notes. An empty query lists the newest notes. Notes from other bots are not included, and there is no parameter for choosing a bot.",
      inputSchema: MemorySearchInputSchema,
      async handler(params, context) {
        const memories = await store.search(requireBot(context), params.query ?? "", params.limit);
        return { memories: memories.map((row) => ({ id: row.id, text: row.text, at: row.at })) };
      },
    },
  ];
}
