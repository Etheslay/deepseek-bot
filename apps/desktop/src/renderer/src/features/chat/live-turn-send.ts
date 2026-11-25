/**
 * What to do with a line typed while this bot's turn is still on screen.
 * `queued` — the live turn took it. `start` — nothing is in progress, so a
 * new turn is fine. `keep` — the host refused or could not take the line;
 * leave the draft and do not cancel the turn that is already answering.
 */
export type LiveTurnDelivery = "queued" | "start" | "keep";

export async function deliverToLiveTurn(aside: () => Promise<boolean>): Promise<LiveTurnDelivery> {
  try {
    return (await aside()) ? "queued" : "start";
  } catch {
    return "keep";
  }
}
