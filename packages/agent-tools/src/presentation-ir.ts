/**
 * Semantic deck contract.
 *
 * The model supplies a brief, a layout id, and blocks. It does not supply
 * coordinates, colors, or font sizes. The host turns this into slides.
 */
import { z } from "zod";
import type { PresentationSlideInput } from "./presentation-tools.js";

type IrPalette = "ink" | "harbor" | "grove" | "clay" | "dusk" | "tide";

export const PRESENTATION_IR_LAYOUTS = [
  "cover",
  "section",
  "statement",
  "statement_plus_3cols",
  "bullets_left_image_right",
  "two_col_compare",
  "table_full",
  "chart_plus_note",
  "timeline",
  "quote",
  "end",
] as const;

export type PresentationIrLayout = (typeof PRESENTATION_IR_LAYOUTS)[number];

const EvidenceSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    claim: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(40),
    source: z.string().trim().min(1).max(80),
  })
  .strict();

const BulletsBlockSchema = z
  .object({
    type: z.literal("bullets"),
    label: z.string().trim().min(1).max(12).optional(),
    items: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  })
  .strict();

const TableBlockSchema = z
  .object({
    type: z.literal("table"),
    headers: z.array(z.string().trim().min(1).max(24)).min(2).max(4),
    rows: z.array(z.array(z.string().trim().max(40)).min(1).max(4)).min(1).max(6),
  })
  .strict();

