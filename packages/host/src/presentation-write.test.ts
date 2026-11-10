import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { extractPptxBody } from "./attachment-parse.js";
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
