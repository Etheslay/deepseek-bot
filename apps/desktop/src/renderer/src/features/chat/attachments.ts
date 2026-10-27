/**
 * Chat attachment helpers (D26 renderer-first slice): classify picked
 * files, format sizes and build the message-side context that the bot
 * "reads" when a text attachment is sent.
 */
export type AttachmentDraft = {
  name: string;
  size: number;
  mime: string;
  /** Text content for readable kinds; data URL for images. */
  text?: string;
  dataUrl?: string;
};

export type AttachmentKind = "text" | "image" | "binary";

const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
]);

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
/** How much of a text attachment flows into the message context. */
export const MAX_TEXT_CONTEXT_CHARS = 4000;

export function classifyAttachment(mime: string, name: string): AttachmentKind {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (TEXT_MIMES.has(mime) || /\.(md|txt|csv|json|html|ts|tsx|js|py)$/i.test(name)) {
    return "text";
  }
  return "binary";
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Context block prepended for the bot when a text attachment is sent:
 * bounded, clearly delimited, so the model sees file content as data.
 */
export function buildAttachmentContext(draft: AttachmentDraft): string {
  const body = (draft.text ?? "")
    .slice(0, MAX_TEXT_CONTEXT_CHARS)
    .replaceAll("```", "``\u200b`");
  // i18n-ignore: model-facing attachment block, not interface copy
  return `【附件 ${draft.name} · ${formatAttachmentSize(draft.size)}】\n\`\`\`\n${body}\n\`\`\``;
}

export function attachmentAccept(): string {
  return [
    ".txt", ".md", ".csv", ".json", ".html", ".ts", ".tsx", ".js", ".py",
    "text/*", "image/*",
  ].join(",");
}
