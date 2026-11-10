/**
 * Subset and name the faces a deck embeds.
 *
 * PresentationML stores a raw TrueType file (not Word's obfuscated form).
 * Microsoft YaHei is used when this computer has it. Otherwise a free CJK
 * face that is actually installed is subset to the deck's characters, and
 * DejaVu Sans covers Latin when it is present. The typeface string written
 * into the slides is the embedded file's family name.
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

const CJK_FILES = [
  "C:\\Windows\\Fonts\\msyh.ttf",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
];

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

async function subsetFace(file: string, text: string): Promise<Uint8Array | undefined> {
  try {
    const bytes = await subsetFont(fs.readFileSync(file), text, { targetFormat: "truetype" });
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
  const cjkFile = firstFile(CJK_FILES);
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
