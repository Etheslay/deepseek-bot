import { describe, expect, it } from "vitest";
import {
  dismissFresh,
  isNearBottom,
  jumpMode,
  noteArrival,
  pinToLatest,
  type JumpState,
} from "../../src/renderer/src/features/chat/jump-latest.js";

const clear: JumpState = { unseen: 0, dismissed: 0 };

describe("isNearBottom", () => {
  it("treats a gap under 80px as the latest line", () => {
    expect(isNearBottom(1000, 821, 100)).toBe(true);
    expect(isNearBottom(1000, 820, 100)).toBe(false);
  });
});

describe("noteArrival", () => {
  it("does not count growth while the reader is pinned to the latest line", () => {
    expect(noteArrival(clear, 3, 5, true)).toEqual(clear);
  });

  it("counts messages that arrive while older lines are on screen", () => {
    expect(noteArrival(clear, 4, 6, false)).toEqual({ unseen: 2, dismissed: 0 });
  });

  it("returns a count when a live row is replaced by its stored copy", () => {
    expect(noteArrival({ unseen: 2, dismissed: 0 }, 6, 5, false)).toEqual({
      unseen: 1,
      dismissed: 0,
    });
  });

  it("keeps a dismissed pill down until a further message arrives", () => {
    const dismissed = dismissFresh({ unseen: 2, dismissed: 0 });
    expect(jumpMode(true, dismissed)).toBe("arrow");
    const more = noteArrival(dismissed, 6, 7, false);
    expect(more).toEqual({ unseen: 3, dismissed: 2 });
    expect(jumpMode(true, more)).toBe("fresh");
  });
});

describe("jumpMode", () => {
  it("hides both controls on the latest line", () => {
    expect(jumpMode(false, { unseen: 4, dismissed: 0 })).toBe("hidden");
  });

  it("shows the arrow while reading history with nothing new", () => {
    expect(jumpMode(true, clear)).toBe("arrow");
  });

  it("shows the fresh-message count ahead of the arrow", () => {
    expect(jumpMode(true, { unseen: 2, dismissed: 0 })).toBe("fresh");
  });
});

describe("pinToLatest", () => {
  it("clears the tally", () => {
    expect(pinToLatest()).toEqual(clear);
  });
});
