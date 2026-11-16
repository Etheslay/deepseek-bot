/**
 * `write_presentation` creates one workspace .pptx from titled slides.
 * The Host encodes the package; this binding only checks the caller and the
 * shape of the request. Authorization maps to `fs.write`.
 */
import { z } from "zod";
import { compilePresentationIr, PresentationIrSchema } from "./presentation-ir.js";
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
      "Create a 16:9 .pptx in the bot workspace. Call it once, with the lesson itself. " +
      "path is a workspace-relative path ending in .pptx, such as 认识分数.pptx. " +
      "ir.brief needs topic, audience, goal, slide_budget (how many slides you are sending, 2 to 16), and lang zh-CN. " +
      "Put a sentence the user insisted on into must_keep. " +
      "slides: the first layout is cover, the last is end, and a deck of 8 or more has one section after the cover. " +
      "A title is a conclusion: cover at most 18 characters, section at most 12, other slides at most 24. " +
      "blocks are bullets, callout, kv, table, chart, or image. Write numbers the way the user said them. " +
      "The host fills a missing cover, ending, section, title length, and the number ledger, then writes the file. " +
      "Do not send coordinates, colors, font sizes, or a script. Do not send an outline first. " +
      "This tool is available now and writes the file on this machine when workspace writing is allowed. " +
      "Do not claim it is offline or blocked. Do not hand the user a .bat, python-pptx, or a download button. " +
      "After it returns, the chat attaches the file under the reply. Tell the user the file is in this chat. " +
      "Do not paste a disk path, a folder, or a download link.",
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
