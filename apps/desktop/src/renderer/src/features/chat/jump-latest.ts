/**
 * Chat jump controls.
 *
 * Reading older lines keeps the viewport where it is. A down arrow returns to
 * the latest line. Messages that arrive while the viewport is away show a
 * count instead; dismissing that count leaves the arrow until another
 * message arrives or the reader reaches the bottom.
 */

export const JUMP_NEAR_BOTTOM_PX = 80;

export interface JumpState {
  unseen: number;
  /** Unseen total at the last dismiss. The count pill stays hidden until unseen grows past it. */
  dismissed: number;
}

export type JumpMode = "hidden" | "arrow" | "fresh";

export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < JUMP_NEAR_BOTTOM_PX;
}

/** Fold a change in the live row count into the unseen tally. A pinned reader stays at zero. */
export function noteArrival(
  state: JumpState,
  previousCount: number,
  nextCount: number,
  pinned: boolean,
): JumpState {
  if (pinned) {
    return { unseen: 0, dismissed: 0 };
  }
  const delta = nextCount - previousCount;
  if (delta === 0) {
    return state;
  }
  const unseen = Math.max(0, state.unseen + delta);
  return { unseen, dismissed: Math.min(state.dismissed, unseen) };
}

export function jumpMode(awayFromBottom: boolean, state: JumpState): JumpMode {
  if (!awayFromBottom) {
    return "hidden";
  }
  if (state.unseen > state.dismissed) {
    return "fresh";
  }
  return "arrow";
}

export function dismissFresh(state: JumpState): JumpState {
  return { ...state, dismissed: state.unseen };
}

export function pinToLatest(): JumpState {
  return { unseen: 0, dismissed: 0 };
}
