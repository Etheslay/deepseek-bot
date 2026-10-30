/**
 * Renderer-side image preparation for vision input (B3'').
 *
 * A picked image must not ride into the request raw: an 8 MB photo becomes
 * ~10.7 MB of base64, past the 1 MiB envelope and the provider's 2 MiB
 * inline budget. The pick is therefore downscaled so the long edge fits
 * within MAX_IMAGE_LONG_EDGE px and re-encoded as JPEG, stepping the
 * quality down until the base64 payload fits within MAX_IMAGE_BASE64_CHARS.
 * Files already inside the budget pass through untouched (PNG keeps its
 * transparency; the JPEG re-encode only applies to over-budget inputs).
 *
 * The canvas work is browser-only; the budget decision is a pure function
 * so the policy is unit-testable without a DOM.
 */
import { bytesToBase64 } from "./attachments.js";

export const MAX_IMAGE_LONG_EDGE = 1568;
/** base64 grows 4/3; 900 KB of base64 ≈ 675 KB of raster — safely under the
 *  provider's 2 MiB inline budget and the 1 MiB envelope (text + blocks). */
export const MAX_IMAGE_BASE64_CHARS = 900_000;
const MIN_QUALITY = 0.5;

export type ImageBudgetDecision = {
  /** Long-edge target; null = keep original dimensions. */
  readonly longEdge: number | null;
  /** JPEG quality for the re-encode; undefined = keep the original bytes. */
  readonly quality: number | undefined;
};

/** Pure policy: given dimensions and current base64 size, what re-encode? */
export function planImageBudget(
  width: number,
  height: number,
  base64Chars: number,
  maxLongEdge: number = MAX_IMAGE_LONG_EDGE,
  maxBase64Chars: number = MAX_IMAGE_BASE64_CHARS,
): ImageBudgetDecision {
  if (base64Chars <= maxBase64Chars && Math.max(width, height) <= maxLongEdge) {
    return { longEdge: null, quality: undefined };
  }
  const scaleForEdge = Math.min(1, maxLongEdge / Math.max(width, height));
  const qualityForSize = Math.min(1, maxBase64Chars / Math.max(1, base64Chars));
  // One combined step covers most photos; the caller re-checks and can step
  // again (quality floors at MIN_QUALITY before the dimension shrinks).
  const quality = Math.max(MIN_QUALITY, Math.min(0.85, qualityForSize * 1.4));
  const longEdge = Math.max(
    320,
    Math.round(Math.max(width, height) * Math.min(1, Math.max(scaleForEdge, quality < 0.7 ? 0.75 : 1))),
  );
  return { longEdge, quality };
}

export type EncodedImage = {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
};

/** Encode a picked file into the request image: original bytes when they fit
 *  the budget and an admitted MIME type, else a canvas downscale + JPEG
 *  re-encode, stepping quality/dimensions down until the base64 fits. */
export async function prepareVisionImage(
  file: { bytes: Uint8Array; mime: string },
  canvasEncoder: (
    bytes: Uint8Array,
    longEdge: number,
    quality: number,
  ) => Promise<{ data: string; width: number; height: number }>,
): Promise<EncodedImage> {
  const base64 = bytesToBase64(file.bytes);
  const admitted =
    file.mime === "image/png" ||
    file.mime === "image/jpeg" ||
    file.mime === "image/webp" ||
    file.mime === "image/gif";
  if (base64.length <= MAX_IMAGE_BASE64_CHARS && admitted) {
    // Small enough AND an admitted MIME type: ride the original bytes.
    return { data: base64, mimeType: file.mime as EncodedImage["mimeType"], width: 0, height: 0 };
  }
  // Over budget or un-admitted MIME: re-encode through canvas as JPEG
  // (transparency is not worth keeping at these sizes; the caller's encoder
  // composites onto white). First attempt at the long-edge cap, then step
  // quality/dimensions down while the base64 stays over budget.
  let longEdge = MAX_IMAGE_LONG_EDGE;
  let quality = 0.85;
  let encoded = await canvasEncoder(file.bytes, longEdge, quality);
  let attempt = 0;
  while (encoded.data.length > MAX_IMAGE_BASE64_CHARS && attempt < 4) {
    attempt += 1;
    quality = Math.max(MIN_QUALITY, quality - 0.15);
    if (quality === MIN_QUALITY) {
      longEdge = Math.max(512, Math.round(longEdge * 0.75));
    }
    encoded = await canvasEncoder(file.bytes, longEdge, quality);
  }
  return { data: encoded.data, mimeType: "image/jpeg", width: encoded.width, height: encoded.height };
}
