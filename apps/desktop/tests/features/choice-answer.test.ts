import { describe, expect, it } from "vitest";
import { answerSeedCard } from "../../src/renderer/src/features/questions/choice-answer.js";

type Card = {
  id: number;
  text: string;
  choices?: { question: string; answered?: string };
};

const messages: Card[] = [
  { id: 1, text: "问候" },
  { id: 1.5, text: "想先试哪种能力？", choices: { question: "想先试哪种能力？" } },
  { id: 2, text: "后续消息" },
];

describe("answerSeedCard", () => {
  it("marks only the matching card as answered", () => {
    const next = answerSeedCard(messages, 1.5, "帮我起草一个工作流");
    expect(next[1]?.choices?.answered).toBe("帮我起草一个工作流");
    expect(next[0]).toBe(messages[0]);
    expect(next[2]).toBe(messages[2]);
  });

  it("keeps the rest of the message intact", () => {
    const next = answerSeedCard(messages, 1.5, "B");
    expect(next[1]?.text).toBe("想先试哪种能力？");
    expect(next[1]?.choices?.question).toBe("想先试哪种能力？");
  });

  it("never mutates the input array or its messages", () => {
    const before = JSON.stringify(messages);
    answerSeedCard(messages, 1.5, "B");
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("ignores an id that has no card", () => {
    const next = answerSeedCard(messages, 2, "B");
    expect(next).toEqual(messages);
  });

  it("overwrites a previous answer (idempotent for retries)", () => {
    const once = answerSeedCard(messages, 1.5, "A");
    const twice = answerSeedCard(once, 1.5, "B");
    expect(twice[1]?.choices?.answered).toBe("B");
  });

  it("returns an empty array unchanged", () => {
    expect(answerSeedCard([], 1, "A")).toEqual([]);
  });
});
