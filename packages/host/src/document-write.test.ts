import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractDocxBody, extractPdfBody } from "./attachment-parse.js";
import { buildDocx, buildPdf, writeDocumentAt } from "./document-write.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("write_document bytes", () => {
  it("round-trips Chinese through a docx the reader can open", () => {
    const body = extractDocxBody(buildDocx("你好\n第二段"));
    expect(body.text).toBe("你好\n第二段");
  });

  it("puts Chinese into a PDF text layer", async () => {
    const pdf = await buildPdf("你好 PDF");
    const body = await extractPdfBody(pdf, { aborted: false });
    expect(body.text).toContain("你好");
  }, 30_000);

  it("subsets a TrueType collection instead of failing createSubset", async () => {
    const ttc = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc";
    if (!existsSync(ttc)) return;
    const pdf = await buildPdf("你好", [readFileSync(ttc)]);
    const body = await extractPdfBody(pdf, { aborted: false });
    expect(body.text).toContain("你好");
  }, 30_000);

  it("writes inside the workspace and refuses a path that escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "doc-write-"));
    roots.push(root);
    const written = await writeDocumentAt(root, "attachments/报告.docx", "改写后");
    expect(written).toMatchObject({ path: "attachments/报告.docx", format: "docx" });
    expect(written.bytes).toBeGreaterThan(0);
    await expect(writeDocumentAt(root, "../escape.pdf", "no")).rejects.toThrow(/workspace|path/i);
  });
});
