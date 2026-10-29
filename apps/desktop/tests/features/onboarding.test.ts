import { describe, expect, it } from "vitest";
import { onboardingCardFor } from "../../src/renderer/src/features/bots/onboarding.js";
import {
  answerSeedCard,
  canAnswerChoice,
  findPendingChoiceCard,
} from "../../src/renderer/src/features/questions/choice-answer.js";

describe("onboarding card derivation (对标学习)", () => {
  it("derives design directions from a design-flavored name", () => {
    const card = onboardingCardFor("designer", "zh");
    expect(card.question).toBe("你最想我先帮你做什么？");
    expect(card.greeting).toContain("designer");
    expect(card.options.map((option) => option.label)).toEqual([
      "平面/视觉设计",
      "海报、配图与排版",
      "先随便聊聊再定",
      "我自己说",
    ]);
    expect(card.options.map((option) => option.id)).toEqual(["A", "B", "C", "D"]);
    expect(card.other).toBe(true);
  });

  it("matches latin stems case-insensitively and switches language", () => {
    const card = onboardingCardFor("CodeMonkey", "en");
    expect(card.options[0]?.label).toBe("Writing and fixing code");
    expect(card.greeting).toContain("CodeMonkey");
    expect(card.question).toBe("What should I focus on first?");
  });

  it("falls back to generic directions when the name gives no hint", () => {
    const card = onboardingCardFor("小助手7号", "zh");
    expect(card.options.map((option) => option.label)).toEqual([
      "资料调研与整理",
      "写作与润色",
      "任务拆解与规划",
      "先随便聊聊再定",
      "我自己说",
    ]);
  });

  it("keeps at most five options with 我自己说 always last", () => {
    // A name that matches many families at once (learn + plan + manage).
    const card = onboardingCardFor("学习计划管家", "zh");
    expect(card.options.length).toBeLessThanOrEqual(5);
    expect(card.options[card.options.length - 1]?.label).toBe("我自己说");
    expect(card.options.some((option) => option.label === "先随便聊聊再定")).toBe(true);
  });
});

describe("retiring a pending seed card with free text (对标学习)", () => {
  const openCard = {
    id: 7,
    from: "bot",
    choices: {
      question: "你最想我先帮你做什么？",
      options: [{ id: "A", label: "平面/视觉设计" }],
      answered: undefined,
    },
  };
  const userLine = { id: 8, from: "user", text: "帮我盯学习计划" };

  it("finds the latest open card in the thread", () => {
    const pending = findPendingChoiceCard([openCard, userLine]);
    expect(pending?.id).toBe(7);
  });

  it("ignores threads without an open card", () => {
    const answered = { ...openCard, choices: { ...openCard.choices, answered: "我自己说" } };
    expect(findPendingChoiceCard([answered, userLine])).toBeUndefined();
    expect(findPendingChoiceCard([])).toBeUndefined();
  });

  it("dims the card by marking the free text as its answer", () => {
    type ThreadMessage = {
      id: number;
      from: string;
      text?: string;
      choices?: {
        question: string;
        options: { id: string; label: string }[];
        answered?: string | undefined;
      };
    };
    const thread = answerSeedCard<ThreadMessage>([openCard, userLine], 7, "帮我盯学习计划");
    const card = thread.find((message) => message.id === 7);
    expect(card?.choices?.answered).toBe("帮我盯学习计划");
    // Retired: canAnswerChoice flips off, so the card never nags again.
    expect(canAnswerChoice(card ?? { id: 7, from: "bot" })).toBe(false);
    expect(findPendingChoiceCard(thread)).toBeUndefined();
  });
});
