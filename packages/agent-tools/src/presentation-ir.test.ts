import { describe, expect, it } from "vitest";
import { compilePresentationIr, presentationIrIssues, type PresentationIr } from "./presentation-ir.js";

function deck(slides: PresentationIr["slides"], extra: Partial<PresentationIr["brief"]> = {}): PresentationIr {
  return {
    brief: {
      topic: "生涯发展",
      audience: "评委",
      goal: "记住差异",
      slide_budget: extra.slide_budget ?? slides.length,
      lang: "zh-CN",
      must_keep: ["差异"],
      ...extra,
    },
    slides,
  };
}

const cover: PresentationIr["slides"][number] = { id: "s01", layout: "cover", title: "把规划写成清单" };
const end: PresentationIr["slides"][number] = {
  id: "s99",
  layout: "end",
  title: "差异来自场景和工程",
  blocks: [{ type: "bullets", items: ["收束"] }],
};

describe("presentation ir", () => {
  it("compiles every layout and picks a palette from the brief", () => {
    const slides: PresentationIr["slides"] = [
      { ...cover, subtitle: "四年路线" },
      { id: "s02", layout: "section", title: "自我认知", kicker: "开场", blocks: [{ type: "callout", text: "先讲短板" }] },
      { id: "s03", layout: "statement", title: "只补经验", blocks: [{ type: "callout", text: "不重学基础" }] },
      {
        id: "s04",
        layout: "statement_plus_3cols",
        title: "三件要记住的事",
        blocks: [{ type: "kv", items: [{ key: "场景", value: "农业" }, { key: "工程", value: "后端" }] }],
      },
      {
        id: "s05",
        layout: "bullets_left_image_right",
        title: "图在右边",
        blocks: [
          { type: "bullets", items: ["场景", "工程", "差异"] },
          { type: "image", path: "dot.png" },
        ],
      },
      {
        id: "s06",
        layout: "two_col_compare",
        title: "前后不一样",
        blocks: [
          { type: "bullets", label: "以前", items: ["只会演示"] },
          { type: "bullets", label: "现在", items: ["能落地"] },
        ],
      },
      {
        id: "s07",
        layout: "table_full",
        title: "学期安排",
        blocks: [{ type: "table", headers: ["学期", "动作"], rows: [["一", "补工程"]] }],
      },
      {
        id: "s08",
        layout: "chart_plus_note",
        title: "题量已经过线",
        evidence_refs: ["ev_001"],
        blocks: [{
          type: "chart",
          categories: ["上半年", "下半年"],
          series: [{ name: "题量", values: [80, 100] }],
          note: "来自记录",
        }],
      },
      {
        id: "s09",
        layout: "timeline",
        title: "接下来三步",
        blocks: [{ type: "bullets", items: ["补工程", "做项目", "去实习"] }],
      },
      { id: "s10", layout: "quote", title: "一句收住", blocks: [{ type: "callout", text: "把规划写成清单" }] },
      end,
    ];
    const compiled = compilePresentationIr(deck(slides, {
      evidence: [{ id: "ev_001", claim: "题量", value: "80 到 100", source: "记录" }],
      style: { keywords: ["学术克制"] },
    }));
    expect(compiled.palette).toBe("ink");
    expect(compiled.slides.map((slide) => slide.layout)).toEqual([
      "cover", "section", "quote", "cards", "bullets", "split", "table", "chart", "steps", "quote", "summary",
    ]);
    for (const keywords of [["科技深蓝"], ["绿色"], ["暖陶"], ["暮色"], ["潮汐"]]) {
      const palette = compilePresentationIr(deck([cover, end], { style: { keywords } })).palette;
      expect(["harbor", "grove", "clay", "dusk", "tide"]).toContain(palette);
    }
  });

  it("names the rule a brief breaks", () => {
    const samples: Array<[PresentationIr, string]> = [
      [deck([cover, { ...cover, id: "s01" }]), "unique"],
      [deck([cover, end], { evidence: [
        { id: "ev_001", claim: "甲", value: "1", source: "记" },
        { id: "ev_001", claim: "乙", value: "2", source: "记" },
      ] }), "evidence ids"],
      [deck([cover, end], { slide_budget: 8 }), "slide_budget"],
      [deck([end, cover]), "cover"],
      [deck([cover, { ...end, layout: "quote", blocks: [{ type: "callout", text: "差异" }] }]), "end"],
      [deck(Array.from({ length: 8 }, (_, index) => (
        index === 0 ? cover : index === 7 ? end : { id: `s${index}`, layout: "statement", title: "差异仍然成立" }
      )), { slide_budget: 8 }), "section"],
      [deck([
        cover,
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `q${index}`,
          layout: "quote" as const,
          title: "差异仍然成立",
          blocks: [{ type: "callout" as const, text: "短句" }],
        })),
        end,
      ]), "used 5"],
      [deck([cover, end], { must_avoid: ["差异"] }), "must_avoid"],
      [deck([cover, { ...end, title: "收束", blocks: [{ type: "bullets", items: ["没有那句话"] }] }], { must_keep: ["差异"] }), "must_keep"],
      [deck([cover, { ...end, notes: "这是一段明显超过预算的口播", budget_sec: 1 }]), "spoken"],
      [deck([cover, { ...end, evidence_refs: ["missing"] }]), "missing evidence"],
      [deck([cover, { ...end, title: "完成 180 题" }]), "180"],
      [deck([cover, {
        ...end,
        title: "差异写在计划里",
        blocks: [{ type: "bullets", items: ["计划写在 2026"] }],
      }]), ""],
      [deck([cover, {
        id: "s02",
        layout: "statement",
        title: "这里不该放图",
        blocks: [{ type: "chart", categories: ["甲", "乙"], series: [{ name: "数", values: [1, 2] }] }],
      }, end]), "chart_plus_note"],
      [deck([cover, {
        id: "s02",
        layout: "statement",
        title: "表太宽了",
        blocks: [{ type: "table", headers: ["甲", "乙", "丙", "丁"], rows: [["1", "2", "3", "4"]] }],
      }, end]), "table_full"],
      [deck([cover, {
        id: "s02",
        layout: "statement",
        title: "图文放错版式",
        blocks: [
          { type: "bullets", items: ["一", "二", "三"] },
          { type: "image", path: "dot.png" },
        ],
      }, end]), "bullets_left_image_right"],
      [deck([cover, {
        id: "s02",
        layout: "timeline",
        title: "只有一句",
        blocks: [{ type: "callout", text: "不该在时间轴" }],
      }, end]), "statement or quote"],
      [deck([cover, {
        id: "s02",
        layout: "table_full",
        title: "行列对不上",
        blocks: [{ type: "table", headers: ["甲", "乙"], rows: [["只一列"]] }],
      }, end]), "match its headers"],
      [deck([cover, {
        id: "s02",
        layout: "chart_plus_note",
        title: "序列缺一格",
        evidence_refs: ["ev_001"],
        blocks: [{ type: "chart", categories: ["甲", "乙"], series: [{ name: "数", values: [1] }] }],
      }, end], { evidence: [{ id: "ev_001", claim: "数", value: "1", source: "记" }] }), "match its categories"],
      [deck([cover, {
        id: "s02",
        layout: "bullets_left_image_right",
        title: "图片格式不对",
        blocks: [
          { type: "bullets", items: ["一", "二", "三"] },
          { type: "image", path: "notes.txt" },
        ],
      }, end]), "png or jpeg"],
      [deck([cover, {
        id: "s02",
        layout: "statement_plus_3cols",
        title: "点太长",
        blocks: [{ type: "bullets", items: ["这一个点已经超过二十二个字的容量了"] }],
      }, end]), "22"],
      [deck([cover, {
        id: "s02",
        layout: "two_col_compare",
        title: "只有一边",
        blocks: [{ type: "bullets", items: ["一边"] }],
      }, end]), "two bullet"],
      [deck([cover, {
        id: "s02",
        layout: "timeline",
        title: "节点太少",
        blocks: [{ type: "bullets", items: ["只有一步"] }],
      }, end]), "timeline"],
      [deck([cover, {
        id: "s02",
        layout: "statement",
        title: "差异仍然成立",
        blocks: [{ type: "callout", text: "123456789012345678901234567890" }],
      }, end]), "too long"],
      [deck([cover, { ...end, blocks: [] }]), "closing"],
      [deck([cover, { id: "s02", layout: "table_full", title: "没有表" }, end]), "one table"],
      [deck([cover, { id: "s02", layout: "chart_plus_note", title: "没有图" }, end]), "one chart"],
    ];
    for (const [sample, fragment] of samples) {
      const issues = presentationIrIssues(sample);
      if (fragment === "") expect(issues).toEqual([]);
      else expect(issues, `${fragment} :: ${issues.join(" | ")}`).toEqual(
        expect.arrayContaining([expect.stringContaining(fragment)]),
      );
    }
    expect(() => compilePresentationIr(deck([end, cover]))).toThrow(/cover/);
  });
});
