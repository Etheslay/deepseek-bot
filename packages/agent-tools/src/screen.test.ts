import { describe, expect, it } from "vitest";
import { ScreenCaptureInputSchema, bindScreenCaptureTool } from "./screen.js";

describe("screen_capture tool", () => {
  it("accepts only image or ocr and forwards the trusted caller", async () => {
    expect(ScreenCaptureInputSchema.safeParse({ mode: "image" }).success).toBe(true);
    expect(ScreenCaptureInputSchema.safeParse({ mode: "ocr", selectionId: "x" }).success).toBe(false);
    const calls: unknown[] = [];
    const tool = bindScreenCaptureTool({
      capture(caller, mode) {
        calls.push({ caller, mode });
        return Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
          mode,
          at: "2026-10-27T00:00:00.000Z",
          width: 1,
          height: 1,
          hasOcr: mode === "ocr",
        });
      },
    });
    const caller = { id: "chat:session", botId: "00000000-0000-4000-8000-000000000002" };
    await tool.handler({ mode: "ocr" }, { caller });
    expect(calls).toEqual([{ caller, mode: "ocr" }]);
  });
});
