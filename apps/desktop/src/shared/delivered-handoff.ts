/**
 * Bytes the renderer already fetched, checked before the main process writes
 * them to a temp file or a save dialog. The name is a single file name, never
 * a path.
 */
const NAME = /^[^\\/:*?"<>|\r\n]{1,180}\.(pptx|pdf|docx)$/i;
const MAX_DATA_CHARS = 12_000_000;

export function decodeDeliveredHandoff(input: unknown): { name: string; bytes: Buffer } {
  if (input === null || typeof input !== "object") {
    throw new Error("delivered file payload is missing");
  }
  const name = (input as { name?: unknown }).name;
  const data = (input as { data?: unknown }).data;
  if (typeof name !== "string" || !NAME.test(name)) {
    throw new Error("delivered file name is not an office file");
  }
  if (typeof data !== "string" || data.length === 0 || data.length > MAX_DATA_CHARS) {
    throw new Error("delivered file bytes are missing");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("delivered file bytes are missing");
  }
  return { name, bytes };
}
