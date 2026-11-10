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

/** Place a valid IR onto the host's fixed layouts. */
export function compilePresentationIr(ir: PresentationIr): {
  slides: PresentationSlideInput[];
  palette: IrPalette;
} {
  const issues = presentationIrIssues(ir);
  if (issues.length > 0) throw new Error(issues[0]);
  const slides = ir.slides.map((slide): PresentationSlideInput => {
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
  return { slides, palette: paletteFor(ir) };
}
