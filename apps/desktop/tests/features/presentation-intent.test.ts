import { describe, expect, it } from "vitest";
import { asksToMakePresentation } from "../../src/renderer/src/features/chat/presentation-intent.js";

describe("asksToMakePresentation", () => {
  it("treats a request to make a deck as a presentation turn", () => {
    expect(asksToMakePresentation("你能做ppt么")).toBe(true);
    expect(asksToMakePresentation("帮我做一份关于猫的演示文稿")).toBe(true);
    expect(asksToMakePresentation("make a powerpoint about cats")).toBe(true);
  });

  it("leaves a request to read an existing deck alone", () => {
    expect(asksToMakePresentation("总结这个ppt")).toBe(false);
    expect(asksToMakePresentation("这个pptx讲了什么")).toBe(false);
    expect(asksToMakePresentation("")).toBe(false);
  });
});