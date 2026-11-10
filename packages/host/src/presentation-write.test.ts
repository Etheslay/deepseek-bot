import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { extractPdfBody, extractPptxBody } from "./attachment-parse.js";
import { buildPptx, writePresentationAt } from "./presentation-write.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("write_presentation bytes", () => {
  it("round-trips Chinese slide text in slide order", () => {
    const pptx = buildPptx([
      { title: "封面&标题", bullets: ["第一点"] },
      { title: "第二页", bullets: ["要点"] },
    ]);
    const entries = unzipSync(pptx);
    expect(entries["ppt/slides/slide1.xml"]).toBeDefined();
    expect(entries["ppt/slides/slide2.xml"]).toBeDefined();
    expect(entries["[Content_Types].xml"]).toBeDefined();
    expect(extractPptxBody(pptx).text).toBe("封面&标题\n第一点\n\n第二页\n要点");
    expect(extractPptxBody(pptx).pages).toBe(2);
  });

  it("keeps cover, split, and quote text, and paints the cover dark", () => {
    const pptx = buildPptx([
      { layout: "cover", kicker: "季度", title: "封面", subtitle: "一句话" },
      {
        layout: "split",
        title: "对照",
        left: { title: "现在", bullets: ["甲"] },
        right: { title: "之后", bullets: ["乙"] },
      },
      { layout: "quote", title: "结语", quote: "把一件事说完", attribution: "记录" },
    ]);
    expect(extractPptxBody(pptx).text).toBe(
      "季度\n封面\n一句话\n\n对照\n现在\n甲\n之后\n乙\n\n结语\n把一件事说完\n记录",
    );
    const slide = new TextDecoder().decode(unzipSync(pptx)["ppt/slides/slide1.xml"]);
    expect(slide).toContain("1C1917");
    expect(slide).toContain("C2410C");
  });

  it("also writes a PDF of the deck", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppt-pdf-"));
    roots.push(root);
    const written = await writePresentationAt(
      root,
      "attachments/演示.pptx",
      [{ layout: "cover", title: "你好封面", subtitle: "副标题" }],
      "attachments/演示.pdf",
    );
    expect(written.pdfPath).toBe("attachments/演示.pdf");
    const body = await extractPdfBody(readFileSync(join(root, written.pdfPath ?? "")), { aborted: false });
    expect(body.text).toContain("你好封面");
  }, 60_000);

  it("writes inside the workspace and refuses a path that escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppt-write-"));
    roots.push(root);
    const written = await writePresentationAt(root, "attachments/演示.pptx", [
      { title: "只有标题" },
    ]);
    expect(written).toMatchObject({ path: "attachments/演示.pptx", format: "pptx", slides: 1 });
    expect(written.bytes).toBeGreaterThan(0);
    await expect(writePresentationAt(root, "../escape.pptx", [{ title: "no" }])).rejects.toThrow(
      /workspace|path/i,
    );
    await expect(writePresentationAt(root, "attachments/notes.docx", [{ title: "no" }])).rejects.toThrow(
      /pptx/i,
    );
  });
});
