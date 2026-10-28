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
  /** Kept handle so the send path can upload the bytes (D26). */
  file?: File;
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
/**
 * D26 read closure: text attachments at or below this size stay inline in the
 * outgoing message; larger ones (and images/binaries) are described by path
 * and read on demand via the `read_workspace_file` tool (capability fs.read).
 */
export const MAX_TEXT_INLINE_BYTES = 16 * 1024;

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

export type AttachmentCard = AttachmentDraft & {
  kind: AttachmentKind;
  /** Workspace-relative path returned by the Host upload commit. */
  path?: string;
};

/**
 * Model-facing per-attachment lines (i18n-ignore: model context, not UI copy).
 * Small text files keep the inline fenced block; everything else is announced
 * by its workspace path so the bot can read it with `read_workspace_file`.
 */
export function composeAttachmentBlocks(cards: readonly AttachmentCard[]): string[] {
  const blocks: string[] = [];
  for (const card of cards) {
    if (card.path === undefined) {
      continue;
    }
    // i18n-ignore: model-facing attachment header, not interface copy
    const header = `【附件 ${card.name} · ${formatAttachmentSize(card.size)} · 工作区路径 ${card.path}】`;
    if (card.kind === "text" && card.size <= MAX_TEXT_INLINE_BYTES) {
      const body = (card.text ?? "")
        .slice(0, MAX_TEXT_CONTEXT_CHARS)
        .replaceAll("```", "``\u200b`");
      blocks.push(`${header}\n\`\`\`\n${body}\n\`\`\``);
    } else if (card.kind === "text") {
      blocks.push(
        // i18n-ignore: model-facing pointer to the read tool
        `${header}\n（文本超过 ${MAX_TEXT_INLINE_BYTES} 字节注入上限，未随消息附带；可用 read_workspace_file 工具读取以上路径。）`,
      );
    } else if (card.kind === "image") {
      // i18n-ignore: model-facing attachment note
      blocks.push(`${header}\n（图片已保存到工作区；当前模型暂不支持视觉理解，无法看图。）`);
    } else {
      // i18n-ignore: model-facing attachment note
      blocks.push(`${header}\n（二进制附件已保存到工作区，仅有元数据，不可作为文本读取。）`);
    }
  }
  return blocks;
}

/** Browser-safe base64 for one upload chunk (no Buffer in the renderer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const STEP = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += STEP) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + STEP));
  }
  return btoa(binary);
}
