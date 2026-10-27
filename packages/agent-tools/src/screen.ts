/** Model-facing screen capture. The Host binds the selected window; the model only chooses image or OCR. */
import { z } from "zod";
import type { ToolCaller, ToolCapability, ToolContext } from "./types.js";

export const ScreenCaptureInputSchema = z
  .object({
    mode: z.enum(["image", "ocr"]),
  })
  .strict();

export interface ScreenCaptureResult {
  readonly id: string;
  readonly mode: "image" | "ocr";
  readonly at: string;
  readonly width: number;
  readonly height: number;
  readonly hasOcr: boolean;
}

export interface ScreenCaptureStore {
  capture(
    caller: ToolCaller,
    mode: "image" | "ocr",
    context: ToolContext,
  ): Promise<ScreenCaptureResult>;
}

export function bindScreenCaptureTool(
  store: ScreenCaptureStore,
): ToolCapability<typeof ScreenCaptureInputSchema> {
  return {
    name: "screen_capture",
    description:
      "Capture the window the user already selected. mode is image or ocr. " +
      "Each call needs a new approval. The result is only id, mode, at, width, height, and hasOcr. " +
      "This tool cannot change the selected window or the permission policy, and it does not return pixels or OCR text.",
    inputSchema: ScreenCaptureInputSchema,
    handler(params, context) {
      return store.capture(context.caller, params.mode, context);
    },
  };
}
