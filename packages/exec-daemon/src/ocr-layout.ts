import { readFileSync } from "node:fs";

export interface OcrLayout {
  pins: Record<string, string>;
  langVariant: string;
  coreFiles: readonly string[];
  langFiles: readonly string[];
  licenseFiles: readonly string[];
}

export function readOcrLayout(): OcrLayout {
  const parsed = JSON.parse(
    readFileSync(new URL("./ocr-layout.json", import.meta.url), "utf8"),
  ) as OcrLayout;
  return parsed;
}
