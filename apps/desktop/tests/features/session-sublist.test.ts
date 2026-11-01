/**
 * Open-defects §2.3: the session sub-list may only be cleared when the
 * selected bot actually changes. An unrelated visible-bots update (create,
 * hide, reorder — a new array identity) must keep the current list and
 * refresh in place; a failed in-place refresh keeps the old list instead of
 * overwriting it with an empty array.
 */
import { describe, expect, it } from "vitest";
import { planSessionSublistRefresh } from "../../src/renderer/src/features/chat/session-sublist.js";

describe("planSessionSublistRefresh", () => {
  it("keeps the list when the selected bot is unchanged", () => {
    expect(planSessionSublistRefresh(1, 1)).toBe("refresh-in-place");
  });

  it("clears when the selected bot changes", () => {
    expect(planSessionSublistRefresh(1, 2)).toBe("clear-then-load");
  });

  it("clears on the first load with a selected bot", () => {
    expect(planSessionSublistRefresh(null, 1)).toBe("clear-then-load");
  });

  it("keeps the list while the selection stays empty", () => {
    expect(planSessionSublistRefresh(null, null)).toBe("refresh-in-place");
  });

  it("clears when the selection is dropped", () => {
    expect(planSessionSublistRefresh(1, null)).toBe("clear-then-load");
  });
});
