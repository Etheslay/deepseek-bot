import { describe, expect, it } from "vitest";
import { ATTACHMENT_CHUNK_RAW_BYTES } from "@deepseek-bot/contracts";
import {
  attachmentAccept,
  attachmentMediaType,
  buildAttachmentContext,
  classifyAttachment,
  composeAttachmentPrompt,
  encodeBase64,
  formatAttachmentSize,
  splitAttachmentChunks,
} from "../../src/renderer/src/features/chat/attachments.js";

describe("chat attachments", () => {
  it("classifies by mime and extension", () => {
    expect(classifyAttachment("image/png", "shot.png")).toBe("image");
    expect(classifyAttachment("text/plain", "notes.txt")).toBe("text");
    expect(classifyAttachment("application/octet-stream", "data.bin")).toBe("binary");
    expect(classifyAttachment("", "script.ts")).toBe("text");
  });

  it("formats sizes in human units", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatAttachmentSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("points the model at the workspace path and does not splice the file body", () => {
    const body = "```code\nhello secret-body";
    const context = buildAttachmentContext({
      name: "notes.md",
      size: 10,
      relativePath: "attachments/notes.md",
    });
    expect(context).toContain("【附件 notes.md · 10 B · attachments/notes.md】");
    expect(context).toContain("read");
    expect(context).not.toContain(body);
    expect(context).not.toContain("secret-body");
    const fenced = buildAttachmentContext({
      name: "```name.md",
      size: 1,
      relativePath: "attachments/```name.md",
    });
    expect(fenced).not.toContain("```name");
    expect(fenced).toContain("``\u200b`name");
  });

  it("keeps the workspace pointer when the user text fills the chat limit", () => {
    const pointer = buildAttachmentContext({
      name: "notes.md",
      size: 4,
      relativePath: "attachments/notes.md",
    });
    const prompt = composeAttachmentPrompt("x".repeat(5000), [pointer]);
    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt).toContain("attachments/notes.md");
    expect(prompt.endsWith(pointer)).toBe(true);
  });

  it("splits bytes on the contract chunk size and round-trips base64", () => {
    const bytes = new Uint8Array(ATTACHMENT_CHUNK_RAW_BYTES + 3);
    bytes[0] = 1;
    bytes[bytes.length - 1] = 2;
    const chunks = splitAttachmentChunks(bytes);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(ATTACHMENT_CHUNK_RAW_BYTES);
    expect(encodeBase64(Uint8Array.from([1, 2, 3]))).toBe("AQID");
  });

  it("falls back to a contract media type when the picker mime is empty", () => {
    expect(attachmentMediaType("", "notes.md")).toBe("text/markdown");
    expect(attachmentMediaType("image/png", "shot.png")).toBe("image/png");
    expect(attachmentMediaType("", "blob.bin")).toBe("application/octet-stream");
  });

  it("accept list covers text and images", () => {
    const accept = attachmentAccept();
    expect(accept).toContain(".md");
    expect(accept).toContain("image/*");
  });
});
