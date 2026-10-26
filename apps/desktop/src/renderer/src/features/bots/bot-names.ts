/**
 * Name suggestions for new bots.
 *
 * A pre-filled field is only helpful if the value is *usable as is*. A fixed
 * placeholder ("DeepSeek Bot") forces the user to edit it before every create;
 * a numbered name lets them press Enter and rename later from the sidebar. The
 * scheme is Bot01, Bot02, … — the first number not already in use, so deleting
 * Bot02 offers Bot02 again before Bot05.
 */
export function nextBotName(existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `Bot${String(n).padStart(2, "0")}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  // Absurdly many bots: fall back to something unique rather than looping.
  return `Bot${Date.now()}`;
}
