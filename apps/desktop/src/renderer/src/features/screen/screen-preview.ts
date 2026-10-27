/**
 * Local screen-preview guards (D21 desktop).
 *
 * The host returns a JPEG as base64. The settings page may turn that into a
 * data URL and nothing else: no HTML, no remote URL, and no OCR text inside
 * the image address.
 */
import type { MessageKey, Notice } from "../../i18n.js";

const JPEG_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_PREVIEW_CHARS = 360_000;

/** JPEG data URL, or null when the payload is not a bounded JPEG. */
export function screenPreviewDataUrl(imageBase64: string): string | null {
  if (imageBase64.length < 8 || imageBase64.length > MAX_PREVIEW_CHARS) return null;
  if (!imageBase64.startsWith("/9j/")) return null;
  if (!JPEG_BASE64.test(imageBase64)) return null;
  return `data:image/jpeg;base64,${imageBase64}`;
}

const MESSAGE_KEYS = {
  "screen capture is not available": "screen.unavailable",
  "screen host is closed": "screen.unavailable",
  "screen results are unavailable": "screen.unavailable",
  "screen sensing is not installed": "screen.unavailable",
  "screen capture was cancelled": "screen.cancelled",
  "screen capture is already in progress": "screen.rateLimited",
  "screen capture is busy": "screen.rateLimited",
  "screen capture was not approved": "screen.notApproved",
  "screen target changed": "screen.targetChanged",
  "screen target is not selected": "screen.needTarget",
  "screen window is not in the current list": "screen.needTarget",
  "delete a screen result before capturing another": "screen.resultsFull",
} as const satisfies Record<string, MessageKey>;

const CODE_KEYS = {
  RUNTIME_UNAVAILABLE: "screen.unavailable",
  CANCELLED: "screen.cancelled",
  RATE_LIMITED: "screen.rateLimited",
  UNAUTHORIZED_PATH: "screen.notApproved",
} as const satisfies Record<string, MessageKey>;

function readField(error: unknown, field: "code" | "message"): string | null {
  if (typeof error !== "object" || error === null || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/**
 * Map a host rejection to a catalogue key. The host message is matched only
 * when it is one of the known sentences, so a window title cannot leak into
 * the notice.
 */
export function screenHostNotice(error: unknown): Notice {
  if (error instanceof Error && error.name === "ZodError") return { key: "screen.failed" };
  const message = readField(error, "message");
  if (message !== null && Object.prototype.hasOwnProperty.call(MESSAGE_KEYS, message)) {
    return { key: MESSAGE_KEYS[message as keyof typeof MESSAGE_KEYS] };
  }
  const code = readField(error, "code");
  if (code !== null && Object.prototype.hasOwnProperty.call(CODE_KEYS, code)) {
    return { key: CODE_KEYS[code as keyof typeof CODE_KEYS] };
  }
  return { key: "screen.failed" };
}
