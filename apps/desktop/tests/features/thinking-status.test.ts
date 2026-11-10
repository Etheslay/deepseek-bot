// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ELAPSED_HINT_AFTER_MS,
  formatElapsed,
  thinkingStatus,
} from "../../src/renderer/src/features/chat/thinking-status.js";

import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

/* The assertions below quote Chinese copy; pin the language instead of inheriting
   the machine locale (D22 routes this copy through the catalogue). */
setLanguagePreference("zh");

const at = (stage: "preparing" | "thinking" | "tool", elapsedMs = 0, toolName?: string) =>
  thinkingStatus({ stage, ...(toolName !== undefined ? { toolName } : {}), elapsedMs, hasText: false });

describe("thinkingStatus", () => {
  it("names the real turn stage, never a clock-driven guess", () => {
    expect(at("preparing")?.text).toBe("正在准备");
    expect(at("thinking")?.text).toBe("正在深度思考");
  });

  it("says it is reading a file while a document turn has not started talking", () => {
    expect(
      thinkingStatus({ stage: "thinking", elapsedMs: 0, hasText: false, readingFile: true })?.text,
    ).toBe("正在读取文件");
  });

  it("says it is writing a document or converting to PDF", () => {
    expect(
      thinkingStatus({
        stage: "preparing",
        elapsedMs: 0,
        hasText: false,
        makingDocument: true,
      })?.text,
    ).toBe("制作文档");
    expect(at("tool", 0, "edit_document")?.text).toBe("制作文档");
    expect(
      thinkingStatus({
        stage: "tool",
        toolName: "edit_document",
        elapsedMs: 0,
        hasText: false,
        convertingToPdf: true,
      })?.text,
    ).toBe("转换成 PDF");
  });

  it("says it is making a presentation for that turn or that tool", () => {
    expect(
      thinkingStatus({
        stage: "preparing",
        elapsedMs: 0,
        hasText: false,
        makingPresentation: true,
      })?.text,
    ).toBe("制作演示文稿");
    expect(at("thinking", 0, "write_presentation")?.text).toBe("制作演示文稿");
    expect(at("tool", 0, "write_presentation")?.text).toBe("制作演示文稿");
  });

  it("names the tool while a real tool/call is in flight", () => {
    expect(at("tool", 0, "write")?.text).toBe("正在调用 write");
  });

  it("falls back to the thinking copy when the tool name is missing", () => {
    expect(at("tool", 0)?.text).toBe("正在深度思考");
    expect(at("tool", 0, "")?.text).toBe("正在深度思考");
  });

  it("hides once the reply text starts arriving", () => {
    expect(
      thinkingStatus({ stage: "thinking", elapsedMs: 3_000, hasText: true }),
    ).toBeNull();
  });

  it("shows the elapsed hint only after the threshold", () => {
    expect(at("thinking", ELAPSED_HINT_AFTER_MS - 1)?.hint).toBeNull();
    expect(at("thinking", ELAPSED_HINT_AFTER_MS)?.hint).toBe("10s");
    expect(at("thinking", 12_900)?.hint).toBe("12s");
  });

  it("keeps the sentence free of the ticking seconds", () => {
    const status = at("thinking", 65_000);
    expect(status?.text).toBe("正在深度思考");
    expect(status?.text).not.toContain("65");
  });
});

describe("formatElapsed", () => {
  it("floors to whole seconds and never goes negative", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(9_999)).toBe("9s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
