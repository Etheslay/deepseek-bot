import { describe, expect, it } from "vitest";
import { deliverToLiveTurn } from "../../src/renderer/src/features/chat/live-turn-send.js";

describe("deliverToLiveTurn", () => {
  it("hands the line to the turn that is already answering", async () => {
    await expect(deliverToLiveTurn(async () => true)).resolves.toBe("queued");
  });

  it("starts a turn when the host says nothing is in progress", async () => {
    await expect(deliverToLiveTurn(async () => false)).resolves.toBe("start");
  });

  it("does not replace the live turn when the host rejects the follow-up", async () => {
    await expect(
      deliverToLiveTurn(async () => {
        throw new Error("this bot is already answering; wait for the current turn to finish");
      }),
    ).resolves.toBe("keep");
  });
});
