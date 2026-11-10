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

  it("draws metrics, a table, a column chart, and speaker notes", () => {
    const pptx = buildPptx([
      { layout: "metrics", title: "结果", metrics: [{ value: "42%", label: "完成" }, { value: "3", label: "风险" }] },
      { layout: "table", title: "对照表", headers: ["项", "值"], rows: [["甲", "1"]] },
      {
        layout: "chart",
        title: "趋势",
        categories: ["一季", "二季"],
        series: [{ name: "收入", values: [12, 18] }],
        notes: "先讲同比",
      },
    ]);
    const entries = unzipSync(pptx);
    expect(extractPptxBody(pptx).text).toContain("42%");
    expect(extractPptxBody(pptx).text).toContain("甲");
    expect(new TextDecoder().decode(entries["ppt/charts/chart3.xml"])).toContain("一季");
    expect(new TextDecoder().decode(entries["ppt/charts/chart3.xml"])).toContain(">18<");
    expect(new TextDecoder().decode(entries["ppt/notesSlides/notesSlide3.xml"])).toContain("先讲同比");
    expect(entries["ppt/notesMasters/notesMaster1.xml"]).toBeDefined();
  });

  it("renders a table, chart, and figures into a PDF", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppt-rich-"));
    roots.push(root);
    const written = await writePresentationAt(
      root,
      "attachments/数据.pptx",
      [
        { layout: "table", title: "对照表", headers: ["项", "值"], rows: [["甲", "1"]] },
        {
          layout: "chart",
          title: "趋势",
          categories: ["一季", "二季"],
          series: [{ name: "收入", values: [12, 18] }],
        },
      ],
      "attachments/数据.pdf",
    );
    const body = await extractPdfBody(readFileSync(join(root, written.pdfPath ?? "")), { aborted: false });
    expect(body.text).toContain("对照表");
    expect(body.text).toContain("甲");
    expect(body.text).toContain("一季");
    expect(body.text).toContain("收入");
    expect(body.pages).toBeGreaterThanOrEqual(2);
  }, 60_000);

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
