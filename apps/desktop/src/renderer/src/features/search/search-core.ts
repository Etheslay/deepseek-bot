/**
 * Global search core (D25, renderer-first index): builds and filters the
 * searchable index from UI state. The host-side retrieval replaces the
 * index source later; filtering semantics stay.
 */
export type SearchItem = {
  id: string;
  kind: "bot" | "message" | "action";
  /** Primary match text (bot name, message excerpt, action label). */
  title: string;
  /** Secondary text (group name, bot name for messages, hint). */
  subtitle?: string;
  /** Payload: bot key for bots/messages, action id for actions. */
  botKey?: number;
  action?: "settings" | "monitor" | "workflow";
  time?: number;
};

export function buildSearchIndex(input: {
  bots: { key: number; name: string; group: string }[];
  messages: { botKey: number; botName: string; text: string; time: number }[];
  actions: SearchItem[];
}): SearchItem[] {
  const bots: SearchItem[] = input.bots.map((bot) => ({
    id: `bot-${bot.key}`,
    kind: "bot",
    title: bot.name,
    subtitle: bot.group,
    botKey: bot.key,
  }));
  const messages: SearchItem[] = input.messages.map((msg, index) => ({
    id: `msg-${msg.botKey}-${index}-${msg.time}`,
    kind: "message",
    title: msg.text.length > 60 ? `${msg.text.slice(0, 60)}…` : msg.text,
    subtitle: msg.botName,
    botKey: msg.botKey,
    time: msg.time,
  }));
  return [...bots, ...input.actions, ...messages];
}

/** Case-insensitive substring over title and subtitle; empty query → []. */
export function filterSearch(items: SearchItem[], query: string): SearchItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) ||
      (item.subtitle?.toLowerCase().includes(needle) ?? false),
  );
}

export const SEARCH_KIND_LABELS: Record<SearchItem["kind"], string> = {
  bot: "Bot",
  message: "消息",
  action: "快速操作",
};
