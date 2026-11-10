import { describe, expect, it } from "vitest";
import { asksToConvertToPdf, asksToMakeDocument } from "../../src/renderer/src/features/chat/document-intent.js";

describe("document intent", () => {
  it("treats a request to make or edit a Word file as a document turn", () => {
    expect(asksToMakeDocument("新建一个 word")).toBe(true);
    expect(asksToMakeDocument("你能做文档吗")).toBe(true);
    expect(asksToMakeDocument("修改这份文档的第二段")).toBe(true);
  });

  it("treats a PDF conversion separately from writing", () => {
    expect(asksToConvertToPdf("把这个文档转成pdf")).toBe(true);
    expect(asksToMakeDocument("把这个文档转成pdf")).toBe(false);
    expect(asksToMakeDocument("总结这个文档")).toBe(false);
  });
});