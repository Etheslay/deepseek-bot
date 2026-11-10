import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractDocxBody, extractPdfBody } from "./attachment-parse.js";
import { editDocumentAt } from "./document-edit.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "doc-edit-"));
  roots.push(dir);
  return dir;
}

describe("edit_document", () => {
  it("creates, reads, appends, replaces, deletes text, and deletes the file", async () => {
    const dir = root();
    const created = await editDocumentAt(dir, {
      action: "create",
      path: "attachments/笔记.docx",
      text: "第一段\n要改的句子",
    });
    expect(created).toMatchObject({ action: "create", format: "docx" });
    expect(existsSync(join(dir, "attachments/笔记.docx"))).toBe(true);

    const read = await editDocumentAt(dir, { action: "read", path: "attachments/笔记.docx" });
    expect(read.text).toBe("第一段\n要改的句子");

    const found = await editDocumentAt(dir, {
      action: "read",
      path: "attachments/笔记.docx",
      find: "要改",
    });
    expect(found.text).toBe("要改的句子");
    expect(found.matches).toBe(1);

    const appended = await editDocumentAt(dir, {
      action: "append",
      path: "attachments/笔记.docx",
      text: "新增一段",
    });
    expect(appended.bytes).toBeGreaterThan(0);
    const afterAppend = await editDocumentAt(dir, { action: "read", path: "attachments/笔记.docx" });
    expect(afterAppend.text).toBe("第一段\n要改的句子\n新增一段");

    const replaced = await editDocumentAt(dir, {
      action: "replace",
      path: "attachments/笔记.docx",
      find: "要改的句子",
      text: "改后的句子",
    });
    expect(replaced.matches).toBe(1);

    const removed = await editDocumentAt(dir, {
      action: "delete_text",
      path: "attachments/笔记.docx",
      find: "新增一段",
    });
    expect(removed.matches).toBe(1);
    const afterDelete = await editDocumentAt(dir, { action: "read", path: "attachments/笔记.docx" });
    expect(afterDelete.text).toContain("改后的句子");
    expect(afterDelete.text).not.toContain("新增一段");

    await expect(
      editDocumentAt(dir, { action: "create", path: "attachments/笔记.docx", text: "again" }),
    ).rejects.toThrow(/exists/i);
    await expect(
      editDocumentAt(dir, { action: "replace", path: "attachments/笔记.docx", find: "没有", text: "x" }),
    ).rejects.toThrow(/not found/i);

    const deleted = await editDocumentAt(dir, { action: "delete_file", path: "attachments/笔记.docx" });
    expect(deleted.deleted).toBe(true);
    expect(existsSync(join(dir, "attachments/笔记.docx"))).toBe(false);
    await expect(editDocumentAt(dir, { action: "read", path: "attachments/笔记.docx" })).rejects.toThrow(
      /exist/i,
    );
    await expect(editDocumentAt(dir, { action: "delete_file", path: "../escape.docx" })).rejects.toThrow(
      /workspace|path/i,
    );
  });

  it("converts a Word file into a PDF and a PDF back into Word", async () => {
    const dir = root();
    await editDocumentAt(dir, {
      action: "create",
      path: "attachments/报告.docx",
      text: "你好，这是正文",
    });
    const pdf = await editDocumentAt(dir, {
      action: "convert",
      path: "attachments/报告.docx",
      to: "attachments/报告.pdf",
    });
    expect(pdf).toMatchObject({
      action: "convert",
      format: "pdf",
      outputPath: "attachments/报告.pdf",
    });
    expect(existsSync(join(dir, "attachments/报告.docx"))).toBe(true);
    const pdfBytes = readFileSync(join(dir, "attachments/报告.pdf"));
    const pdfText = await extractPdfBody(pdfBytes, { aborted: false });
    expect(pdfText.text).toContain("你好");

    const docx = await editDocumentAt(dir, {
      action: "convert",
      path: "attachments/报告.pdf",
      to: "attachments/报告-from-pdf.docx",
    });
    expect(docx.outputPath).toBe("attachments/报告-from-pdf.docx");
    const docxBytes = readFileSync(join(dir, "attachments/报告-from-pdf.docx"));
    expect(extractDocxBody(docxBytes).text).toContain("你好");
  }, 60_000);
});