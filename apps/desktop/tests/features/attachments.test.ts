import { describe, expect, it } from "vitest";
import {
  attachmentAccept,
  buildAttachmentContext,
  bytesToBase64,
  classifyAttachment,
  composeAttachmentBlocks,
  formatAttachmentSize,
  MAX_TEXT_CONTEXT_CHARS,
  MAX_TEXT_INLINE_BYTES,
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

  it("composes an inline block with the workspace path for small text", () => {
    const [block] = composeAttachmentBlocks([
      {
        name: "notes.md",
        size: 10,
        mime: "text/markdown",
        kind: "text",
        text: "hello world",
        path: "attachments/notes.md",
      },
    ]);
    expect(block).toContain("【附件 notes.md · 10 B · 工作区路径 attachments/notes.md】");
    expect(block).toContain("```\nhello world\n```");
  });

  it("keeps oversized text out of the message and points at the read tool", () => {
    const [block] = composeAttachmentBlocks([
      {
        name: "big.md",
        size: MAX_TEXT_INLINE_BYTES + 1,
        mime: "text/markdown",
        kind: "text",
        text: "secret-body-that-must-not-leak",
        path: "attachments/big.md",
      },
    ]);
    expect(block).not.toContain("secret-body-that-must-not-leak");
    expect(block).toContain("read_workspace_file");
    expect(block).toContain("attachments/big.md");
  });

  it("describes images and binaries by path without inline content", () => {
    const blocks = composeAttachmentBlocks([
      { name: "shot.png", size: 4096, mime: "image/png", kind: "image", path: "attachments/shot.png" },
      { name: "data.bin", size: 99, mime: "application/octet-stream", kind: "binary", path: "attachments/data.bin" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("视觉理解");
    expect(blocks[1]).toContain("二进制");
    for (const block of blocks) {
      expect(block).not.toContain("```");
    }
  });

  it("skips cards without an uploaded workspace path", () => {
    expect(
      composeAttachmentBlocks([{ name: "x.md", size: 1, mime: "text/markdown", kind: "text", text: "x" }]),
    ).toEqual([]);
  });

  it("encodes bytes as standard base64 in browser-safe chunks", () => {
    const bytes = new Uint8Array(200_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    const encoded = bytesToBase64(bytes);
    expect(encoded.length % 4).toBe(0);
    expect(Buffer.from(encoded, "base64")).toEqual(Buffer.from(bytes));
  });
});
