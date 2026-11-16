import { mkdirSync, mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deliveredFilesFromTool, officeFilesWrittenSince } from "./delivered-files.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-delivered-"));
  roots.push(root);
  return root;
}

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

describe("officeFilesWrittenSince", () => {
  it("keeps office files this turn wrote and leaves older files, uploads, and html alone", () => {
    const root = workspace();
    const since = Date.now();
    mkdirSync(join(root, "career-deck"));
    mkdirSync(join(root, "attachments"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "career-deck", "plan.pptx"), Buffer.from("PK-pptx"));
    writeFileSync(join(root, "成绩.xlsx"), Buffer.from("PK-xlsx"));
    writeFileSync(join(root, "career-deck", "index.html"), Buffer.from("<html></html>"));
    writeFileSync(join(root, "attachments", "mine.pdf"), Buffer.from("pdf"));
    writeFileSync(join(root, "node_modules", "lib.docx"), Buffer.from("docx"));
    writeFileSync(join(root, "old.pdf"), Buffer.from("old"));
    const past = new Date(since - 60_000);
    utimesSync(join(root, "old.pdf"), past, past);
    writeFileSync(join(root, "huge.docx"), Buffer.from("x"));
    truncateSync(join(root, "huge.docx"), 8 * 1024 * 1024 + 1);

    const files = officeFilesWrittenSince(root, since, [], false);
    expect(files.map((file) => file.path).sort()).toEqual(["career-deck/plan.pptx", "成绩.xlsx"]);
    expect(files.find((file) => file.name === "成绩.xlsx")?.format).toBe("xlsx");
  });

  it("attaches a new html page only when a document was asked for and no office file exists", () => {
    const root = workspace();
    const since = Date.now();
    mkdirSync(join(root, "career-deck"));
    writeFileSync(join(root, "career-deck", "index.html"), Buffer.from("<html></html>"));
    expect(officeFilesWrittenSince(root, since, [], false)).toEqual([]);
    expect(officeFilesWrittenSince(root, since, [], true)).toEqual([
      {
        path: "career-deck/index.html",
        name: "index.html",
        bytes: Buffer.from("<html></html>").length,
        format: "html",
      },
    ]);
    writeFileSync(join(root, "career-deck", "plan.pptx"), Buffer.from("PK"));
    expect(officeFilesWrittenSince(root, since, [], true).map((file) => file.format)).toEqual(["pptx"]);
  });

  it("does not repeat a file the tool already recorded", () => {
    const root = workspace();
    const since = Date.now();
    writeFileSync(join(root, "plan.pptx"), Buffer.from("PK"));
    const already = [{ path: "plan.pptx", name: "plan.pptx", bytes: 2, format: "pptx" as const }];
    expect(officeFilesWrittenSince(root, since, already, true)).toEqual([]);
  });
});
