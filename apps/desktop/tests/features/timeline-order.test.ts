import { describe, expect, it } from "vitest";
import {
  messageSlotOrder,
  pinSlotOrder,
  streamSlotOrder,
} from "../../src/renderer/src/features/chat/timeline.js";

describe("timeline slot order", () => {
  const times = [1_000, 2_000, 3_000];

  it("keeps a pin between the message it followed and later messages", () => {
    expect(pinSlotOrder(times, 1_000)).toBe(messageSlotOrder(0) + 1);
    expect(pinSlotOrder(times, 1_500)).toBe(messageSlotOrder(0) + 1);
    expect(pinSlotOrder(times, 2_000)).toBe(messageSlotOrder(1) + 1);
    expect(pinSlotOrder(times, 4_000)).toBe(messageSlotOrder(2) + 1);
    expect(streamSlotOrder(times.length)).toBeGreaterThan(pinSlotOrder(times, 4_000));
  });

  it("leaves a pin that predates the thread above the first message", () => {
    expect(pinSlotOrder(times, 500)).toBeLessThan(messageSlotOrder(0));
  });

  it("does not move an older pin when a later message is appended", () => {
    const older = pinSlotOrder(times, 1_500);
    const withReply = pinSlotOrder([...times, 5_000], 1_500);
    expect(withReply).toBe(older);
    expect(messageSlotOrder(3)).toBeGreaterThan(withReply);
  });
});
