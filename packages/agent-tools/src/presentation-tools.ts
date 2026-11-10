/**
 * `write_presentation` creates one workspace .pptx from titled slides.
 * The Host encodes the package; this binding only checks the caller and the
 * shape of the request. Authorization maps to `fs.write`.
 */
import { z } from "zod";
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
    slides: z.array(SlideSchema).min(1).max(MAX_PRESENTATION_SLIDES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!/\.pptx$/i.test(value.path)) {
      ctx.addIssue({ code: "custom", message: "path must end with .pptx" });
    }
    if (value.pdfPath !== undefined && !/\.pdf$/i.test(value.pdfPath)) {
      ctx.addIssue({ code: "custom", message: "pdfPath must end with .pdf" });
    }
    value.slides.forEach((slide, index) => {
      const layout = slide.layout ?? "bullets";
      if (layout === "agenda") {
        const items = slide.bullets ?? [];
        if (items.length < 2 || items.some((item) => item.length > 40)) {
          ctx.addIssue({ code: "custom", message: `slide ${index + 1} agenda needs 2 to 6 short items` });
        }
      }
      if (layout === "steps") {
        const items = slide.bullets ?? [];
        if (items.length < 3 || items.length > 4 || items.some((item) => item.length > 16)) {
          ctx.addIssue({ code: "custom", message: `slide ${index + 1} steps needs 3 or 4 short labels` });
        }
      }
      if (layout === "cards" && slide.cards === undefined) {
        ctx.addIssue({ code: "custom", message: `slide ${index + 1} cards layout needs cards` });
      }
      if (layout === "summary" && (slide.bullets?.length ?? 0) < 1) {
        ctx.addIssue({ code: "custom", message: `slide ${index + 1} summary needs bullets` });
      }
      if (layout === "quote" && slide.quote === undefined) {
        ctx.addIssue({ code: "custom", message: `slide ${index + 1} quote layout needs quote` });
      }
      if (layout === "split") {
        const count = (slide.left?.bullets?.length ?? 0) + (slide.right?.bullets?.length ?? 0);
        if (count < 1) {
          ctx.addIssue({ code: "custom", message: `slide ${index + 1} split layout needs a column` });
        }
      }
      if (layout === "metrics" && slide.metrics === undefined) {
        ctx.addIssue({ code: "custom", message: `slide ${index + 1} metrics layout needs metrics` });
      }
      if (layout === "table") {
        const width = slide.headers?.length ?? 0;
        if (width < 2 || slide.rows === undefined || slide.rows.some((row) => row.length !== width)) {
          ctx.addIssue({ code: "custom", message: `slide ${index + 1} table rows must match its headers` });
        }
      }
      if (slide.image !== undefined && !/\.(png|jpe?g)$/i.test(slide.image)) {
        ctx.addIssue({ code: "custom", message: `slide ${index + 1} image must be a png or jpeg in the workspace` });
      }
      if (layout === "chart") {
        const count = slide.categories?.length ?? 0;
        const series = slide.series ?? [];
        if (count < 2 || series.length < 1 || series.some((item) => item.values.length !== count)) {
          ctx.addIssue({ code: "custom", message: `slide ${index + 1} chart series must match its categories` });
        }
      }
    });
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
      "Create a designed 16:9 PowerPoint in the bot workspace. When the user asks for a PPT, " +
      "slides, or a deck, call this and build it instead of refusing. If they named no topic, " +
      "make a 4-slide sample in their language: dark cover, agenda, one content slide, dark summary. " +
      "path ends in .pptx, for example attachments/deck.pptx. palette is one of ink, harbor, grove, " +
      "clay, dusk, tide; pick the one that fits the topic and use it for the whole deck. " +
      "Open and close on dark slides (cover, section, summary). Keep middle slides light. " +
      "Vary layouts and do not repeat a bullet list: agenda (2 to 6 short items), cards (2 to 4 " +
      "titled cards), steps (3 or 4 labels of at most 16 characters), split (two columns), " +
      "metrics (2 to 4 big figures), table, chart (column chart, categories plus one or two series), " +
      "quote, bullets (at most 6, only when a list is the point). " +
      "Give a content slide an icon, an image, a chart, cards, or steps so it is not text alone. " +
      "icon is arrow, check, star, alert, spark, or target. image is a workspace png or jpeg. " +
      "notes is speaker text and stays off the slide. Shapes fade in during the show. " +
      "The deck embeds the CJK and Latin faces it draws with. Keep titles short. " +
      "pdfPath, when present, also writes a PDF of the finished deck and must end in " +
      ".pdf. A written PDF report that is not slides goes to write_document with a .pdf path. " +
      "After it returns, tell the user the file path.",
    inputSchema: WritePresentationInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      return writer.write(botId, params.path, params.slides, params.pdfPath, params.palette);
    },
  };
}
