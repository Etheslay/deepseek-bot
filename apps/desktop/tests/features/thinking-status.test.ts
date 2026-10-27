// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ELAPSED_HINT_AFTER_MS,
  MAX_SUMMARY_CHARS,
  formatElapsed,
  summarizeRequest,
  thinkingStatus,
} from "../../src/renderer/src/features/chat/thinking-status.js";

import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

/* The assertions below quote Chinese copy; pin the language instead of inheriting
   the machine locale (D22 routes this copy through the catalogue). */
setLanguagePreference("zh");

const noHint = (request: string): string | null =>
  thinkingStatus({ request, elapsedMs: 0, hasText: false })?.text ?? null;

describe("thinkingStatus", () => {
  it("maps each intent family to its own copy", () => {
    expect(noHint("帮我起草一个工作流")).toBe("正在起草工作流");
    expect(noHint("搜一下这个库的用法")).toBe("正在查资料");
    expect(noHint("翻一下之前的笔记")).toBe("正在翻记忆");
    expect(noHint("这段代码为什么会报错")).toBe("正在读代码");
    expect(noHint("帮我检查一下这份改动")).toBe("正在评审");
    expect(noHint("设计一个方案")).toBe("正在拟定方案");
    expect(noHint("把这份文档整理成周报")).toBe("正在整理内容");
  });

  it("takes the first matching intent when several would fire", () => {
    // 工作流 sits above 代码/文档 in the table.
    expect(noHint("按这个文档起草工作流代码")).toBe("正在起草工作流");
  });

  it("echoes the request when no intent matches", () => {
    expect(noHint("你怎么看")).toBe("正在处理「你怎么看」");
  });

  it("truncates a long request to the cap plus an ellipsis", () => {
    const long = "很".repeat(MAX_SUMMARY_CHARS + 8);
    const text = noHint(long) ?? "";
    expect(text.startsWith("正在处理「")).toBe(true);
    expect(text).toContain("…");
    // Exactly the cap is kept; "…」" is the ellipsis plus the closing bracket.
    expect(text.slice("正在处理「".length, -"…」".length)).toHaveLength(
      MAX_SUMMARY_CHARS,
    );
  });

  it("drops mentions and collapses whitespace in the echo", () => {
    expect(noHint("@设计师   你看这个   怎么样")).toBe("正在处理「你看这个 怎么样」");
  });

  it("falls back to a bare ellipsis for a blank request", () => {
    expect(noHint("   ")).toBe("正在处理…");
    expect(noHint("@设计师")).toBe("正在处理…");
  });

  it("hides once the reply text starts arriving", () => {
    expect(
      thinkingStatus({ request: "帮我起草工作流", elapsedMs: 3_000, hasText: true }),
    ).toBeNull();
  });

  it("shows the elapsed hint only after the threshold", () => {
    const before = thinkingStatus({
      request: "帮我起草工作流",
      elapsedMs: ELAPSED_HINT_AFTER_MS - 1,
      hasText: false,
    });
    expect(before?.hint).toBeNull();
    const after = thinkingStatus({
      request: "帮我起草工作流",
      elapsedMs: ELAPSED_HINT_AFTER_MS,
      hasText: false,
    });
    expect(after?.hint).toBe("10s");
    const later = thinkingStatus({
      request: "帮我起草工作流",
      elapsedMs: 12_900,
      hasText: false,
    });
    expect(later?.hint).toBe("12s");
  });

  it("keeps the sentence free of the ticking seconds", () => {
    const status = thinkingStatus({
      request: "帮我起草工作流",
      elapsedMs: 65_000,
      hasText: false,
    });
    expect(status?.text).toBe("正在起草工作流");
    expect(status?.text).not.toContain("65");
  });
});

describe("summarizeRequest", () => {
  it("returns an empty string for blank input", () => {
    expect(summarizeRequest("   ")).toBe("");
  });

  it("keeps a short request verbatim", () => {
    expect(summarizeRequest(" 你怎么看 ")).toBe("你怎么看");
  });
});

describe("formatElapsed", () => {
  it("floors to whole seconds and never goes negative", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(9_999)).toBe("9s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
