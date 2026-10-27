// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ELAPSED_HINT_AFTER_MS,
  MAX_SUMMARY_CHARS,
  PHASE_ADVANCE_MS,
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

  it("keeps the announced sentence stable and free of the ticking seconds", () => {
    const status = thinkingStatus({
      request: "帮我起草工作流",
      elapsedMs: 65_000,
      hasText: false,
    });
    expect(status?.announce).toBe("正在起草工作流");
    expect(status?.announce).not.toContain("65");
    // Long waits sit on the held final phase, not on the opening sentence.
    expect(status?.text).toBe("正在完成");
  });
});

describe("phase ladder", () => {
  const at = (request: string, elapsedMs: number) =>
    thinkingStatus({ request, elapsedMs, hasText: false });

  it("opens with the task-aware copy, then advances one phase per step", () => {
    expect(at("你好", 0)?.text).toBe("正在处理「你好」");
    expect(at("你好", PHASE_ADVANCE_MS - 1)?.text).toBe("正在处理「你好」");
    expect(at("你好", PHASE_ADVANCE_MS)?.text).toBe("正在深度思考");
    expect(at("你好", PHASE_ADVANCE_MS * 2)?.text).toBe("正在查阅文档");
    expect(at("你好", PHASE_ADVANCE_MS * 3)?.text).toBe("正在完成");
  });

  it("holds the final phase instead of looping", () => {
    expect(at("你好", PHASE_ADVANCE_MS * 9)?.text).toBe("正在完成");
  });

  it("keeps the announcement stable across phases", () => {
    const first = at("你好", 0);
    const last = at("你好", PHASE_ADVANCE_MS * 9);
    expect(first?.announce).toBe(last?.announce);
    expect(first?.text).not.toBe(last?.text);
  });

  it("advances phases for intent copies too", () => {
    expect(at("帮我起草工作流", 0)?.text).toBe("正在起草工作流");
    expect(at("帮我起草工作流", PHASE_ADVANCE_MS)?.text).toBe("正在深度思考");
  });

  it("keeps the elapsed hint while the phases run", () => {
    const status = at("你好", ELAPSED_HINT_AFTER_MS + 500);
    expect(status?.text).toBe("正在完成");
    expect(status?.hint).toBe("10s");
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
