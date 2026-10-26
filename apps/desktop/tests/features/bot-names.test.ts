import { describe, expect, it } from "vitest";
import { nextBotName } from "../../src/renderer/src/features/bots/bot-names.js";

describe("nextBotName", () => {
  it("starts at Bot01 on an empty list", () => {
    expect(nextBotName([])).toBe("Bot01");
  });

  it("counts up past the names already in use", () => {
    expect(nextBotName(["Bot01"])).toBe("Bot02");
    expect(nextBotName(["Bot01", "Bot02"])).toBe("Bot03");
    expect(nextBotName(["自定义", "Bot01", "Bot02", "Bot03"])).toBe("Bot04");
  });

  it("ignores case and surrounding spaces when deciding what is taken", () => {
    expect(nextBotName([" bot01 "])).toBe("Bot02");
    expect(nextBotName(["BOT01", "bot02"])).toBe("Bot03");
  });

  it("reuses a gap before running past it", () => {
    // Bot02 was deleted: offer it again rather than jumping to Bot04.
    expect(nextBotName(["Bot01", "Bot03"])).toBe("Bot02");
  });

  it("keeps growing past two digits without losing the prefix", () => {
    const taken = Array.from({ length: 99 }, (_, i) => `Bot${String(i + 1).padStart(2, "0")}`);
    expect(nextBotName(taken)).toBe("Bot100");
  });

  it("does not treat other bots' names as part of the sequence", () => {
    expect(nextBotName(["DeepSeek Bot", "card-preview", "e2e-bot"])).toBe("Bot01");
  });
});
