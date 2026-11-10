import { describe, expect, it } from "vitest";
import { ATTACHMENT_CHUNK_RAW_BYTES } from "@deepseek-bot/contracts";
import {
  attachmentAccept,
  attachmentMediaType,
  buildAttachmentContext,
  bytesToBase64,
  classifyAttachment,
  composeAttachmentBlocks,
  DOCUMENT_ACK,
  documentOnlyReplyInstruction,
  formatFileCardSize,
  isAcceptedChatFile,
  splitDocumentAck,
  composeAttachmentPrompt,
  encodeBase64,
  formatAttachmentSize,
  MAX_TEXT_INLINE_BYTES,
  splitAttachmentChunks,
} from "../../src/renderer/src/features/chat/attachments.js";
import { fileCardTone } from "../../src/renderer/src/features/chat/file-card.js";

describe("chat attachments", () => {
  it("classifies by mime and extension", () => {
    expect(classifyAttachment("image/png", "shot.png")).toBe("image");
    expect(classifyAttachment("text/plain", "notes.txt")).toBe("text");
    expect(classifyAttachment("application/octet-stream", "data.bin")).toBe("binary");
    expect(classifyAttachment("", "script.ts")).toBe("text");
    expect(classifyAttachment("", "报告.pdf")).toBe("document");
    expect(classifyAttachment("", "笔记.docx")).toBe("document");
    expect(classifyAttachment("", "答辩.pptx")).toBe("document");
    expect(classifyAttachment("", "旧档.doc")).toBe("binary");
    expect(classifyAttachment("", "旧档.ppt")).toBe("binary");
    expect(isAcceptedChatFile("", "报告.pdf")).toBe(true);
    expect(isAcceptedChatFile("", "答辩.pptx")).toBe(true);
    expect(isAcceptedChatFile("", "旧档.doc")).toBe(false);
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

  it("accept list covers text, images, pdf and docx", () => {
    const accept = attachmentAccept();
    expect(accept).toContain(".md");
    expect(accept).toContain("image/*");
    expect(accept).toContain(".pdf");
    expect(accept).toContain(".docx");
    expect(accept).toContain(".pptx");
  });

  it("formats the file card size like 30 kB or 5.9 MB", () => {
    expect(formatFileCardSize(30 * 1024)).toBe("30 kB");
    expect(formatFileCardSize(Math.round(5.9 * 1024 * 1024))).toBe("5.9 MB");
  });

  it("colors Word blue, PowerPoint orange and PDF red", () => {
    expect(fileCardTone("笔记.docx")).toBe("word");
    expect(fileCardTone("答辩.pptx")).toBe("ppt");
    expect(fileCardTone("报告.pdf")).toBe("pdf");
  });

  it("tells a document-only turn to acknowledge, then summarize", () => {
    expect(documentOnlyReplyInstruction()).toContain(DOCUMENT_ACK);
    expect(splitDocumentAck(`${DOCUMENT_ACK}\n\n这是一份实验报告。`)).toEqual({
      ack: DOCUMENT_ACK,
      summary: "这是一份实验报告。",
    });
    expect(splitDocumentAck("普通回复")).toBeNull();
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
    const blocks = composeAttachmentBlocks(
      [
        { name: "shot.png", size: 4096, mime: "image/png", kind: "image", path: "attachments/shot.png" },
        { name: "data.bin", size: 99, mime: "application/octet-stream", kind: "binary", path: "attachments/data.bin" },
      ],
      "unregistered",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("未登记视觉能力");
    expect(blocks[0]).toContain("deepseek-flash");
    expect(blocks[1]).toContain("二进制");
    for (const block of blocks) {
      expect(block).not.toContain("```");
    }
  });

  it("tells a cataloged text-only model the image cannot be seen", () => {
    const [block] = composeAttachmentBlocks(
      [{ name: "shot.png", size: 4096, mime: "image/png", kind: "image", path: "attachments/shot.png" }],
      "text-only",
    );
    expect(block).toContain("无法看图");
    expect(block).toContain("attachments/shot.png");
  });

  it("announces ride-along images as delivered content blocks", () => {
    const [block] = composeAttachmentBlocks(
      [{ name: "shot.png", size: 4096, mime: "image/png", kind: "image", path: "attachments/shot.png" }],
      "ride-along",
    );
    expect(block).toContain("图像内容交给模型");
    expect(block).toContain("attachments/shot.png");
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
