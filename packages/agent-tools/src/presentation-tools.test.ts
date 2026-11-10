import { describe, expect, it } from "vitest";
import { bindWritePresentationTool, WritePresentationInputSchema } from "./presentation-tools.js";
import { ToolRejectionError } from "./types.js";
import type { PresentationIr } from "./presentation-ir.js";

const BOT = "22222222-2222-4222-8222-222222222222";

function ir(): PresentationIr {
  return {
    brief: {
      topic: "生涯发展",
      audience: "评委",
      goal: "记住差异",
      slide_budget: 2,
      lang: "zh-CN",
      must_keep: ["差异"],
    },
    slides: [
      { id: "s01", layout: "cover", title: "把规划写成清单" },
      {
        id: "s02",
        layout: "end",
        title: "差异来自场景和工程",
        blocks: [{ type: "bullets", items: ["收束"] }],
      },
    ],
  };
}

describe("write_presentation input", () => {
  it("accepts a brief and rejects a path that is not a deck", () => {
    expect(WritePresentationInputSchema.safeParse({
      path: "attachments/deck.pptx",
      pdfPath: "attachments/deck.pdf",
      palette: "ink",
      ir: ir(),
    }).success).toBe(true);
    expect(WritePresentationInputSchema.safeParse({
      path: "deck.docx",
      ir: ir(),
    }).success).toBe(false);
    expect(WritePresentationInputSchema.safeParse({
      path: "deck.pptx",
      pdfPath: "deck.txt",
      ir: ir(),
    }).success).toBe(false);
    expect(WritePresentationInputSchema.safeParse({
      path: "deck.pptx",
      ir: { ...ir(), slides: [{ id: "s01", layout: "end", title: "没有封面" }] },
    }).success).toBe(false);
  });

  it("places the brief for the calling bot and refuses a caller with no bot", async () => {
    let seenPalette: string | undefined;
    const tool = bindWritePresentationTool({
      write(_botId, path, slides, _pdfPath, palette) {
        seenPalette = palette;
        return { path, bytes: slides.length, format: "pptx", slides: slides.length };
      },
    });
    const written = await tool.handler(
      {
        path: "attachments/deck.pptx",
        ir: {
          ...ir(),
          brief: { ...ir().brief, style: { keywords: ["科技深蓝"] } },
        },
      },
      { caller: { id: "chat:s", botId: BOT } },
    );
    expect(written).toMatchObject({ path: "attachments/deck.pptx", slides: 2 });
    expect(seenPalette).toBe("harbor");
    await expect(tool.handler(
      { path: "attachments/deck.pptx", ir: ir() },
      { caller: { id: "chat:s" } },
    )).rejects.toBeInstanceOf(ToolRejectionError);
    await expect(tool.handler(
      {
        path: "attachments/deck.pptx",
        ir: { ...ir(), slides: [ir().slides[1]!, ir().slides[1]!] },
      },
      { caller: { id: "chat:s", botId: BOT } },
    )).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
