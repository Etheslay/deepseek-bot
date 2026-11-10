import { describe, expect, it } from "vitest";
import { bindWritePresentationTool, WritePresentationInputSchema } from "./presentation-tools.js";
import { ToolRejectionError } from "./types.js";

const BOT = "22222222-2222-4222-8222-222222222222";
const SCRIPT = "const slide = pres.addSlide(); slide.addText('封面', { x: 1, y: 1, w: 4, h: 1 });";

describe("write_presentation input", () => {
  it("accepts a script and rejects each layout that is missing its content", () => {
    expect(WritePresentationInputSchema.safeParse({
      path: "attachments/deck.pptx",
      pdfPath: "attachments/deck.pdf",
      palette: "ink",
      script: SCRIPT,
    }).success).toBe(true);
    const rejected = [
      { path: "deck.docx", script: SCRIPT },
      { path: "deck.pptx", pdfPath: "deck.txt", script: SCRIPT },
      { path: "deck.pptx", script: "short" },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "目录", layout: "agenda", bullets: ["只有这一条", `第二条${"很长".repeat(20)}`] }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "步骤", layout: "steps", bullets: ["一", "二"] }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "卡片", layout: "cards" }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "收束", layout: "summary" }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "引文", layout: "quote" }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "对比", layout: "split" }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "数字", layout: "metrics" }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "表", layout: "table", headers: ["甲", "乙"], rows: [["只一列"]] }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "图", image: "notes.txt" }] },
      { path: "deck.pptx", script: SCRIPT, slides: [{ title: "图", layout: "chart", categories: ["一", "二"], series: [{ name: "甲", values: [1] }] }] },
    ];
    for (const input of rejected) {
      expect(WritePresentationInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("writes the script for the calling bot", async () => {
    let seenPalette: string | undefined;
    const tool = bindWritePresentationTool({
      write(_botId, path, slides, _pdfPath, palette) {
        seenPalette = palette;
        return { path, bytes: slides.length, format: "pptx", slides: slides.length };
      },
    });
    const written = await tool.handler(
      { path: "attachments/deck.pptx", script: SCRIPT, palette: "harbor" },
      { caller: { id: "chat:s", botId: BOT } },
    );
    expect(written).toMatchObject({ path: "attachments/deck.pptx" });
    expect(seenPalette).toBe("harbor");
    await expect(tool.handler(
      { path: "attachments/deck.pptx", script: SCRIPT },
      { caller: { id: "chat:s" } },
    )).rejects.toBeInstanceOf(ToolRejectionError);
  });
});
