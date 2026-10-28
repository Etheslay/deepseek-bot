// @vitest-environment jsdom
/**
 * Chat failure copy: out of credit must not read like "the model is down",
 * because the two ask for different actions from the user.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { failureMessage } from "../../src/renderer/src/features/chat/chat-reducer.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

beforeEach(() => {
  setLanguagePreference("zh");
});

afterEach(() => {
  setLanguagePreference("zh");
});

describe("failureMessage", () => {
  it("tells the user the balance or quota is exhausted, and that retrying is pointless", () => {
    const text = failureMessage("BUDGET_EXCEEDED");
    expect(text).toContain("余额不足");
    expect(text).toContain("额度");
    expect(text).toContain("充值");
    expect(text).toContain("重试不会有结果");
  });

  it("does not reuse the model-unavailable copy for an empty account", () => {
    expect(failureMessage("BUDGET_EXCEEDED")).not.toBe(failureMessage("MODEL_UNAVAILABLE"));
  });

  it("keeps the other codes on their own copy", () => {
    expect(failureMessage("RATE_LIMITED")).toContain("过于频繁");
    expect(failureMessage("AUTH_FAILED")).toContain("认证失败");
    expect(failureMessage("CANCELLED")).toContain("已取消");
  });

  it("follows the language switch", () => {
    setLanguagePreference("en");
    expect(failureMessage("BUDGET_EXCEEDED")).toContain("balance or quota is exhausted");
  });
});
