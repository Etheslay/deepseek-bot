import layout from "./ocr-layout.json" with { type: "json" };

export interface OcrLayout {
  pins: Record<string, string>;
  langVariant: string;
  coreFiles: readonly string[];
  langFiles: readonly string[];
  licenseFiles: readonly string[];
}

export function readOcrLayout(): OcrLayout {
  // Static import lets the Host bundle retain the pinned layout without
  // looking for an exec-daemon source file beside its distributed main.js.
  return layout;
}
