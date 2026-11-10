/**
 * Subset and name the faces a deck embeds.
 *
 * PresentationML stores a raw TrueType file (not Word's obfuscated form).
 * Microsoft YaHei is used when this computer has it. Otherwise a free CJK
 * face that is actually installed is subset to the deck's characters, and
 * DejaVu Sans covers Latin when it is present. The typeface string written
 * into the slides is the embedded file's family name. Han, kana, or hangul
 * with no embedded CJK face is refused instead of naming Microsoft YaHei.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const subsetFont = createRequire(import.meta.url)("subset-font") as (
  data: Uint8Array,
  text: string,
  options?: { readonly targetFormat?: "truetype" | "woff2" },
) => Promise<Uint8Array>;

export interface EmbeddedFace {
  readonly family: string;
  readonly regular: Uint8Array;
  readonly bold?: Uint8Array;
}

/** Paths this host already searches. A missing face is a failure, not Microsoft YaHei. */
export const CJK_FONT_CANDIDATES = [
  "C:\\Windows\\Fonts\\msyh.ttf",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
] as const;

/** Han, hiragana, katakana, or hangul. Punctuation alone does not count. */
const CJK_LETTER = /[\u1100-\u11ff\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff66-\uff9d]/;

/**
 * A deck that draws Han, kana, or hangul needs a face that was actually
 * subset and embedded. Returns a message the caller can show, or null when
 * the deck may be written. English stays allowed when this computer has no
 * CJK font.
 */
export function cjkEmbeddingRefusal(text: string, cjkEmbedded: boolean): string | null {
  if (cjkEmbedded || !CJK_LETTER.test(text)) return null;
  return (
    "文稿里有汉字、假名或韩文，但这台电脑没有嵌入成功的中文字体，所以没有写出文件。" +
    `已查找：${CJK_FONT_CANDIDATES.join("、")}。` +
    "没有把东亚字体写成微软雅黑。"
  );
}

const LATIN_REGULAR = [
  "C:\\Windows\\Fonts\\calibri.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

const LATIN_BOLD = [
  "C:\\Windows\\Fonts\\calibrib.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];

function firstFile(paths: readonly string[]): string | undefined {
  return paths.find((item) => fs.existsSync(item));
}

/**
 * A TrueType collection (Windows YaHei ships as .ttc) is not a font file.
 * Lift the first face out so the subsetter receives one sfnt.
 */
export function extractFirstTrueType(data: Uint8Array): Uint8Array {
  const source = Buffer.from(data);
  if (source.subarray(0, 4).toString("latin1") !== "ttcf") return new Uint8Array(source);
  const faceCount = source.readUInt32BE(8);
  if (faceCount < 1 || source.length < 16) {
    throw new Error("font collection has no face");
  }
  const faceOffset = source.readUInt32BE(12);
  const tableCount = source.readUInt16BE(faceOffset + 4);
  const records = Array.from({ length: tableCount }, (_, index) => {
    const at = faceOffset + 12 + index * 16;
    return {
      tag: source.subarray(at, at + 4),
      checksum: source.readUInt32BE(at + 4),
      offset: source.readUInt32BE(at + 8),
      length: source.readUInt32BE(at + 12),
    };
  });
  let cursor = 12 + tableCount * 16;
  const placed = records.map((record) => {
    const next = { ...record, newOffset: cursor };
    cursor += record.length + ((4 - (record.length % 4)) % 4);
    return next;
  });
  const out = Buffer.alloc(cursor);
  source.copy(out, 0, faceOffset, faceOffset + 12);
  placed.forEach((record, index) => {
    const at = 12 + index * 16;
    record.tag.copy(out, at);
    out.writeUInt32BE(record.checksum, at + 4);
    out.writeUInt32BE(record.newOffset, at + 8);
    out.writeUInt32BE(record.length, at + 12);
    source.copy(out, record.newOffset, record.offset, record.offset + record.length);
  });
  return new Uint8Array(out);
}

async function subsetFace(file: string, text: string): Promise<Uint8Array | undefined> {
  try {
    const face = Buffer.from(extractFirstTrueType(fs.readFileSync(file)));
    const bytes = await subsetFont(face, text, { targetFormat: "truetype" });
    if (bytes.byteLength < 12 || bytes.byteLength > 1_500_000) return undefined;
    const signature = Buffer.from(bytes.subarray(0, 4)).toString("hex");
    if (signature !== "00010000" && signature !== "74727565") return undefined;
    return new Uint8Array(bytes);
  } catch {
    return undefined;
  }
}

/** Faces for one deck. `text` is every character the slides draw. */
export async function embeddedFaces(text: string): Promise<{
  readonly latin: EmbeddedFace | undefined;
  readonly cjk: EmbeddedFace | undefined;
}> {
  const sample = `${text}\n• Aa0123456789%.,:;-`;
  const latinFile = firstFile(LATIN_REGULAR);
  const latinBold = firstFile(LATIN_BOLD);
  const cjkFile = firstFile(CJK_FONT_CANDIDATES);
  const [latinRegular, latinBoldBytes, cjkRegular] = await Promise.all([
    latinFile === undefined ? Promise.resolve(undefined) : subsetFace(latinFile, sample),
    latinBold === undefined ? Promise.resolve(undefined) : subsetFace(latinBold, sample),
    cjkFile === undefined ? Promise.resolve(undefined) : subsetFace(cjkFile, sample),
  ]);
  const latin = latinRegular === undefined
    ? undefined
    : {
      family: latinFile?.includes("calibri") ? "Calibri" : "DejaVu Sans",
      regular: latinRegular,
      ...(latinBoldBytes !== undefined ? { bold: latinBoldBytes } : {}),
    };
  const cjk = cjkRegular === undefined
    ? undefined
    : {
      family: cjkFile?.toLowerCase().includes("msyh")
        ? "Microsoft YaHei"
        : cjkFile?.includes("NotoSansCJK")
          ? "Noto Sans CJK SC"
          : cjkFile?.includes("wqy")
            ? "WenQuanYi Micro Hei"
            : "Droid Sans Fallback",
      regular: cjkRegular,
    };
  return { latin, cjk };
}
