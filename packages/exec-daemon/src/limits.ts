/** Fixed D21 capture and OCR bounds. The PowerShell helper repeats the same numbers. */

export const MAX_EDGE = 8192;
export const MAX_PIXELS = 16_000_000;
export const MAX_PNG_BYTES = 8 * 1024 * 1024;
export const MAX_OCR_TEXT_BYTES = 64 * 1024;
export const MAX_OCR_TEXT_CHARS = 65_536;
export const MAX_WINDOWS = 200;
export const MAX_TITLE_CHARS = 512;
export const CAPTURE_TIMEOUT_MS = 10_000;
export const OCR_TIMEOUT_MS = 60_000;
export const MAX_HELPER_STDOUT_BYTES = 1024 * 1024;
export const CAPTURE_FILE_NAME = "capture.png";

const UINT64_MAX = 18446744073709551615n;
const DECIMAL = /^[1-9][0-9]{0,19}$/;

export function assertUint64Decimal(value: string, label: string): void {
  if (!DECIMAL.test(value) || BigInt(value) > UINT64_MAX) {
    throw invalidDecimal(label);
  }
}

export function assertPid(pid: number): void {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0xffff_ffff) {
    throw invalidDecimal("pid");
  }
}

function invalidDecimal(label: string): Error {
  const error = new Error(`${label} is invalid`);
  error.name = "InvalidDecimal";
  return error;
}

export function exceedsImageLimits(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return true;
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) return true;
  return width * height > MAX_PIXELS;
}

export function finalizeOcrText(raw: string): string {
  const text = raw.replace(/[ \t\r\n]+$/u, "");
  if (text.length > MAX_OCR_TEXT_CHARS || Buffer.byteLength(text, "utf8") > MAX_OCR_TEXT_BYTES) {
    const error = new Error("ocr text exceeds 64 KiB");
    error.name = "OcrTextLimit";
    throw error;
  }
  return text;
}
