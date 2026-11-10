import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cjkEmbeddingRefusal, extractFirstTrueType } from "./presentation-font.js";

function faceWithTable(payload: Buffer): Buffer {
  const header = 12 + 16;
  const font = Buffer.alloc(header + payload.length);
  font.writeUInt32BE(0x00010000, 0);
  font.writeUInt16BE(1, 4);
  font.writeUInt16BE(16, 6);
  font.write("test", 12);
  font.writeUInt32BE(0, 16);
  font.writeUInt32BE(header, 20);
  font.writeUInt32BE(payload.length, 24);
  payload.copy(font, header);
  return font;
}

function collectionAround(font: Buffer, faceStart: number): Buffer {
  const packed = Buffer.from(font);
  const tableCount = packed.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const at = 12 + index * 16 + 8;
    packed.writeUInt32BE(packed.readUInt32BE(at) + faceStart, at);
  }
  const collection = Buffer.alloc(faceStart + packed.length);
  collection.write("ttcf", 0);
  collection.writeUInt32BE(0x00010000, 4);
  collection.writeUInt32BE(1, 8);
  collection.writeUInt32BE(faceStart, 12);
  packed.copy(collection, faceStart);
  return collection;
}

describe("cjkEmbeddingRefusal", () => {
  it("refuses Han, kana, or hangul when no CJK face was embedded", () => {
    const message = cjkEmbeddingRefusal("封面あ한", false);
    expect(message).toContain("中文字体");
    expect(message).toContain("msyh.ttf");
    expect(message).toContain("NotoSansCJK-Regular.ttc");
    expect(message).toContain("wqy-microhei.ttc");
    expect(message).toContain("DroidSansFallbackFull.ttf");
    expect(message).not.toContain("已嵌入微软雅黑");
  });

  it("allows an English deck when no CJK face was embedded", () => {
    expect(cjkEmbeddingRefusal("Cover slide 2026", false)).toBeNull();
  });

  it("allows Han when a CJK face was embedded", () => {
    expect(cjkEmbeddingRefusal("封面", true)).toBeNull();
  });
});

describe("extractFirstTrueType", () => {
  it("returns a single face unchanged", () => {
    const face = faceWithTable(Buffer.from("abcd"));
    expect(Buffer.from(extractFirstTrueType(face)).equals(face)).toBe(true);
  });

  it("lifts the first face out of a collection", () => {
    const face = faceWithTable(Buffer.from("abcd"));
    const extracted = Buffer.from(extractFirstTrueType(collectionAround(face, 32)));
    expect(extracted.subarray(0, 4).toString("hex")).toBe("00010000");
    expect(extracted.subarray(extracted.length - 4).toString()).toBe("abcd");
  });

  it("subsets a collected copy of an installed Latin face", async () => {
    const file = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:\\Windows\\Fonts\\calibri.ttf"]
      .find((item) => {
        try {
          readFileSync(item);
          return true;
        } catch {
          return false;
        }
      });
    if (file === undefined) return;
    const font = readFileSync(file);
    const { createRequire } = await import("node:module");
    const subset = createRequire(import.meta.url)("subset-font") as (
      data: Uint8Array,
      text: string,
      options: { targetFormat: "truetype" },
    ) => Promise<Uint8Array>;
    const subsetBytes = await subset(Buffer.from(extractFirstTrueType(collectionAround(font, 64))), "Aa", {
      targetFormat: "truetype",
    });
    expect(Buffer.from(subsetBytes.subarray(0, 4)).toString("hex")).toBe("00010000");
  });
});
