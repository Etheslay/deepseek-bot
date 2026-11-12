import { describe, expect, it } from "vitest";
import { decodeDeliveredHandoff } from "../../src/shared/delivered-handoff.js";

describe("decodeDeliveredHandoff", () => {
  it("keeps a single office file name and its bytes", () => {
    const decoded = decodeDeliveredHandoff({
      name: "xiaoxue-chengfa.pptx",
      data: Buffer.from("PK-deck").toString("base64"),
    });
    expect(decoded.name).toBe("xiaoxue-chengfa.pptx");
    expect(decoded.bytes.toString()).toBe("PK-deck");
  });

  it("rejects a path, a text file, and empty bytes", () => {
    expect(() =>
      decodeDeliveredHandoff({
        name: "attachments/xiaoxue-chengfa.pptx",
        data: Buffer.from("PK").toString("base64"),
      }),
    ).toThrow(/office file/);
    expect(() =>
      decodeDeliveredHandoff({ name: "notes.txt", data: Buffer.from("hi").toString("base64") }),
    ).toThrow(/office file/);
    expect(() => decodeDeliveredHandoff({ name: "a.pdf", data: "" })).toThrow(/bytes/);
  });
});
