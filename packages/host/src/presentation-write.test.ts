import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("round-trips Chinese slide text in slide order", async () => {
    const pptx = await buildPptx([
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

  it("keeps cover, split, and quote text, and paints the cover dark", async () => {
    const pptx = await buildPptx([
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
    expect(slide).not.toContain('cx="150000"');
  });

  it("draws an agenda, cards, steps, and a dark summary in one palette", async () => {
    const pptx = await buildPptx([
      { layout: "agenda", title: "目录", bullets: ["开场", "正文"] },
      { layout: "cards", title: "三块", cards: [{ title: "甲", text: "说明" }, { title: "乙", text: "另一" }] },
      { layout: "steps", title: "过程", bullets: ["收集", "整理", "交付"] },
      { layout: "summary", title: "记住", bullets: ["一件事"] },
    ], undefined, "harbor");
    expect(extractPptxBody(pptx).text).toBe(
      "目录\n1\n开场\n2\n正文\n\n三块\n甲\n说明\n乙\n另一\n\n过程\n1\n收集\n2\n整理\n3\n交付\n\n记住\n一件事",
    );
    const summary = new TextDecoder().decode(unzipSync(pptx)["ppt/slides/slide4.xml"]);
    expect(summary).toContain("0E3A4D");
    expect(summary).not.toContain("1C1917");
    await expect(buildPptx([{ layout: "steps", title: "短", bullets: ["只有", "两步"] }])).rejects.toThrow(/steps/);
  });

  it("draws metrics, a table, a column chart, and speaker notes", async () => {
    const pptx = await buildPptx([
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

  it("embeds a real font, an icon, a picture, and a fade", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppt-media-"));
    roots.push(root);
    writeFileSync(
      join(root, "dot.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const written = await writePresentationAt(root, "attachments/图.pptx", [
      { title: "带图", bullets: ["一行"], icon: "star", image: "dot.png" },
    ]);
    const entries = unzipSync(readFileSync(join(root, written.path)));
    const slide = new TextDecoder().decode(entries["ppt/slides/slide1.xml"]);
    const presentation = new TextDecoder().decode(entries["ppt/presentation.xml"]);
    expect(extractPptxBody(readFileSync(join(root, written.path))).text).toBe("带图\n一行");
    expect(slide).toContain('filter="fade"');
    expect(slide).toContain('filter="wipe(up)"');
    expect(slide).toContain('nodeType="clickEffect"');
    expect(slide).toContain('presetClass="entr"');
    expect(slide).toContain("<p:transition");
    expect(slide).toContain("<p:fade/>");
    expect(slide).toContain("style.visibility");
    expect(slide).toContain('prst="star5"');
    expect(slide).toContain('r:embed="rIdImage"');
    expect(entries["ppt/media/image1.png"]).toBeDefined();
    const fontPart = Object.keys(entries).find((name) => name.endsWith(".fntdata"));
    const fontBytes = fontPart === undefined ? undefined : entries[fontPart];
    expect(fontBytes).toBeDefined();
    expect(Buffer.from(fontBytes ?? new Uint8Array()).subarray(0, 4).toString("hex")).toBe("00010000");
    expect(presentation).toContain("embeddedFontLst");
    expect(presentation).toMatch(/Droid Sans Fallback|Microsoft YaHei|Noto Sans CJK SC|WenQuanYi Micro Hei/);
    expect(presentation).toMatch(/DejaVu Sans|Calibri/);
    await expect(writePresentationAt(root, "attachments/坏.pptx", [
      { title: "坏", image: "../dot.png" },
    ])).rejects.toThrow(/workspace|image/i);
  });

  it("fades the title in with the slide and reveals each step on a click", async () => {
    const cover = new TextDecoder().decode(unzipSync(await buildPptx([
      { layout: "cover", title: "开场" },
    ]))["ppt/slides/slide1.xml"]);
    expect(cover).toContain('nodeType="withEffect"');
    expect(cover).not.toContain("clickEffect");
    expect(cover).toContain("<p:fade/>");
    const steps = new TextDecoder().decode(unzipSync(await buildPptx([
      { layout: "steps", title: "三步", bullets: ["开工", "验收", "交付"] },
    ]))["ppt/slides/slide1.xml"]);
    expect(steps.match(/nodeType="clickEffect"/g)?.length).toBe(3);
    const split = new TextDecoder().decode(unzipSync(await buildPptx([
      {
        layout: "split",
        title: "对照",
        left: { title: "以前", bullets: ["手工"] },
        right: { title: "现在", bullets: ["自动"] },
      },
    ]))["ppt/slides/slide1.xml"]);
    expect(split).toContain('filter="wipe(right)"');
    expect(split).toContain('filter="wipe(left)"');
  });

  it("adds the same fade and click builds to a pptxgenjs script", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppt-script-motion-"));
    roots.push(root);
    const written = await writePresentationAt(
      root,
      "attachments/脚本.pptx",
      [],
      undefined,
      undefined,
      "const slide = pres.addSlide(); slide.addText('封面', { x: 0.6, y: 1, w: 10, h: 1 }); slide.addText('下一句', { x: 0.6, y: 3, w: 10, h: 1 });",
    );
    const slide = new TextDecoder().decode(unzipSync(readFileSync(join(root, written.path)))["ppt/slides/slide1.xml"]);
    expect(slide).toContain('filter="fade"');
    expect(slide).toContain('filter="wipe(up)"');
    expect(slide).toContain('nodeType="clickEffect"');
    expect(slide).toContain("<p:fade/>");
    expect(extractPptxBody(readFileSync(join(root, written.path))).text).toContain("封面");
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
