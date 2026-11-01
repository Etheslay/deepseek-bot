/**
 * G12 session sub-list refresh semantics (open-defects §2.3).
 *
 * The sidebar's session sub-list loads in an effect whose dependencies
 * include the visible bots array. That array changes identity on unrelated
 * updates (create, hide, reorder); wiping the sub-list on those runs made
 * it flash empty and swallow clicks. Only a CHANGE of the selected bot may
 * clear first — the previous bot's sessions must never flash under the new
 * bot. Everything else refreshes in place, keeping the current list until
 * the fetch replaces it (a failed in-place refresh keeps the old list).
 */
export type SessionSublistRefresh = "clear-then-load" | "refresh-in-place";

export function planSessionSublistRefresh(
  previousBotKey: number | null,
  nextBotKey: number | null,
): SessionSublistRefresh {
  return previousBotKey === nextBotKey ? "refresh-in-place" : "clear-then-load";
}
