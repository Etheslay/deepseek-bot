import { describe, expect, it } from "vitest";
import {
  attachmentAccept,
  buildAttachmentContext,
  classifyAttachment,
  formatAttachmentSize,
  MAX_TEXT_CONTEXT_CHARS,
} from "../../src/renderer/src/features/chat/attachments.js";

describe("chat attachments", () => {
  it("classifies by mime and extension", () => {
    expect(classifyAttachment("image/png", "shot.png")).toBe("image");
    expect(classifyAttachment("text/plain", "notes.txt")).toBe("text");
    expect(classifyAttachment("application/octet-stream", "data.bin")).toBe("binary");
    // extension fallback when the mime is generic
    expect(classifyAttachment("", "script.ts")).toBe("text");
  });

  it("formats sizes in human units", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatAttachmentSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("builds a bounded, fence-safe context block", () => {
    const context = buildAttachmentContext({
      name: "notes.md",
      size: 10,
      mime: "text/markdown",
      text: "```code\nhello",
    });
    expect(context).toContain("【附件 notes.md · 10 B】");
    // inner fences are defanged so the block cannot be broken out of
    expect(context).not.toContain("```code");
    expect(context).toContain("``\u200b`code");
  });

  it("truncates oversized text context", () => {
    const context = buildAttachmentContext({
      name: "big.txt",
      size: 999999,
      mime: "text/plain",
      text: "x".repeat(MAX_TEXT_CONTEXT_CHARS + 500),
    });
    expect(context.length).toBeLessThan(MAX_TEXT_CONTEXT_CHARS + 200);
  });

  it("accept list covers text and images", () => {
    const accept = attachmentAccept();
    expect(accept).toContain(".md");
    expect(accept).toContain("image/*");
  });
});
