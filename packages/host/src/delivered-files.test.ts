import { describe, expect, it } from "vitest";
import { deliveredFilesFromTool } from "./delivered-files.js";

describe("deliveredFilesFromTool", () => {
  it("records a presentation and its pdf, and ignores a second copy of the same path", () => {
    const files = deliveredFilesFromTool("write_presentation", {
      path: "attachments/xiaoxue-chengfa.pptx",
      bytes: 48128,
      format: "pptx",
      slides: 10,
      pdfPath: "attachments/xiaoxue-chengfa.pdf",
      pdfBytes: 12000,
    });
    expect(files).toEqual([
      {
        path: "attachments/xiaoxue-chengfa.pptx",
        name: "xiaoxue-chengfa.pptx",
        bytes: 48128,
        format: "pptx",
      },
      {
        path: "attachments/xiaoxue-chengfa.pdf",
        name: "xiaoxue-chengfa.pdf",
        bytes: 12000,
        format: "pdf",
      },
    ]);
  });

  it("records a document from outputPath and drops a read that has no bytes", () => {
    expect(
      deliveredFilesFromTool("edit_document", {
        action: "convert",
        path: "notes.md",
        outputPath: "notes.docx",
        format: "docx",
        bytes: 2048,
      }),
    ).toEqual([
      { path: "notes.docx", name: "notes.docx", bytes: 2048, format: "docx" },
    ]);
    expect(
      deliveredFilesFromTool("edit_document", {
        action: "read",
        path: "notes.docx",
        format: "docx",
        text: "hello",
      }),
    ).toEqual([]);
  });

  it("drops paths the card cannot open", () => {
    expect(
      deliveredFilesFromTool("write_document", {
        path: "notes.md",
        bytes: 12,
        format: "md",
      }),
    ).toEqual([]);
    expect(deliveredFilesFromTool("list_bots", { path: "a.pptx", bytes: 1 })).toEqual([]);
    expect(deliveredFilesFromTool("write_presentation", null)).toEqual([]);
  });
});
