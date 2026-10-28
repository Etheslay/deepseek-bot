/**
 * Global search core (D25): the renderer-first index (loaded bots, the open
 * session's messages, quick actions) plus the D25-second-half Host hits
 * (`search.global`): the host retrieval sees every persisted corpus the
 * renderer index cannot, and its hits map onto the same item shape here.
 */
import { t } from "../../i18n.js";
import type { GlobalSearchHitView } from "../../services/desktop-service.js";

export type { GlobalSearchHitView };

export type SearchItem = {
  id: string;
  kind: "bot" | "message" | "action" | "workflow" | "artifact";
  /** Primary match text (bot name, message excerpt, action label, path). */
  title: string;
  /** Secondary text (group name, bot name for messages, snippet, hint). */
  subtitle?: string;
  /** Payload: bot key for bots/messages, action id for actions. */
  botKey?: number;
  /** Bot uuid: local bot/message items and every Host hit carry it. */
  botId?: string;
  /** Artifact relative path (Host artifact hits). */
  path?: string;
  action?: "settings" | "monitor" | "workflow";
  time?: number;
};

export function buildSearchIndex(input: {
  bots: { key: number; id: string; name: string; group: string }[];
  messages: { botKey: number; botId: string; botName: string; text: string; time: number }[];
  actions: SearchItem[];
}): SearchItem[] {
  const bots: SearchItem[] = input.bots.map((bot) => ({
    id: `bot-${bot.key}`,
    kind: "bot",
    title: bot.name,
    subtitle: bot.group,
    botKey: bot.key,
    botId: bot.id,
  }));
  const messages: SearchItem[] = input.messages.map((msg, index) => ({
    id: `msg-${msg.botKey}-${index}-${msg.time}`,
    kind: "message",
    title: msg.text.length > 60 ? `${msg.text.slice(0, 60)}…` : msg.text,
    subtitle: msg.botName,
    botKey: msg.botKey,
    botId: msg.botId,
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

/**
 * Map contract-shaped Host hits onto search items. A message hit carries the
 * bot name as its title and the bounded excerpt as the snippet; an artifact
 * hit's title is the workspace-relative path (never an absolute path).
 */
export function remoteHitsToItems(hits: readonly GlobalSearchHitView[]): SearchItem[] {
  return hits.map((hit) => ({
    id: `host-${hit.kind}-${hit.id}`,
    kind: hit.kind,
    title: hit.title,
    ...(hit.snippet !== null ? { subtitle: hit.snippet } : {}),
    ...(hit.botId !== null ? { botId: hit.botId } : {}),
    ...(hit.kind === "artifact" ? { path: hit.title } : {}),
    ...(hit.at !== null && !Number.isNaN(Date.parse(hit.at)) ? { time: Date.parse(hit.at) } : {}),
  }));
}

/**
 * Drop Host bot hits that duplicate a local bot item (same uuid): the local
 * entry navigates identically and keeps its group subtitle. Messages,
 * artifacts and workflows exist only in the Host corpus and are never deduped.
 */
export function dedupeHostItems(local: readonly SearchItem[], host: readonly SearchItem[]): SearchItem[] {
  const localBotIds = new Set(
    local.filter((item) => item.kind === "bot" && item.botId !== undefined).map((item) => item.botId),
  );
  return host.filter((item) => !(item.kind === "bot" && item.botId !== undefined && localBotIds.has(item.botId)));
}

/**
 * Kind chips are rendered copy, so the labels are read from the live catalogue
 * rather than frozen in a module constant (D22).
 */
export function searchKindLabels(): Record<SearchItem["kind"], string> {
  return {
    bot: "Bot",
    message: t("search.kindMessage"),
    action: t("search.kindAction"),
    workflow: t("search.kindWorkflow"),
    artifact: t("search.kindArtifact"),
  };
}
