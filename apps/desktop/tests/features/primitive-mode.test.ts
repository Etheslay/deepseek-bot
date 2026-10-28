import { describe, expect, it } from "vitest";
import {
  loadPrimitiveModes,
  setPrimitiveMode,
} from "../../src/renderer/src/features/chat/primitive-mode.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getLength: 0,
    length: 0,
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: () => null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => map.set(key, value),
  };
}

describe("primitive mode store", () => {
  it("reads an absent or corrupt shelf as all-off", () => {
    expect(loadPrimitiveModes(memoryStorage())).toEqual({});
    expect(loadPrimitiveModes(memoryStorage({ "deepseek-bot.primitive-mode.v1": "{broken" }))).toEqual({});
    expect(
      loadPrimitiveModes(memoryStorage({ "deepseek-bot.primitive-mode.v1": JSON.stringify([1, 2]) })),
    ).toEqual({});
  });

  it("enables one bot, keeps others off, and persists only enabled entries", () => {
    const storage = memoryStorage();
    const botA = "11111111-1111-4111-8111-111111111111";
    const botB = "22222222-2222-4222-8222-222222222222";

    const afterOn = setPrimitiveMode(storage, botA, true);
    expect(afterOn[botA]).toBe(true);
    expect(JSON.parse(storage.getItem("deepseek-bot.primitive-mode.v1") as string)).toEqual({
      [botA]: true,
    });

    // A fresh read sees the persisted choice.
    expect(loadPrimitiveModes(storage)[botA]).toBe(true);
    expect(loadPrimitiveModes(storage)[botB]).toBeUndefined();

    // Turning it off removes the entry instead of storing false.
    const afterOff = setPrimitiveMode(storage, botA, false);
    expect(afterOff[botA]).toBeUndefined();
    expect(loadPrimitiveModes(storage)).toEqual({});
  });

  it("tolerates non-boolean junk in the shelf", () => {
    const storage = memoryStorage({
      "deepseek-bot.primitive-mode.v1": JSON.stringify({
        "33333333-3333-4333-8333-333333333333": "yes",
        "44444444-4444-4444-8444-444444444444": true,
      }),
    });
    expect(loadPrimitiveModes(storage)).toEqual({
      "44444444-4444-4444-8444-444444444444": true,
    });
  });
});