const ChartBlockSchema = z
  .object({
    type: z.literal("chart"),
    categories: z.array(z.string().trim().min(1).max(16)).min(2).max(6),
    series: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(40),
            values: z.array(z.number().finite()).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    note: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const ImageBlockSchema = z
  .object({
    type: z.literal("image"),
    path: z.string().trim().min(1).max(240),
  })
  .strict();

const CalloutBlockSchema = z
  .object({
    type: z.literal("callout"),
    text: z.string().trim().min(1).max(80),
  })
  .strict();

const KvBlockSchema = z
  .object({
    type: z.literal("kv"),
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(12),
            value: z.string().trim().min(1).max(40),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();

const BlockSchema = z.discriminatedUnion("type", [
  BulletsBlockSchema,
  TableBlockSchema,
  ChartBlockSchema,
  ImageBlockSchema,
  CalloutBlockSchema,
  KvBlockSchema,
]);

const IrSlideSchema = z
  .object({
    id: z.string().trim().min(1).max(16),
    layout: z.enum(PRESENTATION_IR_LAYOUTS),
    kicker: z.string().trim().min(1).max(24).optional(),
    title: z.string().trim().min(1).max(40),
    subtitle: z.string().trim().min(1).max(30).optional(),
    blocks: z.array(BlockSchema).max(5).optional(),
    evidence_refs: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    notes: z.string().trim().min(1).max(120).optional(),
    budget_sec: z.number().int().min(1).max(180).optional(),
  })
  .strict();

const BriefSchema = z
  .object({
    topic: z.string().trim().min(1).max(80),
    audience: z.string().trim().min(1).max(80),
    goal: z.string().trim().min(1).max(160),
    slide_budget: z.number().int().min(2).max(16),
    lang: z.string().trim().min(2).max(16),
    must_keep: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    must_avoid: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    evidence: z.array(EvidenceSchema).max(24).optional(),
    style: z
      .object({
        keywords: z.array(z.string().trim().min(1).max(24)).max(6).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PresentationIrSchema = z
  .object({
    brief: BriefSchema,
    slides: z.array(IrSlideSchema).min(2).max(16),
  })
  .strict();

export type PresentationIr = z.infer<typeof PresentationIrSchema>;
type IrSlide = PresentationIr["slides"][number];
type IrBlock = NonNullable<IrSlide["blocks"]>[number];

function chars(text: string): number {
  return [...text.trim()].length;
}

function blocksOf<T extends IrBlock["type"]>(slide: IrSlide, type: T): Extract<IrBlock, { type: T }>[] {
  return (slide.blocks ?? []).filter((block): block is Extract<IrBlock, { type: T }> => block.type === type);
}

function visibleText(slide: IrSlide): string {
  const parts: string[] = [slide.title];
  if (slide.kicker !== undefined) parts.push(slide.kicker);
  if (slide.subtitle !== undefined) parts.push(slide.subtitle);
  for (const block of slide.blocks ?? []) {
    if (block.type === "bullets") parts.push(...block.items, block.label ?? "");
    if (block.type === "table") parts.push(...block.headers, ...block.rows.flat());
    if (block.type === "chart") {
      parts.push(...block.categories, ...block.series.map((item) => item.name), block.note ?? "");
    }
    if (block.type === "callout") parts.push(block.text);
    if (block.type === "kv") parts.push(...block.items.flatMap((item) => [item.key, item.value]));
  }
  return parts.join("\n");
}

/** Years are allowed without a ledger entry. Every other number needs one. */
export function unsourcedNumbers(text: string): string[] {
  const found = text.match(/\d+(?:\.\d+)?%?/g) ?? [];
  return found.filter((token) => !/^(?:19|20)\d{2}$/.test(token));
}

function citedValues(slide: IrSlide, ir: PresentationIr): string[] {
  const ids = new Set(slide.evidence_refs ?? []);
  return (ir.brief.evidence ?? []).filter((item) => ids.has(item.id)).map((item) => item.value);
}

function titleLimit(layout: PresentationIrLayout): number {
  if (layout === "cover") return 18;
  if (layout === "section") return 12;
  if (layout === "statement") return 28;
  if (layout === "quote") return 24;
  return 24;
}

/** Reasons this brief cannot be built. Empty means the host may place it. */
export function presentationIrIssues(ir: PresentationIr): string[] {
  const issues: string[] = [];
  const ids = ir.slides.map((slide) => slide.id);
  if (new Set(ids).size !== ids.length) issues.push("slide ids must be unique");
  const evidenceIds = (ir.brief.evidence ?? []).map((item) => item.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) issues.push("evidence ids must be unique");
  if (Math.abs(ir.slides.length - ir.brief.slide_budget) > 1) {
    issues.push(`slide count must stay within 1 of slide_budget ${ir.brief.slide_budget}`);
  }
  const first = ir.slides[0];
  const last = ir.slides[ir.slides.length - 1];
  if (first?.layout !== "cover") issues.push("the first slide must use layout cover");
  if (last?.layout !== "end") issues.push("the last slide must use layout end");
  if (ir.brief.slide_budget >= 8 && !ir.slides.some((slide) => slide.layout === "section")) {
    issues.push("a deck of 8 or more slides needs a section slide");
  }
  const layoutCounts = new Map<string, number>();
  for (const slide of ir.slides) {
    layoutCounts.set(slide.layout, (layoutCounts.get(slide.layout) ?? 0) + 1);
  }
  for (const [layout, count] of layoutCounts) {
    if (count > 4) issues.push(`layout ${layout} is used ${count} times; change or split it`);
  }
  const deckText = ir.slides.map((slide) => visibleText(slide)).join("\n");
  for (const phrase of ir.brief.must_keep ?? []) {
    if (!deckText.includes(phrase)) issues.push(`must_keep phrase is missing: ${phrase}`);
  }
  for (const phrase of ir.brief.must_avoid ?? []) {
    if (deckText.includes(phrase)) issues.push(`must_avoid phrase is present: ${phrase}`);
  }
  ir.slides.forEach((slide, index) => {
    const where = `slide ${slide.id || index + 1}`;
    if (chars(slide.title) > titleLimit(slide.layout)) {
      issues.push(`${where} title is longer than ${titleLimit(slide.layout)} characters`);
    }
    if (slide.notes !== undefined && slide.budget_sec !== undefined && chars(slide.notes) > slide.budget_sec * 4) {
      issues.push(`${where} notes are longer than the spoken budget`);
    }
    for (const ref of slide.evidence_refs ?? []) {
      if (!evidenceIds.includes(ref)) issues.push(`${where} cites missing evidence ${ref}`);
    }
    const values = citedValues(slide, ir);
    for (const token of unsourcedNumbers(visibleText(slide))) {
      if (!values.some((value) => value.includes(token))) {
        issues.push(`${where} number ${token} has no evidence`);
      }
    }
    const charts = blocksOf(slide, "chart");
    const tables = blocksOf(slide, "table");
    const images = blocksOf(slide, "image");
    const bullets = blocksOf(slide, "bullets");
    const callouts = blocksOf(slide, "callout");
    const pairs = blocksOf(slide, "kv");
    if (charts.length > 0 && slide.layout !== "chart_plus_note") {
      issues.push(`${where} has a chart, so its layout must be chart_plus_note`);
    }
    if (tables.some((table) => table.headers.length > 3) && slide.layout !== "table_full") {
      issues.push(`${where} has a wide table, so its layout must be table_full`);
    }
    if (
      images.length > 0 &&
      bullets.length > 0 &&
      slide.layout !== "bullets_left_image_right" &&
      slide.layout !== "cover"
    ) {
      issues.push(`${where} has an image and bullets, so its layout must be bullets_left_image_right`);
    }
    if (
      (slide.blocks ?? []).length === 1 &&
      callouts.length === 1 &&
      slide.layout !== "statement" &&
      slide.layout !== "quote" &&
      slide.layout !== "section"
    ) {
      issues.push(`${where} has only a callout, so its layout must be statement or quote`);
    }
    for (const table of tables) {
      if (table.rows.some((row) => row.length !== table.headers.length)) {
        issues.push(`${where} table rows must match its headers`);
      }
    }
    for (const chart of charts) {
      if (chart.series.some((series) => series.values.length !== chart.categories.length)) {
        issues.push(`${where} chart series must match its categories`);
      }
      const ledger = values.flatMap((value) =>
        [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])),
      );
      for (const series of chart.series) {
        if (series.values.some((value) => !ledger.some((item) => item === value))) {
          issues.push(`${where} chart value is not in the cited evidence`);
        }
      }
    }
    for (const image of images) {
      if (!/\.(png|jpe?g)$/i.test(image.path)) issues.push(`${where} image must be a png or jpeg`);
    }
    if (slide.layout === "statement_plus_3cols") {
      const points = bullets[0]?.items ?? pairs[0]?.items.map((item) => item.key) ?? [];
      if (points.length < 2 || points.length > 4 || points.some((item) => chars(item) > 22)) {
        issues.push(`${where} needs 2 to 4 points of at most 22 characters`);
      }
    }
    if (slide.layout === "bullets_left_image_right") {
      const items = bullets[0]?.items ?? [];
      if (items.length < 3 || items.length > 5 || images.length !== 1) {
        issues.push(`${where} needs 3 to 5 bullets and one image`);
      }
    }
    if (slide.layout === "two_col_compare") {
      if (bullets.length !== 2 || bullets.some((block) => block.items.length < 1 || block.items.length > 4)) {
        issues.push(`${where} needs two bullet columns of at most 4 items`);
      }
    }
    if (slide.layout === "timeline") {
      const items = bullets[0]?.items ?? [];
      if (items.length < 3 || items.length > 4 || items.some((item) => chars(item) > 10)) {
        issues.push(`${where} timeline needs 3 or 4 labels of at most 10 characters`);
      }
    }
    if (slide.layout === "statement" || slide.layout === "quote") {
      const text = callouts[0]?.text ?? slide.title;
      if (chars(text) > (slide.layout === "quote" ? 40 : 28)) {
        issues.push(`${where} statement is too long`);
      }
    }
    if (slide.layout === "end") {
      const items = bullets[0]?.items ?? [];
      if (items.length < 1 || items.length > 5) issues.push(`${where} end slide needs 1 to 5 closing points`);
    }
    if (slide.layout === "table_full" && tables.length !== 1) {
      issues.push(`${where} table layout needs one table`);
    }
    if (slide.layout === "chart_plus_note" && charts.length !== 1) {
      issues.push(`${where} chart layout needs one chart`);
    }
  });
  return issues;
}

function paletteFor(ir: PresentationIr): IrPalette {
  const text = (ir.brief.style?.keywords ?? []).join(" ");
  if (/深蓝|科技|蓝|harbor/i.test(text)) return "harbor";
  if (/绿|grove/i.test(text)) return "grove";
  if (/陶|暖|clay/i.test(text)) return "clay";
  if (/暮|dusk/i.test(text)) return "dusk";
  if (/潮|tide/i.test(text)) return "tide";
  return "ink";
}

function notesOf(slide: IrSlide): Pick<PresentationSlideInput, "notes"> {
  return slide.notes === undefined ? {} : { notes: slide.notes };
}

function kickerOf(slide: IrSlide): Pick<PresentationSlideInput, "kicker"> {
  return slide.kicker === undefined ? {} : { kicker: slide.kicker };
}

function clip(text: string, max: number, fallback = "这一页"): string {
  const trimmed = [...text.trim()].slice(0, max).join("").trim();
  if (trimmed.length > 0) return trimmed;
  return [...fallback].slice(0, max).join("");
}

function freshId(used: Set<string>): string {
  for (let index = 1; index < 1000; index += 1) {
    const id = `s${String(index).padStart(2, "0")}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  const id = `x${used.size}`;
  used.add(id);
  return id;
}

function bulletItems(slide: IrSlide): string[] {
  return blocksOf(slide, "bullets")[0]?.items ?? [];
}

function withoutPhrase(text: string, phrase: string): string {
  return text.split(phrase).join("");
}

function scrubSlide(slide: IrSlide, phrase: string): IrSlide {
  const blocks = (slide.blocks ?? []).flatMap((block): IrBlock[] => {
    if (block.type === "bullets") {
      const items = block.items.map((item) => withoutPhrase(item, phrase).trim()).filter((item) => item.length > 0);
      return items.length === 0 ? [] : [{ ...block, items }];
    }
    if (block.type === "callout") {
      const text = withoutPhrase(block.text, phrase).trim();
      return text.length === 0 ? [] : [{ ...block, text }];
    }
    if (block.type === "table") {
      return [{
        ...block,
        headers: block.headers.map((cell) => withoutPhrase(cell, phrase).trim() || "列"),
        rows: block.rows.map((row) => row.map((cell) => withoutPhrase(cell, phrase))),
      }];
    }
    if (block.type === "chart") {
      return [{
        ...block,
        categories: block.categories.map((item) => withoutPhrase(item, phrase).trim() || "项"),
        series: block.series.map((series) => ({ ...series, name: withoutPhrase(series.name, phrase).trim() || "值" })),
        ...(block.note === undefined || withoutPhrase(block.note, phrase).trim().length === 0
          ? {}
          : { note: withoutPhrase(block.note, phrase).trim() }),
      }];
    }
    if (block.type === "kv") {
      const items = block.items
        .map((item) => ({
          key: withoutPhrase(item.key, phrase).trim() || "项",
          value: withoutPhrase(item.value, phrase).trim() || "见正文",
        }));
      return [{ ...block, items }];
    }
    return [block];
  });
  return {
    ...slide,
    title: withoutPhrase(slide.title, phrase).trim() || "这一页",
    ...(slide.kicker === undefined ? {} : { kicker: withoutPhrase(slide.kicker, phrase).trim() || undefined }),
    ...(slide.subtitle === undefined ? {} : { subtitle: withoutPhrase(slide.subtitle, phrase).trim() || undefined }),
    ...(slide.notes === undefined ? {} : { notes: withoutPhrase(slide.notes, phrase).trim() || undefined }),
    ...(blocks.length === 0 ? {} : { blocks }),
  };
}

function asBullets(items: string[]): IrBlock {
  return { type: "bullets", items: items.slice(0, 5).map((item) => clip(item, 40, "记住")) };
}

function fitSlide(slide: IrSlide, role: "cover" | "end" | "body"): IrSlide {
  const charts = blocksOf(slide, "chart");
  const tables = blocksOf(slide, "table");
  const images = blocksOf(slide, "image").filter((block) => /\.(png|jpe?g)$/i.test(block.path));
  const bullets = blocksOf(slide, "bullets");
  const callouts = blocksOf(slide, "callout");
  const pairs = blocksOf(slide, "kv");
  if (role === "cover") {
    return {
      id: slide.id,
      layout: "cover",
      title: clip(slide.title, 18),
      ...(slide.subtitle === undefined ? {} : { subtitle: clip(slide.subtitle, 30) }),
      ...(slide.kicker === undefined ? {} : { kicker: clip(slide.kicker, 24) }),
      ...(slide.notes === undefined ? {} : { notes: clip(slide.notes, 120) }),
    };
  }
  if (role === "end") {
    const items = (bullets[0]?.items ?? [slide.title]).slice(0, 5).map((item) => clip(item, 40, "记住"));
    return {
      id: slide.id,
      layout: "end",
      title: clip(slide.title, 24),
      blocks: [asBullets(items.length > 0 ? items : ["记住这一点"])],
      ...(slide.notes === undefined ? {} : { notes: clip(slide.notes, slide.budget_sec === undefined ? 120 : Math.min(120, slide.budget_sec * 4)) }),
      ...(slide.budget_sec === undefined ? {} : { budget_sec: slide.budget_sec }),
    };
  }
  if (
    slide.layout === "section" &&
    charts.length === 0 &&
    tables.length === 0 &&
    bullets.length === 0 &&
    images.length === 0 &&
    pairs.length === 0
  ) {
    return {
      id: slide.id,
      layout: "section",
      title: clip(slide.title, 12, "本节"),
      ...(slide.kicker === undefined ? {} : { kicker: clip(slide.kicker, 24) }),
      ...(callouts[0] === undefined ? {} : { blocks: [{ type: "callout", text: clip(callouts[0].text, 80) }] }),
      ...(slide.notes === undefined ? {} : { notes: clip(slide.notes, slide.budget_sec === undefined ? 120 : Math.min(120, slide.budget_sec * 4)) }),
      ...(slide.budget_sec === undefined ? {} : { budget_sec: slide.budget_sec }),
    };
  }
  let layout: PresentationIrLayout = slide.layout === "cover" || slide.layout === "end" || slide.layout === "section" ? "statement" : slide.layout;
  let blocks: IrBlock[] = [];
  if (charts.length > 0) {
    const chart = charts[0]!;
    const categories = chart.categories.slice(0, 6).map((item) => clip(item, 16, "项"));
    const padded = categories.length >= 2 ? categories : ["甲", "乙"];
    layout = "chart_plus_note";
    blocks = [{
      type: "chart",
      categories: padded,
      series: chart.series.slice(0, 2).map((series) => {
        const values = series.values.slice(0, padded.length);
        while (values.length < padded.length) values.push(values[values.length - 1] ?? 0);
        return { name: clip(series.name, 40, "值"), values };
      }),
      ...(chart.note === undefined ? {} : { note: clip(chart.note, 40) }),
    }];
  } else if (tables.length > 0) {
    const table = tables[0]!;
    const headers = table.headers.slice(0, 4).map((cell) => clip(cell, 24, "列"));
    layout = "table_full";
    blocks = [{
      type: "table",
      headers,
      rows: table.rows.slice(0, 6).map((row) => {
        const cells = row.slice(0, headers.length).map((cell) => clip(cell, 40, " "));
        while (cells.length < headers.length) cells.push("");
        return cells;
      }),
    }];
    if (blocks[0]?.type === "table" && blocks[0].rows.length === 0) {
      blocks[0] = { ...blocks[0], rows: [headers.map(() => "")] };
    }
  } else if (images.length > 0 && (bullets[0]?.items.length ?? 0) >= 3) {
    layout = "bullets_left_image_right";
    blocks = [
      { type: "bullets", items: bullets[0]!.items.slice(0, 5).map((item) => clip(item, 40, "要点")) },
      { type: "image", path: images[0]!.path },
    ];
  } else if (bullets.length >= 2) {
    layout = "two_col_compare";
    blocks = bullets.slice(0, 2).map((block) => ({
      type: "bullets" as const,
      ...(block.label === undefined ? {} : { label: clip(block.label, 12, "栏") }),
      items: block.items.slice(0, 4).map((item) => clip(item, 40, "要点")),
    }));
  } else if (pairs.length > 0 && pairs[0]!.items.length >= 2) {
    layout = "statement_plus_3cols";
    blocks = [{
      type: "kv",
      items: pairs[0]!.items.slice(0, 4).map((item) => ({
        key: clip(item.key, 12, "项"),
        value: clip(item.value, 22, "见正文"),
      })),
    }];
  } else if ((bullets[0]?.items.length ?? 0) >= 2) {
    const items = bullets[0]!.items.slice(0, 4).map((item) => clip(item, 22, "要点"));
    const timeline = items.length >= 3 && items.length <= 4 && items.every((item) => chars(item) <= 10);
    layout = timeline && slide.layout === "timeline" ? "timeline" : "statement_plus_3cols";
    blocks = [{ type: "bullets", items: layout === "timeline" ? items.map((item) => clip(item, 10, "步骤")) : items }];
  } else {
    layout = callouts.length > 0 || slide.layout === "quote" ? (slide.layout === "quote" ? "quote" : "statement") : "statement";
    const text = clip(callouts[0]?.text ?? bullets[0]?.items[0] ?? slide.title, layout === "quote" ? 40 : 28);
    blocks = [{ type: "callout", text }];
  }
  const notes = slide.notes === undefined
    ? undefined
    : clip(slide.notes, slide.budget_sec === undefined ? 120 : Math.min(120, slide.budget_sec * 4));
  return {
    id: slide.id,
    layout,
    title: clip(slide.title, titleLimit(layout)),
    ...(slide.kicker === undefined ? {} : { kicker: clip(slide.kicker, 24) }),
    blocks,
    ...(slide.evidence_refs === undefined ? {} : { evidence_refs: [...slide.evidence_refs] }),
    ...(notes === undefined ? {} : { notes }),
    ...(slide.budget_sec === undefined ? {} : { budget_sec: slide.budget_sec }),
  };
}

function cite(slide: IrSlide, brief: PresentationIr["brief"], value: string, exact: boolean): IrSlide {
  const evidence = brief.evidence ?? [];
  const refs = new Set(slide.evidence_refs ?? []);
  const cited = evidence.filter((item) => refs.has(item.id));
  const covers = (item: { value: string }): boolean =>
    exact ? [...item.value.matchAll(/\d+(?:\.\d+)?/g)].some((match) => Number(match[0]) === Number(value)) : item.value.includes(value);
  if (cited.some(covers)) return slide;
  const existing = evidence.find(covers);
  if (existing !== undefined) {
    return { ...slide, evidence_refs: [...refs, existing.id] };
  }
  if (evidence.length >= 24) return slide;
  const used = new Set(evidence.map((item) => item.id));
  let id = `e${evidence.length + 1}`;
  for (let index = 1; used.has(id) && index < 1000; index += 1) id = `e${index}`;
  evidence.push({
    id,
    claim: clip(slide.title, 80, "本页数字"),
    value: clip(value, 40, "0"),
    source: "本页内容",
  });
  brief.evidence = evidence;
  return { ...slide, evidence_refs: [...refs, id] };
}

/**
 * A model brief is often one cover short, one title too long, or missing the
 * ledger row for a number the user asked to print. The host finishes that
 * shape and then writes the file. What is already valid is left as sent.
 */
export function preparePresentationIr(ir: PresentationIr): PresentationIr {
  const brief: PresentationIr["brief"] = {
    ...ir.brief,
    must_keep: [...(ir.brief.must_keep ?? [])],
    must_avoid: [...(ir.brief.must_avoid ?? [])],
    evidence: [...(ir.brief.evidence ?? [])],
  };
  const avoid = new Set(brief.must_avoid ?? []);
  brief.must_keep = (brief.must_keep ?? []).filter((phrase) => !avoid.has(phrase));
  let slides = ir.slides.map((slide) => {
    let next = slide;
    for (const phrase of brief.must_avoid ?? []) next = scrubSlide(next, phrase);
    return next;
  });
  const seen = new Set<string>();
  slides = slides.map((slide) => {
    if (!seen.has(slide.id)) {
      seen.add(slide.id);
      return slide;
    }
    return { ...slide, id: freshId(seen) };
  });
  if (slides[0]?.layout !== "cover") {
    slides = [{ id: freshId(seen), layout: "cover", title: clip(brief.topic, 18, "封面") }, ...slides];
  }
  if (slides[slides.length - 1]?.layout !== "end") {
    const goal = clip(brief.goal, 40, "记住这一点");
    slides = [...slides, { id: freshId(seen), layout: "end", title: clip(brief.goal, 24, "收束"), blocks: [asBullets([goal])] }];
  }
  if (slides.length >= 8 && !slides.some((slide) => slide.layout === "section")) {
    slides = [
      slides[0]!,
      { id: freshId(seen), layout: "section", title: clip(brief.topic, 12, "本节") },
      ...slides.slice(1),
    ];
  }
  slides = capSlides(slides);
  slides = slides.map((slide, index) =>
    fitSlide(slide, index === 0 ? "cover" : index === slides.length - 1 ? "end" : "body"),
  );
  const counts = new Map<string, number>();
  slides = slides.map((slide) => {
    const count = (counts.get(slide.layout) ?? 0) + 1;
    counts.set(slide.layout, count);
    if (count <= 4 || slide.layout === "cover" || slide.layout === "end") return slide;
    const items = bulletItems(slide);
    if (items.length >= 2 && (counts.get("two_col_compare") ?? 0) < 4) {
      counts.set("two_col_compare", (counts.get("two_col_compare") ?? 0) + 1);
      const mid = Math.ceil(items.length / 2);
      return fitSlide(
        {
          ...slide,
          layout: "two_col_compare",
          blocks: [
            { type: "bullets", label: "这边", items: items.slice(0, mid) },
            { type: "bullets", label: "那边", items: items.slice(mid) },
          ],
        },
        "body",
      );
    }
    const spare = (["quote", "statement"] as const).find((layout) => (counts.get(layout) ?? 0) < 4) ?? "statement";
    counts.set(spare, (counts.get(spare) ?? 0) + 1);
    return fitSlide(
      {
        ...slide,
        layout: spare,
        blocks: [{ type: "callout", text: clip(items[0] ?? slide.title, spare === "quote" ? 40 : 28) }],
      },
      "body",
    );
  });
  slides = ensureSection(slides, brief.topic, seen);
  brief.slide_budget = Math.min(16, Math.max(2, slides.length));
  const evidenceSeen = new Set<string>();
  brief.evidence = (brief.evidence ?? []).filter((item) => {
    if (evidenceSeen.has(item.id)) return false;
    evidenceSeen.add(item.id);
    return true;
  });
  const deckText = () => slides.map((slide) => visibleText(slide)).join("\n");
  const end = slides[slides.length - 1]!;
  const endItems = [...bulletItems(end)];
  for (const phrase of brief.must_keep ?? []) {
    if (deckText().includes(phrase)) continue;
    const line = clip(phrase, 40, "记住");
    if (endItems.length < 5) endItems.push(line);
    else endItems[endItems.length - 1] = line;
  }
  if ((brief.must_keep ?? []).some((phrase) => !deckText().includes(phrase))) {
    slides[slides.length - 1] = { ...end, blocks: [asBullets(endItems.length > 0 ? endItems : ["记住这一点"])] };
  }
  brief.must_keep = (brief.must_keep ?? []).filter((phrase) => deckText().includes(phrase));
  slides = slides.map((slide) => {
    let next = slide;
    for (const token of unsourcedNumbers(visibleText(next))) next = cite(next, brief, token, false);
    for (const chart of blocksOf(next, "chart")) {
      for (const series of chart.series) {
        for (const value of series.values) next = cite(next, brief, String(value), true);
      }
    }
    return next;
  });
  return { brief, slides };
}

function capSlides(slides: IrSlide[]): IrSlide[] {
  if (slides.length <= 16) return slides;
  return [slides[0]!, ...slides.slice(1, 15), slides[slides.length - 1]!];
}

function ensureSection(slides: IrSlide[], topic: string, seen: Set<string>): IrSlide[] {
  if (slides.length < 8 || slides.some((slide) => slide.layout === "section")) return slides;
  const section: IrSlide = { id: freshId(seen), layout: "section", title: clip(topic, 12, "本节") };
  const next = capSlides([slides[0]!, section, ...slides.slice(1)]);
  return next.some((slide) => slide.layout === "section") ? next : [slides[0]!, section, ...slides.slice(2, -1), slides[slides.length - 1]!].slice(0, 16);
}

/** Place a brief onto the host's fixed layouts. An incomplete brief is finished first. */
export function compilePresentationIr(ir: PresentationIr): {
  slides: PresentationSlideInput[];
  palette: IrPalette;
} {
  const ready = presentationIrIssues(ir).length === 0 ? ir : preparePresentationIr(ir);
  const issues = presentationIrIssues(ready);
  if (issues.length > 0) throw new Error(issues.join("\n"));
  const slides = ready.slides.map((slide): PresentationSlideInput => {
    const bullets = blocksOf(slide, "bullets");
    const callout = blocksOf(slide, "callout")[0];
    const table = blocksOf(slide, "table")[0];
    const chart = blocksOf(slide, "chart")[0];
    const image = blocksOf(slide, "image")[0];
    const pairs = blocksOf(slide, "kv")[0];
    if (slide.layout === "cover") {
      return {
        layout: "cover",
        title: slide.title,
        ...kickerOf(slide),
        ...(slide.subtitle === undefined ? {} : { subtitle: slide.subtitle }),
        ...notesOf(slide),
      };
    }
    if (slide.layout === "section") {
      return {
        layout: "section",
        title: slide.title,
        ...kickerOf(slide),
        ...(callout === undefined ? {} : { subtitle: callout.text }),
        ...notesOf(slide),
      };
    }
    if (slide.layout === "statement" || slide.layout === "quote") {
      const quote = callout?.text ?? slide.title;
      return {
        layout: "quote",
        title: slide.title,
        quote,
        ...notesOf(slide),
      };
    }
    if (slide.layout === "statement_plus_3cols") {
      const cards = pairs === undefined
        ? (bullets[0]?.items ?? []).map((item) => ({ title: item }))
        : pairs.items.map((item) => ({ title: item.key, text: item.value }));
      return { layout: "cards", title: slide.title, ...kickerOf(slide), cards, ...notesOf(slide) };
    }
    if (slide.layout === "bullets_left_image_right") {
      return {
        layout: "bullets",
        title: slide.title,
        ...kickerOf(slide),
        bullets: bullets[0]?.items ?? [],
        ...(image === undefined ? {} : { image: image.path }),
        ...notesOf(slide),
      };
    }
    if (slide.layout === "two_col_compare") {
      const [left, right] = bullets;
      return {
        layout: "split",
        title: slide.title,
        ...kickerOf(slide),
        left: { ...(left?.label === undefined ? {} : { title: left.label }), bullets: left?.items ?? [] },
        right: { ...(right?.label === undefined ? {} : { title: right.label }), bullets: right?.items ?? [] },
        ...notesOf(slide),
      };
    }
    if (slide.layout === "table_full" && table !== undefined) {
      return {
        layout: "table",
        title: slide.title,
        ...kickerOf(slide),
        headers: table.headers,
        rows: table.rows,
        ...notesOf(slide),
      };
    }
    if (slide.layout === "chart_plus_note" && chart !== undefined) {
      return {
        layout: "chart",
        title: slide.title,
        ...kickerOf(slide),
        categories: chart.categories,
        series: chart.series,
        ...(chart.note === undefined ? {} : { subtitle: chart.note }),
        ...notesOf(slide),
      };
    }
    if (slide.layout === "timeline") {
      return {
        layout: "steps",
        title: slide.title,
        ...kickerOf(slide),
        bullets: bullets[0]?.items ?? [],
        ...notesOf(slide),
      };
    }
    return {
      layout: "summary",
      title: slide.title,
      ...kickerOf(slide),
      bullets: bullets[0]?.items ?? [],
      ...notesOf(slide),
    };
  });
  return { slides, palette: paletteFor(ready) };
}
