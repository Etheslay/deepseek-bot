/**
 * `write_presentation` creates one workspace .pptx from titled slides.
 * The Host encodes the package; this binding only checks the caller and the
 * shape of the request. Authorization maps to `fs.write`.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";
import { WorkspaceFilePathSchema } from "./workspace-file.js";

export const MAX_PRESENTATION_SLIDES = 20;
export const MAX_SLIDE_TITLE = 120;
export const MAX_SLIDE_BULLETS = 8;
export const MAX_BULLET_CHARS = 240;

const SlideSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_SLIDE_TITLE),
    bullets: z.array(z.string().trim().min(1).max(MAX_BULLET_CHARS)).max(MAX_SLIDE_BULLETS).optional(),
  })
  .strict();

export const WritePresentationInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    slides: z.array(SlideSchema).min(1).max(MAX_PRESENTATION_SLIDES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!/\.pptx$/i.test(value.path)) {
      ctx.addIssue({ code: "custom", message: "path must end with .pptx" });
    }
  });

export type PresentationSlideInput = z.infer<typeof SlideSchema>;

export interface WrittenPresentation {
  readonly path: string;
  readonly bytes: number;
  readonly format: "pptx";
  readonly slides: number;
}

export interface PresentationWriter {
  write(
    botId: string,
    relativePath: string,
    slides: readonly PresentationSlideInput[],
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
      "Create a PowerPoint (.pptx) in the bot workspace. When the user asks for a PPT, " +
      "slides, a deck, or whether you can make one, call this tool and build the deck " +
      "instead of saying you cannot. If they named no topic, make a short 3-slide sample " +
      "in their language. path is workspace-relative and must end in .pptx, for example " +
      "attachments/deck.pptx. slides is the full deck in order; each slide has a title and " +
      "optional bullet lines. After it returns, tell the user the file path.",
    inputSchema: WritePresentationInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      return writer.write(botId, params.path, params.slides);
    },
  };
}
