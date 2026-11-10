/**
 * `write_presentation` creates one workspace .pptx from titled slides.
 * The Host encodes the package; this binding only checks the caller and the
 * shape of the request. Authorization maps to `fs.write`.
 */
import { z } from "zod";
import { compilePresentationIr, PresentationIrSchema, presentationIrIssues } from "./presentation-ir.js";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";
import { WorkspaceFilePathSchema } from "./workspace-file.js";

export const MAX_PRESENTATION_SLIDES = 16;
export const MAX_SLIDE_TITLE = 80;
export const MAX_SLIDE_BULLETS = 6;
export const MAX_BULLET_CHARS = 180;
export const PRESENTATION_LAYOUTS = [
  "cover", "section", "agenda", "bullets", "cards", "steps", "split", "quote", "metrics", "table", "chart", "summary",
] as const;
export const PRESENTATION_ICONS = ["arrow", "check", "star", "alert", "spark", "target"] as const;
export const PRESENTATION_PALETTES = ["ink", "harbor", "grove", "clay", "dusk", "tide"] as const;

const MetricSchema = z
  .object({
    value: z.string().trim().min(1).max(12),
    label: z.string().trim().min(1).max(40),
  })
  .strict();

const ChartSeriesSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    values: z.array(z.number().finite()).min(1).max(6),
  })
  .strict();

const CardSchema = z
  .object({
    title: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const ColumnSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_SLIDE_TITLE).optional(),
    bullets: z.array(z.string().trim().min(1).max(MAX_BULLET_CHARS)).max(MAX_SLIDE_BULLETS).optional(),
  })
  .strict();

const SlideSchema = z
  .object({
    layout: z.enum(PRESENTATION_LAYOUTS).optional(),
    kicker: z.string().trim().min(1).max(40).optional(),
    title: z.string().trim().min(1).max(MAX_SLIDE_TITLE),
    subtitle: z.string().trim().min(1).max(180).optional(),
    bullets: z.array(z.string().trim().min(1).max(MAX_BULLET_CHARS)).max(MAX_SLIDE_BULLETS).optional(),
    left: ColumnSchema.optional(),
    right: ColumnSchema.optional(),
    quote: z.string().trim().min(1).max(280).optional(),
    attribution: z.string().trim().min(1).max(80).optional(),
    metrics: z.array(MetricSchema).min(2).max(4).optional(),
    headers: z.array(z.string().trim().min(1).max(24)).min(2).max(4).optional(),
    rows: z.array(z.array(z.string().trim().max(40)).min(1).max(4)).min(1).max(6).optional(),
    categories: z.array(z.string().trim().min(1).max(16)).min(2).max(6).optional(),
    series: z.array(ChartSeriesSchema).min(1).max(2).optional(),
    notes: z.string().trim().min(1).max(400).optional(),
    icon: z.enum(PRESENTATION_ICONS).optional(),
    image: z.string().trim().min(1).max(240).optional(),
    cards: z.array(CardSchema).min(2).max(4).optional(),
  })
  .strict();

export const WritePresentationInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    pdfPath: WorkspaceFilePathSchema.optional(),
    palette: z.enum(PRESENTATION_PALETTES).optional(),
    ir: PresentationIrSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!/\.pptx$/i.test(value.path)) {
      ctx.addIssue({ code: "custom", message: "path must end with .pptx" });
    }
    if (value.pdfPath !== undefined && !/\.pdf$/i.test(value.pdfPath)) {
      ctx.addIssue({ code: "custom", message: "pdfPath must end with .pdf" });
    }
    for (const message of presentationIrIssues(value.ir)) {
      ctx.addIssue({ code: "custom", message });
    }
  });

export type PresentationSlideInput = z.infer<typeof SlideSchema>;

export interface WrittenPresentation {
  readonly path: string;
  readonly bytes: number;
  readonly format: "pptx";
  readonly slides: number;
  readonly pdfPath?: string;
  readonly pdfBytes?: number;
}

export interface PresentationWriter {
  write(
    botId: string,
    relativePath: string,
    slides: readonly PresentationSlideInput[],
    pdfPath?: string,
    palette?: (typeof PRESENTATION_PALETTES)[number],
    script?: string,
  ): Promise<WrittenPresentation> | WrittenPresentation;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "presentation writer is not bound to a bot",
    );
  }
  return botId;
}

export function bindWritePresentationTool(
  writer: PresentationWriter,
): ToolCapability<typeof WritePresentationInputSchema> {
  return {
    name: "write_presentation",
    description:
      "Build a 16:9 PowerPoint from a semantic brief. Do not send coordinates, colors, font " +
      "sizes, or a script. The host places every box. ir.brief requires topic, audience, goal, " +
      "slide_budget from 2 to 16, and lang. evidence lists every number you will print, with id, " +
      "claim, value, and source. must_keep phrases must appear in the deck. must_avoid phrases " +
      "must not. slides start with layout cover and end with layout end. A title is a conclusion " +
      "sentence, not a label: at most 24 characters, cover at most 18, section at most 12. " +
      "blocks are only bullets, table, chart, image, callout, or kv, and a slide has at most 5. " +
      "Choose the layout from the content: a chart uses chart_plus_note, a table wider than 3 " +
      "columns uses table_full, a single callout uses statement, an image with bullets uses " +
      "bullets_left_image_right, a sequence uses timeline, a comparison uses two_col_compare, " +
      "and three points use statement_plus_3cols. Layouts are cover, section, statement, " +
      "statement_plus_3cols, bullets_left_image_right, two_col_compare, table_full, " +
      "chart_plus_note, timeline, quote, and end. Every number except a year must appear in an " +
      "evidence value cited by that slide. If a number has no source, leave it out. notes is the " +
      "spoken line, at most 120 characters. path ends in .pptx. pdfPath, when present, ends in " +
      ".pdf. After it returns, tell the user the file path.",
    inputSchema: WritePresentationInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      let compiled: ReturnType<typeof compilePresentationIr>;
      try {
        compiled = compilePresentationIr(params.ir);
      } catch (error) {
        const message = error instanceof Error ? error.message : "presentation brief was rejected";
        throw new ToolRejectionError("INVALID_INPUT", message);
      }
      return writer.write(
        botId,
        params.path,
        compiled.slides.map((slide) => SlideSchema.parse(slide)),
        params.pdfPath,
        params.palette ?? compiled.palette,
      );
    },
  };
}
