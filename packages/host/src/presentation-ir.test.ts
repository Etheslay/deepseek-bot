import { describe, expect, it } from "vitest";
import { compilePresentationIr, presentationIrIssues, type PresentationIr } from "@deepseek-bot/agent-tools";
import { extractPptxBody } from "./attachment-parse.js";
import { buildPptx } from "./presentation-write.js";

function brief(overrides: Partial<PresentationIr["brief"]> = {}): PresentationIr["brief"] {
  return {
    topic: "生涯发展报告",
    audience: "评委",
    goal: "记住农业场景与后端工程的差异",
    slide_budget: 2,
    lang: "zh-CN",
    must_keep: ["差异"],
    ...overrides,
  };
}

function deck(slides: PresentationIr["slides"], extra: Partial<PresentationIr["brief"]> = {}): PresentationIr {
  return { brief: brief({ ...extra, slide_budget: extra.slide_budget ?? slides.length }), slides };
}

describe("presentation ir", () => {
  it("places a two-page brief without taking coordinates", async () => {
    const ir = deck([
      { id: "s01", layout: "cover", title: "把规划写成清单", subtitle: "四年路线" },
      {
        id: "s02",
        layout: "end",
        title: "差异来自场景和工程",
        blocks: [{ type: "bullets", items: ["农业场景", "后端工程", "差异写进清单"] }],
      },
    ]);
    const compiled = compilePresentationIr(ir);
    expect(compiled.slides.map((slide) => slide.layout)).toEqual(["cover", "summary"]);
    const body = extractPptxBody(await buildPptx(compiled.slides, undefined, compiled.palette));
    expect(body.text).toContain("把规划写成清单");
    expect(body.text).toContain("差异来自场景和工程");
  });

  it("rejects a number that the evidence ledger does not contain", () => {
    const issues = presentationIrIssues(deck([
      { id: "s01", layout: "cover", title: "把规划写成清单" },
      {
        id: "s02",
        layout: "end",
        title: "累计完成 180 题",
        blocks: [{ type: "bullets", items: ["记录在册"] }],
      },
    ]));
    expect(issues.some((issue) => issue.includes("180"))).toBe(true);
  });

  it("accepts a chart only when every value is cited", () => {
    const slides: PresentationIr["slides"] = [
      { id: "s01", layout: "cover", title: "把规划写成清单" },
      {
        id: "s02",
        layout: "chart_plus_note",
        title: "题量已经过线",
        evidence_refs: ["ev_001"],
        blocks: [{
          type: "chart",
          categories: ["上半年", "下半年"],
          series: [{ name: "题量", values: [80, 180] }],
          note: "来自刷题记录",
        }],
      },
      {
        id: "s03",
        layout: "end",
        title: "差异来自场景和工程",
        blocks: [{ type: "bullets", items: ["继续记来源"] }],
      },
    ];
    const missing = presentationIrIssues(deck(slides, {
      slide_budget: 3,
      evidence: [{ id: "ev_001", claim: "题量", value: "180 题", source: "记录" }],
    }));
    expect(missing.some((issue) => issue.includes("chart value"))).toBe(true);
    const ready = presentationIrIssues(deck(slides, {
      slide_budget: 3,
      evidence: [{ id: "ev_001", claim: "题量", value: "80 题，累计 180 题", source: "记录" }],
    }));
    expect(ready).toEqual([]);
  });

  it("rejects a title that is too long for its layout", () => {
    const issues = presentationIrIssues(deck([
      { id: "s01", layout: "cover", title: "abcdefghijklmnopqrst" },
      {
        id: "s02",
        layout: "end",
        title: "差异来自场景和工程",
        blocks: [{ type: "bullets", items: ["收束"] }],
      },
    ]));
    expect(issues.some((issue) => issue.includes("title"))).toBe(true);
  });
});
