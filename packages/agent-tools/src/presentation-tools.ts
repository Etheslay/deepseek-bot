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
export const PRESENTATION_LAYOUTS = ["cover", "section", "bullets", "split", "quote"] as const;

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
  })
  .strict();

export const WritePresentationInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    pdfPath: WorkspaceFilePathSchema.optional(),
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
      if (layout === "quote" && slide.quote === undefined) {
        ctx.addIssue({ code: "custom", message: `slide ${index + 1} quote layout needs quote` });
      }
      if (layout === "split") {
        const count = (slide.left?.bullets?.length ?? 0) + (slide.right?.bullets?.length ?? 0);
        if (count < 1) {
          ctx.addIssue({ code: "custom", message: `slide ${index + 1} split layout needs a column` });
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
      "make a 4-slide sample in their language: cover, two content slides, and a closing quote. " +
      "path ends in .pptx, for example attachments/deck.pptx. Vary layouts: cover (opening, with " +
      "subtitle), section (a short divider), bullets (at most 6 short lines), split (left and right " +
      "columns), quote (one sentence in quote plus attribution). Do not make every slide the same " +
      "bullet list. pdfPath, when present, also writes a PDF of the finished deck and must end in " +
      ".pdf. A written PDF report that is not slides goes to write_document with a .pdf path. " +
      "After it returns, tell the user the file path.",
    inputSchema: WritePresentationInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      return writer.write(botId, params.path, params.slides, params.pdfPath);
    },
  };
}
