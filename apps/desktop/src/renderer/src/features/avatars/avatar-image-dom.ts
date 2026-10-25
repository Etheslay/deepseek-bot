/**
 * Browser side of avatar image intake: decode → center-crop → 256×256 →
 * re-encode (strips EXIF/metadata). Runs only in the renderer; no disk,
 * no IPC, stays in memory as a data URL.
 */
import {
  OUTPUT_SIZE,
  checkDimensions,
  checkIntake,
  cropRect,
  type ImageReject,
} from "./avatar-image.js";

export type ProcessResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: ImageReject };

export async function processAvatarFile(file: File): Promise<ProcessResult> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const intake = checkIntake(bytes, bytes.byteLength);
    if (!intake.ok) {
      return { ok: false, reason: intake.reason };
    }
    const bitmap = await createImageBitmap(new Blob([buffer], { type: file.type }));
    const dim = checkDimensions(bitmap.width, bitmap.height);
    if (!dim.ok) {
      bitmap.close();
      return { ok: false, reason: dim.reason };
    }
    const rect = cropRect(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { ok: false, reason: "read-failed" };
    }
    ctx.drawImage(
      bitmap,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/webp", 0.9);
    if (!dataUrl.startsWith("data:image/webp")) {
      // WebP encode unavailable → PNG fallback (metadata already stripped).
      return { ok: true, dataUrl: canvas.toDataURL("image/png") };
    }
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, reason: "read-failed" };
  }
}
