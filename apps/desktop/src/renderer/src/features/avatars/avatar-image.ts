/**
 * Avatar image intake (D05 UI brief §2.7): pure validation + crop geometry.
 * Browser-only canvas re-encode lives in avatar-image-dom.ts; these pure
 * parts are unit-testable in node.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MIN_DIMENSION = 64;
export const MAX_DIMENSION = 4096;
export const OUTPUT_SIZE = 256;

export type ImageReject =
  | "format"
  | "too-large"
  | "too-small"
  | "too-large-dimension"
  | "read-failed";

/** Magic-bytes sniffing; extensions and MIME strings are not trusted. */
export function sniffImageKind(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (bytes.length >= 8) {
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (isPng) {
      return "png";
    }
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (isJpeg) {
      return "jpeg";
    }
    const isWebp =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    if (isWebp) {
      return "webp";
    }
  }
  return null;
}

export type IntakeCheck =
  | { ok: true; kind: "png" | "jpeg" | "webp" }
  | { ok: false; reason: Extract<ImageReject, "format" | "too-large"> };

/** First gate: format (magic bytes) + size cap. SVG/GIF fall to "format". */
export function checkIntake(bytes: Uint8Array, byteLength: number): IntakeCheck {
  if (byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  const kind = sniffImageKind(bytes);
  if (!kind) {
    return { ok: false, reason: "format" };
  }
  return { ok: true, kind };
}

export type DimensionCheck = { ok: true } | { ok: false; reason: "too-small" | "too-large-dimension" };

export function checkDimensions(width: number, height: number): DimensionCheck {
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return { ok: false, reason: "too-small" };
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { ok: false, reason: "too-large-dimension" };
  }
  return { ok: true };
}

/** Center-crop to 1:1 source rectangle, then scale to OUTPUT_SIZE. */
export function cropRect(width: number, height: number): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  const side = Math.min(width, height);
  const sx = Math.floor((width - side) / 2);
  const sy = Math.floor((height - side) / 2);
  return { sx, sy, sw: side, sh: side };
}

export function rejectMessage(reason: ImageReject): string {
  switch (reason) {
    case "format":
      return "格式不支持：仅接受 PNG / JPEG / WebP（拒绝 SVG、GIF 与外链）。";
    case "too-large":
      return "文件超过 2 MB 上限。";
    case "too-small":
      return "图片太小：最小 64×64。";
    case "too-large-dimension":
      return "图片太大：最大 4096×4096。";
    case "read-failed":
      return "读取失败，请重试。";
  }
}
